import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDatabase } from "@/lib/db";
import { addVotes, editCode, forgetCode, isVendorCode, listCodes, VoteRequest } from "@/lib/codes";
import { buildPrompt, MatchRequest, validate, type Asset, type Project } from "@/lib/match";
import type { Caller } from "@/lib/pixwel";
import { aiAvailable, modelConfig } from "@/lib/model";
import { insights, lookup, nameKey, recordResolutions } from "@/lib/resolutions";
import * as codesRoute from "@/app/api/codes/route";

const alice: Caller = { env: "production", token: "pat_a", userId: "u-alice" };
const bob: Caller = { env: "production", token: "pat_b", userId: "u-bob" };

describe("vendor codes", () => {
  beforeEach(() => useDatabase(createClient({ url: ":memory:" })));

  it("rejects sequence numbers", () => {
    expect(isVendorCode("STF")).toBe(true);
    expect(isVendorCode("PP3")).toBe(true);
    expect(isVendorCode("0080")).toBe(false);
    expect(isVendorCode("stf")).toBe(false);
  });

  it("counts votes per person and project", async () => {
    await addVotes(alice, [{ code: "STF", projectId: "sf" }]);
    await addVotes(alice, [{ code: "STF", projectId: "sf" }]);
    await addVotes(bob, [{ code: "STF", projectId: "sf" }, { code: "FH", projectId: "dino" }]);
    await addVotes(bob, [{ code: "FH", projectId: "other" }]);
    const codes = await listCodes(alice);
    expect(codes.STF).toEqual([expect.objectContaining({ projectId: "sf", votes: 3, people: 2 })]);
    // A vendor's own code spread across projects stays visibly ambiguous.
    expect(codes.FH.map((c) => c.projectId).sort()).toEqual(["dino", "other"]);
  });

  it("skips non-codes in a batch instead of rejecting it", async () => {
    const { votes } = VoteRequest.parse({ votes: [{ code: "0080", projectId: "x" }, { code: "STF", projectId: "sf" }] });
    await addVotes(alice, votes);
    expect(Object.keys(await listCodes(alice))).toEqual(["STF"]);
  });

  it("keeps environments apart", async () => {
    await addVotes(alice, [{ code: "STF", projectId: "sf" }]);
    expect(await listCodes({ ...alice, env: "staging" })).toEqual({});
  });

  it("edits a code for everyone and forgets it", async () => {
    await addVotes(alice, [{ code: "FH", projectId: "dino" }]);
    await addVotes(bob, [{ code: "FH", projectId: "dino" }]);
    await editCode(bob, { code: "FH", projectId: "other" });
    expect((await listCodes(alice)).FH).toEqual([expect.objectContaining({ projectId: "other", votes: 1 })]);
    await forgetCode(alice, { code: "FH" });
    expect(await listCodes(alice)).toEqual({});
  });
});

describe("authentication", () => {
  beforeEach(() => useDatabase(createClient({ url: ":memory:" })));
  afterEach(() => vi.unstubAllGlobals());

  it("requires a Pixwel token", async () => {
    const res = await codesRoute.GET(new Request("https://x/api/codes"));
    expect(res.status).toBe(401);
  });

  it("only sends tokens to Pixwel hosts", async () => {
    const res = await codesRoute.GET(
      new Request("https://x/api/codes", { headers: { authorization: "Bearer pat_x", "x-pixwel-env": "https://evil.example" } }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts a token Pixwel's /session accepts, and rejects one it doesn't", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
      seen.push(String(url));
      const ok = (init.headers as Record<string, string>).Authorization === "Bearer pat_good";
      return new Response(JSON.stringify(ok ? { _id: "u1" } : { error: "no" }), { status: ok ? 200 : 401 });
    });
    const good = await codesRoute.GET(new Request("https://x/api/codes", { headers: { authorization: "Bearer pat_good" } }));
    expect(good.status).toBe(200);
    const bad = await codesRoute.GET(new Request("https://x/api/codes", { headers: { authorization: "Bearer pat_bad" } }));
    expect(bad.status).toBe(401);
    expect(seen.every((u) => u.startsWith("https://api.pixwel.com/api/session"))).toBe(true);
  });
});

describe("AI matching", () => {
  const projects: Project[] = [
    { _id: "dino", name: "PAW Patrol: The Dino Movie", filePrefix: "PAWPATROL3", created: 1_780_000_000 },
    { _id: "sf", name: "Street Fighter", filePrefix: "STREETFIGHTER", created: 1_700_000_000 },
  ];
  const assets: Asset[] = [
    { _id: "tug", name: "Tug of War", type: "social", length: 30, project: "dino" },
    { _id: "ite", name: "In Theater Etiquette", type: "social", length: 30, project: { _id: "sf" } },
  ];
  const request = MatchRequest.parse({
    files: [
      { name: "0080_Tug of War_Green Box.mov", durationSec: 30, aspect: "9x16" },
      { name: "STF_In_Theater_Ettiquette_30.mov", dirs: ["Deliveries", "STF"] },
    ],
    candidateProjectIds: ["dino", "sf"],
  });

  it("lists projects, candidate assets and files", () => {
    const prompt = buildPrompt(request, projects, assets);
    // Short references stand in for ids.
    expect(prompt).toContain("P1 | PAW Patrol: The Dino Movie | prefix PAWPATROL3");
    expect(prompt).toContain("A1 | Tug of War | social | 30s");
    expect(prompt).toContain("Assets of Street Fighter (P2)");
    expect(prompt).not.toContain("dino |");
    expect(prompt).toContain("1. STF_In_Theater_Ettiquette_30.mov (folders Deliveries / STF)");
  });

  it("maps references back to ids, drops invented ones, and lets the asset settle the project", () => {
    const matches = validate(
      {
        matches: [
          // Wrong project for the asset; the asset (A1 = tug, in dino) settles it.
          { file: 0, projectId: "P2", assetId: "a1", confidence: 1.4, reason: "Asset name" },
          { file: 1, projectId: "P9", assetId: "A9", confidence: 0.9, reason: "?" },
          { file: 7, projectId: "P2", assetId: null, confidence: 0.9, reason: "out of range" },
        ],
      },
      request,
      projects,
      assets,
    );
    expect(matches[0]).toMatchObject({ projectId: "dino", assetId: "tug", confidence: 1 });
    expect(matches[1]).toMatchObject({ projectId: null, assetId: null, confidence: 0 });
    expect(matches).toHaveLength(2);
  });
});

