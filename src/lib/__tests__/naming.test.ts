import { describe, expect, it } from "vitest";
import { FALLBACK_CATALOG as catalog } from "../api";
import { propose } from "../propose";
import { parseFilename } from "../parse";
import { contextHints, dirsOf, looseHints, rankAssets, rankProjects, typeHints } from "../fuzzy";
import { mediainfoFromFfprobe, tagsFromFfprobe, tagsFromMediainfo } from "../media";
import type { Asset, Project, QueueItem, WorkRequest } from "../types";

// The api module imports @tauri-apps/api, which only needs `invoke` at call time.
const passenger: Project = { _id: "p1", name: "Passenger", slug: "passenger", filePrefix: "PASSENGER" };
const other: Project = { _id: "p2", name: "Ultra Violence", slug: "ultra-violence", filePrefix: "ULTRA-VIOLENCE" };
const projects = [passenger, other];

const explainer: Asset = { _id: "a1", name: "Explainer Vertical 30", slug: "explainer-vertical-30", type: "social", project: "p1", length: 30 };
const explainer15: Asset = { _id: "a2", name: "Explainer Vertical 15", slug: "explainer-vertical-15", type: "social", project: "p1", length: 15 };
const itr: Asset = { _id: "a3", name: "Int'l Trailer 2", slug: "intl-trailer-2", type: "trailer.intl", project: "p1" };
const clip: Asset = { _id: "a4", name: "Ultra Violence", slug: "ultra-violence", type: "film-clip.intl", project: "p1", length: 63 };
const assets = [explainer, explainer15, itr, clip];

const vertical1080x1920 = {
  streams: [
    { codec_type: "video", codec_name: "prores", width: 1080, height: 1920, sample_aspect_ratio: "1:1", avg_frame_rate: "24000/1001", r_frame_rate: "24000/1001", field_order: "progressive" },
    { codec_type: "audio", codec_name: "pcm_s24le" },
  ],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "30.03" },
};

const item = (name: string, overrides: QueueItem["overrides"] = {}, ffprobe: any = vertical1080x1920, relDirs: string[] = []): QueueItem => ({
  id: name,
  file: { path: `/x/${name}`, name, dir: "/x", size: 1, relDirs },
  ext: name.split(".").pop()!,
  mediaType: "video",
  probe: { ffprobe, errors: [] },
  probing: false,
  overrides,
  selected: true,
});

describe("media mapping through the SDK", () => {
  it("maps ffprobe to the same tags mediainfo would produce", () => {
    const tags = tagsFromMediainfo({ ffprobe: vertical1080x1920, errors: [] }, "video");
    expect(tags).toMatchObject({
      Resolution: "1080x1920",
      Framerate: "23.98",
      Standard: "ntsc",
      Codec: "prores",
      Aspect: "9:16",
      "Frame Mode": "progressive",
    });
  });

  it("rounds display aspect like mediainfo (0.5625 -> 0.562)", () => {
    const info = mediainfoFromFfprobe(vertical1080x1920);
    expect(info.media.track[1].DisplayAspectRatio).toBe("0.562");
  });

  it("applies ffprobeRules from tags", () => {
    expect(tagsFromFfprobe(vertical1080x1920, catalog.tags)).toMatchObject({ Codec: ["prores"] });
  });
});

