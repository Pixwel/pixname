import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { database, useDatabase } from "@/lib/db";
import { addVotes, editCode, forgetCode, isVendorCode, listCodes, VoteRequest } from "@/lib/codes";
import { buildPrompt, expectedOf, MatchRequest, validate, type Asset, type Project } from "@/lib/match";
import type { Caller } from "@/lib/pixwel";
import { aiAvailable, modelConfig } from "@/lib/model";
import { history, insights, lookup, nameKey, recordResolutions, seen, stats, undoRenames } from "@/lib/resolutions";
import { addRule, deleteRule, listRules, suggestions } from "@/lib/rules";
import { addExpected, listExpected, removeExpected } from "@/lib/expected";
import { isAdminSession } from "@/lib/pixwel";
import * as codesRoute from "@/app/api/codes/route";

const alice: Caller = { env: "production", token: "pat_a", userId: "u-alice", userName: "Alice", isAdmin: true };
const bob: Caller = { env: "production", token: "pat_b", userId: "u-bob", userName: "Bob", isAdmin: false };

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
    // Team-wide changes are for admins.
    await expect(editCode(bob, { code: "FH", projectId: "other" })).rejects.toThrow(/admins/);
    await expect(forgetCode(bob, { code: "FH" })).rejects.toThrow(/admins/);
    await editCode(alice, { code: "FH", projectId: "other" });
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

  it("adds expected assets of candidate projects, unless Pixwel has one by that name", () => {
    const withExpected = MatchRequest.parse({
      ...request,
      expectedAssets: [
        { id: "expected:sf:world-premiere-callina-liang", name: "World Premiere - Callina Liang", type: "special-events", project: "sf" },
        { id: "expected:sf:in-theater-etiquette", name: "In Theater Etiquette", type: "social", project: "sf" },
        { id: "expected:other:x", name: "Elsewhere", type: "social", project: "other" },
      ],
    });
    const extra = expectedOf(withExpected, ["dino", "sf"], assets);
    expect(extra.map((a) => a._id)).toEqual(["expected:sf:world-premiere-callina-liang"]);
    const all = [...assets, ...extra];
    expect(buildPrompt(withExpected, projects, all)).toContain("A3 | World Premiere - Callina Liang | special-events");
    const [m] = validate({ matches: [{ file: 0, projectId: null, assetId: "A3", confidence: 0.9, reason: "name" }] }, withExpected, projects, all);
    expect(m).toMatchObject({ projectId: "sf", assetId: "expected:sf:world-premiere-callina-liang" });
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

describe("activity: admins see everyone, others only themselves", () => {
  beforeEach(() => useDatabase(createClient({ url: ":memory:" })));

  const rename = (who: Caller, name: string, extra: Record<string, unknown> = {}) =>
    recordResolutions(who, [{ name, dirs: [], projectId: "dino", assetId: "tug", source: "fuzzy", guess: null, ...extra } as never]);

  it("recognises admins the way the platform does", () => {
    expect(isAdminSession({ roles: ["a"] })).toBe(true);
    expect(isAdminSession({ groups: [{ type: "a" }] })).toBe(true);
    expect(isAdminSession({ roles: ["s"], groups: [{ type: "s" }] })).toBe(false);
  });

  it("scopes history and stats", async () => {
    await rename(alice, "a1.mov", { newName: "PAWPATROL3_A1.mov" });
    await rename(bob, "b1.mov");
    await rename(bob, "b2_100%_done.mov");

    expect((await history(alice, { limit: 50 })).rows.map((r) => r.userName).sort()).toEqual(["Alice", "Bob", "Bob"]);
    expect((await history(bob, { limit: 50, userId: "u-alice" })).rows.every((r) => r.userId === "u-bob")).toBe(true);
    // Search matches old and new names; % is literal.
    expect((await history(alice, { limit: 50, q: "PAWPATROL3" })).rows.map((r) => r.name)).toEqual(["a1.mov"]);
    expect((await history(alice, { limit: 50, q: "100%" })).rows.map((r) => r.name)).toEqual(["b2_100%_done.mov"]);

    expect(await stats(alice)).toMatchObject({ scope: "team", files: 3, people: 2 });
    expect(await stats(bob)).toMatchObject({ scope: "mine", files: 2, people: 1 });
    await expect(insights(bob)).rejects.toThrow(/admins/);
  });

  it("pages history", async () => {
    for (let i = 0; i < 5; i++) await rename(alice, `f${i}.mov`);
    const first = await history(alice, { limit: 2 });
    expect(first.more).toBe(true);
    const next = await history(alice, { limit: 2, before: first.rows[1].id });
    expect(next.rows.map((r) => r.name)).toEqual(["f2.mov", "f1.mov"]);
  });

  it("spots re-deliveries by fingerprint or size and running time", async () => {
    await rename(bob, "orig.mov", { newName: "PAWPATROL3_X.mov", fingerprint: "fp1", size: 1000, durationSec: 30 });
    const [byPrint, bySize, own, none] = await seen(alice, [
      { name: "copy.mov", fingerprint: "fp1" },
      { name: "other.mov", size: 1000, durationSec: 30.01 },
      { name: "PAWPATROL3_X.mov", fingerprint: "fp1" }, // the renamed file itself
      { name: "new.mov", fingerprint: "fp2", size: 5, durationSec: 1 },
    ]);
    expect(byPrint).toMatchObject({ newName: "PAWPATROL3_X.mov", userName: "Bob" });
    expect(bySize).toMatchObject({ name: "orig.mov" });
    expect(own).toBeNull();
    expect(none).toBeNull();
    // Non-admins are only warned about their own renames.
    expect((await seen(bob, [{ name: "copy.mov", fingerprint: "fp1" }]))[0]).not.toBeNull();
    const carol: Caller = { env: "production", token: "pat_c", userId: "u-carol", userName: "Carol", isAdmin: false };
    expect((await seen(carol, [{ name: "copy.mov", fingerprint: "fp1" }]))[0]).toBeNull();
  });

  it("hides other people's file names from non-admins in team memory", async () => {
    await rename(alice, "0080_Tug of War_Green Box.mov");
    const [forBob] = await lookup(bob, ["0081_Tug of War_Green Box.mov"]);
    const [forAlice] = await lookup(alice, ["0081_Tug of War_Green Box.mov"]);
    expect(forBob).toMatchObject({ projectId: "dino", assetId: "tug", example: null });
    expect(forAlice!.example).toBe("0080_Tug of War_Green Box.mov");
  });
});

describe("rules workbench", () => {
  beforeEach(() => useDatabase(createClient({ url: ":memory:" })));

  it("suggests code and asset rules from repeated misses", async () => {
    const miss = (name: string, projectId: string, assetId: string) =>
      recordResolutions(alice, [{ name, dirs: [], projectId, assetId, source: "manual", guess: null }]);
    await miss("FH_PawPatrol_AvaMaxCallout_9x16_TXTD.mov", "dino", "avamax");
    await miss("FH_PawPatrol_AvaMaxCallout_16x9_TXTL.mov", "dino", "avamax");
    await miss("FH_Something_Else.mov", "dino", "other");

    const found = await suggestions(alice);
    expect(found.find((s) => s.kind === "code")).toMatchObject({ key: "FH", projectId: "dino", files: 3 });
    expect(found.find((s) => s.kind === "asset")).toMatchObject({ key: "paw patrol ava max callout", assetId: "avamax", files: 2 });
    await expect(suggestions(bob)).rejects.toThrow(/admins/);
  });

  it("lets admins add and remove asset rules, and everyone read them", async () => {
    await expect(addRule(bob, { phrase: "Ava Max Callout", projectId: "dino", assetId: "avamax" })).rejects.toThrow(/admins/);
    await addRule(alice, { phrase: "AvaMaxCallout ProRes", projectId: "dino", assetId: "avamax" });
    const [rule] = await listRules(bob);
    expect(rule).toMatchObject({ phrase: "ava max callout", words: ["ava", "max", "callout"], createdBy: "Alice" });
    await deleteRule(alice, rule.id);
    expect(await listRules(bob)).toEqual([]);
  });
});

describe("database upgrades", () => {
  it("adds new columns to a table created by an earlier version, keeping its rows", async () => {
    const old = createClient({ url: ":memory:" });
    await old.execute(`CREATE TABLE resolutions (id INTEGER PRIMARY KEY, env TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL,
      name_key TEXT NOT NULL, dirs TEXT NOT NULL DEFAULT '[]', project_id TEXT NOT NULL, asset_id TEXT, source TEXT NOT NULL,
      guess_project_id TEXT, guess_asset_id TEXT, guess_source TEXT, guess_score REAL, missed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
    await old.execute(`INSERT INTO resolutions (env, user_id, name, name_key, project_id, source, created_at) VALUES ('production', 'u-old', 'old.mov', 'old', 'p', 'manual', 1)`);
    useDatabase(old);
    await database();
    const { rows } = await history(alice, { limit: 10 });
    expect(rows).toEqual([expect.objectContaining({ name: "old.mov", userName: "Unknown", newName: null })]);
  });
});

describe("undo", () => {
  beforeEach(() => useDatabase(createClient({ url: ":memory:" })));

  it("stops an undone rename counting, but keeps it in history", async () => {
    const row = { name: "STF_Tug of War_Green Box.mov", newName: "SF_X.mov", dirs: [], projectId: "sf", assetId: "tug", source: "fuzzy" as const, guess: null, fingerprint: "fp" };
    await recordResolutions(bob, [row]);
    await addVotes(bob, [{ code: "STF", projectId: "sf" }]);
    expect(await stats(bob)).toMatchObject({ files: 1 });

    // Someone else's undo doesn't touch Bob's rename.
    expect(await undoRenames(alice, [{ name: row.name, newName: row.newName }])).toBe(0);
    expect(await undoRenames(bob, [{ name: row.name, newName: row.newName }])).toBe(1);

    expect(await stats(bob)).toMatchObject({ files: 0 });
    expect(await lookup(bob, [row.name])).toEqual([null]);
    expect(await seen(bob, [{ name: "copy.mov", fingerprint: "fp" }])).toEqual([null]);
    expect(await listCodes(bob)).toEqual({});
    const { rows } = await history(bob, { limit: 10 });
    expect(rows).toEqual([expect.objectContaining({ name: row.name, undoneAt: expect.any(Number) })]);

    // Renaming it again counts normally.
    await recordResolutions(bob, [row]);
    expect(await stats(bob)).toMatchObject({ files: 1 });
  });
});

describe("expected assets", () => {
  beforeEach(() => {
    useDatabase(createClient({ url: ":memory:" }));
    // Alice sees Street Fighter and Dino; Bob only Dino.
    vi.stubGlobal("fetch", async (_url: URL, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      const projects = auth === "Bearer pat_a" ? [{ _id: "sf" }, { _id: "dino" }] : [{ _id: "dino" }];
      return new Response(JSON.stringify(projects), { status: 200 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shares a pasted list with everyone who can see the project", async () => {
    const names = ["World Premiere - Callina Liang", "World Premiere - Eric André", "World Premiere - Callina Liang"];
    expect(await addExpected(alice, { projectId: "sf", type: "special-events", names })).toBe(2);
    expect(await addExpected(alice, { projectId: "sf", type: "special-events", names: ["World Premiere - Eric Andre"] })).toBe(0);
    await addExpected(alice, { projectId: "dino", type: "social", names: ["Tug of War"] });

    const mine = await listExpected(alice);
    expect(mine.map((a) => a.slug)).toEqual(["tug-of-war", "world-premiere-callina-liang", "world-premiere-eric-andre"]);
    expect(mine[0]).toMatchObject({ projectId: "dino", type: "social", addedBy: "Alice" });
    // Bob can't see Street Fighter, so he doesn't get its list and can't change it.
    expect((await listExpected(bob)).map((a) => a.slug)).toEqual(["tug-of-war"]);
    await expect(addExpected(bob, { projectId: "sf", type: "social", names: ["X"] })).rejects.toMatchObject({ status: 404 });
    await expect(removeExpected(bob, "sf")).rejects.toMatchObject({ status: 404 });

    await removeExpected(bob, "dino", "tug-of-war");
    await removeExpected(alice, "sf");
    expect(await listExpected(alice)).toEqual([]);
  });
});