describe("model selection", () => {
  it("uses the AI Gateway unless an Anthropic key is set", () => {
    expect(modelConfig({})).toEqual({ via: "gateway", id: "anthropic/claude-sonnet-5.5" });
    expect(modelConfig({ ANTHROPIC_API_KEY: "sk-ant-x" })).toEqual({ via: "anthropic", id: "claude-sonnet-5-5" });
    expect(modelConfig({ PIXNAME_MODEL: "claude-opus-5-5", ANTHROPIC_API_KEY: "k" }).id).toBe("claude-opus-5-5");
  });

  it("is only available when a model can be reached", () => {
    expect(aiAvailable({})).toBe(false);
    expect(aiAvailable({ ANTHROPIC_API_KEY: "" })).toBe(false); // blank, as copied from .env.example
    expect(aiAvailable({ ANTHROPIC_API_KEY: "k" })).toBe(true);
    expect(aiAvailable({ VERCEL: "1" })).toBe(true);
    expect(aiAvailable({ ANTHROPIC_API_KEY: "k", PIXNAME_AI: "off" })).toBe(false);
  });

  it("accepts the model written either way", () => {
    expect(modelConfig({ PIXNAME_MODEL: "anthropic/claude-haiku-5.5", ANTHROPIC_API_KEY: "k" }).id).toBe("claude-haiku-5-5");
    expect(modelConfig({ PIXNAME_MODEL: "claude-haiku-5-5" }).id).toBe("anthropic/claude-haiku-5.5");
  });
});

describe("team memory", () => {
  beforeEach(() => useDatabase(createClient({ url: ":memory:" })));

  it("compares names by their content, not delivery words", () => {
    expect(nameKey("0080_Tug of War_Green Box ONLY.mov")).toEqual(["tug", "war", "green", "box", "only"]);
    expect(nameKey("FH_PawPatrol_AvaMaxCallout_9x16_TXTD_ProRes422HQ.mov")).toEqual(["fh", "paw", "patrol", "ava", "max", "callout", "9x16"]);
  });

  it("answers with how the team resolved the most similar file", async () => {
    await recordResolutions(alice, [
      { name: "0080_Tug of War_Green Box.mov", dirs: [], projectId: "dino", assetId: "tug", source: "manual", guess: null },
    ]);
    await recordResolutions(bob, [
      { name: "0081_Tug of War_Green Box.mov", dirs: [], projectId: "dino", assetId: "tug", source: "fuzzy", guess: { projectId: "dino", assetId: "tug", source: "fuzzy", score: 0.6 } },
    ]);
    const [same, variant, unrelated] = await lookup(alice, [
      "0099_Tug of War_Green Box TXTL.mov",
      "0080_Tug of War_White Box ONLY.mov",
      "Totally_Different_Thing.mov",
    ]);
    expect(same).toMatchObject({ projectId: "dino", assetId: "tug", similarity: 1, votes: 2, people: 2 });
    // Another variant of the same asset is related, but less certain.
    expect(variant).toMatchObject({ projectId: "dino", assetId: "tug" });
    expect(variant!.similarity).toBeGreaterThan(0.6);
    expect(variant!.similarity).toBeLessThan(0.8);
    expect(unrelated).toBeNull();
  });

  it("reports misses and how often AI suggestions were kept", async () => {
    await recordResolutions(alice, [
      // AI guessed right.
      { name: "a.mov", dirs: [], projectId: "p", assetId: "x", source: "ai", guess: { projectId: "p", assetId: "x", source: "ai", score: 0.8 } },
      // AI guessed wrong; fixed by hand.
      { name: "b.mov", dirs: [], projectId: "p", assetId: "y", source: "manual", guess: { projectId: "p", assetId: "x", source: "ai", score: 0.6 } },
      // No guess at all.
      { name: "c.mov", dirs: ["Deliveries"], projectId: "q", assetId: null, source: "manual", guess: null },
      // Dropped onto its project: not a miss.
      { name: "d.mov", dirs: [], projectId: "q", assetId: "z", source: "drop", guess: null },
    ]);
    const report = await insights(alice);
    expect(report.ai).toEqual({ suggested: 2, kept: 1 });
    expect(report.misses.map((m) => m.name).sort()).toEqual(["b.mov", "c.mov"]);
    expect(report.bySource.find((s) => s.source === "manual")).toEqual({ source: "manual", files: 2, missed: 2 });
  });
});