describe("propose", () => {
  it("reproduces the documented example", () => {
    const p = propose(item("whatever.mov", { language: "GRK", sub: true, extra: ["DATE"] }), {
      catalog, projects, project: passenger, asset: explainer,
    });
    expect(p.name).toBe("PASSENGER_SOCIAL_EXPLAINER-VERTICAL-30_GRK_SUB_DATE_PRORES_1920p2398.mov");
  });

  it("round-trips an already-standard name unchanged", () => {
    const name = "PASSENGER_SOCIAL_EXPLAINER-VERTICAL-30_GRK_SUB_DATE_PRORES_1920p2398.mov";
    const p = propose(item(name), { catalog, projects, project: passenger, asset: explainer });
    expect(p.name).toBe(name);
    expect(p.unchanged).toBe(true);
  });

  it("pulls language and sub from a messy name", () => {
    const p = propose(item("Passenger Explainer VERT 30s GREEK subs v3.MOV"), {
      catalog, projects, project: passenger, asset: explainer,
    });
    expect(p.name).toBe("PASSENGER_SOCIAL_EXPLAINER-VERTICAL-30_GRK_SUB_PRORES_1920p2398.mov");
  });

  it("renders trailers and running time like the SDK", () => {
    const hd = { ...vertical1080x1920, streams: [{ ...vertical1080x1920.streams[0], width: 1920, height: 1080 }] };
    expect(propose(item("x.mov", { language: "ENG", country: "US" }, hd), { catalog, projects, project: passenger, asset: itr }).name)
      .toBe("PASSENGER_ITR-2_ENG-US_TXTD_PRORES_1080p2398.mov");
    expect(propose(item("x.mov", { language: "PFR" }, hd), { catalog, projects, project: passenger, asset: clip }).name)
      .toBe("PASSENGER_FILM-CLIP-INTL_ULTRA-VIOLENCE_1MIN3SEC_PFR_TXTD_PRORES_1080p2398.mov");
  });

  it("applies work request context", () => {
    const wr: WorkRequest = {
      _id: "w1", language: "ENG", territory: "US", dng: { dialogue: ["Subtitled"], narration: [], graphics: [] },
      rejections: [{ tag: "Coming Soon", revision: 2 }],
    };
    const p = propose(item("x.mov", { workRequestId: "w1", workRequestTag: "Coming Soon" }), {
      catalog, projects, project: passenger, asset: explainer, workRequest: wr,
    });
    expect(p.name).toBe("PASSENGER_SOCIAL_EXPLAINER-VERTICAL-30_ENG-US_SUB_COMING-SOON_REV2_PRORES_1920p2398.mov");
  });

  it("omits the resolution token for scope ratios, as ingest does", () => {
    const scope = { ...vertical1080x1920, streams: [{ ...vertical1080x1920.streams[0], width: 2048, height: 858 }] };
    const p = propose(item("x.mov", { language: "ENG" }, scope), { catalog, projects, project: passenger, asset: explainer });
    expect(p.name).toBe("PASSENGER_SOCIAL_EXPLAINER-VERTICAL-30_ENG_TXTD_PRORES.mov");
    expect(p.warnings.join()).toMatch(/aspect/);
  });

  it("reports what is missing", () => {
    expect(propose(item("x.mov"), { catalog, projects, project: passenger, asset: explainer }).error).toMatch(/language/i);
    expect(propose(item("x.mov"), { catalog, projects, project: passenger }).error).toMatch(/asset/i);
  });
});

describe("parsing and fuzzy matching", () => {
  it("parses a standard name like slurpee3", () => {
    const p = parseFilename("PASSENGER_SOCIAL_EXPLAINER-VERTICAL-30_GRK_SUB_DATE_PRORES_1920p2398.mov", catalog, projects);
    expect(p).toMatchObject({ projectId: "p1", assetType: "social", assetSlug: "explainer-vertical-30", language: "GRK", country: "WW", extra: ["DATE"] });
    expect(p.tags).toEqual(expect.arrayContaining(["sub", "prores"]));
  });

  it("finds hints in loose names", () => {
    expect(looseHints("passenger_explainer_vertical_French Canadian_TEXTLESS.mov", catalog)).toMatchObject({ language: "CFR", text: "txtl" });
    expect(looseHints("Explainer-30-latam-dubbed.mp4", catalog)).toMatchObject({ language: "LAS", dub: true });
  });

  it("ranks the right project from a messy name or its folder", () => {
    expect(rankProjects({ name: "passenger explainer vert 30.mov", dirs: [] }, projects)[0].item._id).toBe("p1");
    expect(rankProjects({ name: "explainer.mov", dirs: ["Deliverables", "PASSENGER_social"] }, projects)[0].item._id).toBe("p1");
  });

  it("ranks the right asset, using numbers and running time", () => {
    const r30 = rankAssets({ name: "Passenger Explainer VERT 30s GREEK subs v3.mov", dirs: [], duration: 30 }, assets, catalog.types, catalog, passenger);
    expect(r30[0].item._id).toBe("a1");
    const r15 = rankAssets({ name: "explainer_vertical_15_FINAL.mov", dirs: [], duration: 15 }, assets, catalog.types, catalog, passenger);
    expect(r15[0].item._id).toBe("a2");
    expect(r15[0].score).toBeGreaterThan(0.7);
  });
});

describe("folder hierarchy as context", () => {
  // Dropped: "Passenger Deliverables/" containing Social/Explainer Vertical 30/GRK Subs/final_v3.mov
  const relDirs = ["Passenger Deliverables", "Social", "Explainer Vertical 30", "GRK Subs"];
  const file = { name: "final_v3.mov", dir: "/Volumes/x/Passenger Deliverables/Social/Explainer Vertical 30/GRK Subs", relDirs };
  const facts = { name: file.name, dirs: dirsOf(file), duration: 30 };
  const tvSpot: Asset = { _id: "a5", name: "Explainer 30", slug: "explainer-30", type: "tv-spot.intl", project: "p1", length: 30 };
  const socialSpot: Asset = { _id: "a6", name: "Explainer 30", slug: "explainer-30", type: "social", project: "p1", length: 30 };

  it("reads folders nearest first, falling back to the parent of a lone file", () => {
    expect(dirsOf(file)[0]).toBe("GRK Subs");
    expect(dirsOf({ dir: "/Users/me/Downloads/PASSENGER", relDirs: [] })).toEqual(["PASSENGER"]);
  });

  it("finds the project from an outer folder", () => {
    expect(rankProjects(facts, projects)[0].item._id).toBe("p1");
    expect(rankProjects({ name: "clip.mov", dirs: ["Social", "PASSENGER"] }, projects)[0].score).toBe(1);
  });

  it("finds the asset from a folder when the file name says nothing", () => {
    expect(rankAssets(facts, assets, catalog.types, catalog, passenger)[0].item._id).toBe("a1");
  });

  it("uses an asset type folder to separate same-named assets", () => {
    const pool = [tvSpot, socialSpot];
    expect(typeHints("TV Spots", catalog.types)).toEqual(expect.arrayContaining(["tv-spot.us", "tv-spot.intl"]));
    expect(rankAssets({ name: "explainer 30.mov", dirs: ["TV Spots"] }, pool, catalog.types, catalog, passenger)[0].item._id).toBe("a5");
    expect(rankAssets({ name: "explainer 30.mov", dirs: ["Social"] }, pool, catalog.types, catalog, passenger)[0].item._id).toBe("a6");
  });

  it("takes language and sub from the nearest folder, but the file name wins", () => {
    expect(contextHints("final_v3.mov", dirsOf(file), catalog)).toMatchObject({ language: "GRK", sub: true, from: { language: "GRK Subs" } });
    expect(contextHints("final_ENG.mov", dirsOf(file), catalog).language).toBe("ENG");
    // Lowercase words in folder names aren't read as language codes.
    expect(contextHints("x.mov", ["cat videos"], catalog).language).toBeUndefined();
  });

  it("renders the full name from hierarchy context alone", () => {
    const p = propose(item("final_v3.mov", {}, vertical1080x1920, relDirs), { catalog, projects, project: passenger, asset: explainer });
    expect(p.name).toBe("PASSENGER_SOCIAL_EXPLAINER-VERTICAL-30_GRK_SUB_PRORES_1920p2398.mov");
    expect(p.notes.join()).toMatch(/GRK Subs/);
  });
});
