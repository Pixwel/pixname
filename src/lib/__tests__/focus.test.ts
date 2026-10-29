// Focus Features delivers spots named by an ID ("FFSS26_5083_…", "FFSS261574XH.mov"):
// studio initials, title initials and year, then the spot number.
import { describe, expect, it } from "vitest";
import { knownCode, studioCodeScore, studioInitials } from "../abbrev";
import { FALLBACK_CATALOG as catalog } from "../api";
import { conventionsFor, type ConventionRow } from "../conventions";
import { rankAssets } from "../fuzzy";
import { chooseProject, nameScores } from "../projectMatch";
import { propose } from "../propose";
import type { Asset, Project, QueueItem } from "../types";

const FOCUS = "focus";
const studios = { [FOCUS]: "Focus Features", para: "Paramount" };
const sense: Project = { _id: "ss", name: "Sense and Sensibility", slug: "sense-and-sensibility", filePrefix: "SENSEANDSENSIBILITY", studio: FOCUS };
const six: Project = { _id: "six", name: "Six: The Musical Live!", slug: "six", filePrefix: "SIX", studio: FOCUS };
const sinners: Project = { _id: "sin", name: "Sinners Sunday", slug: "sinners-sunday", filePrefix: "SINNERS", studio: "para" };
const projects = [sense, six, sinners];

const forLove: Asset = { _id: "a1", name: "For Love Review Digital 30", slug: "for-love-review-digital-30", type: "digital-spots", project: "ss", length: 30 };
const ambition: Asset = { _id: "a2", name: "Ambition Digital 53 Vertical", slug: "ambition-digital-53-vertical", type: "digital-spots", project: "ss", length: 53 };
const ambitionTv: Asset = { _id: "a3", name: "Ambition TV 30", slug: "ambition-tv-30", type: "tv-spot.us", project: "ss", length: 30 };

const hd2398 = {
  streams: [{ codec_type: "video", codec_name: "prores", width: 1920, height: 1080, sample_aspect_ratio: "1:1", avg_frame_rate: "24000/1001", r_frame_rate: "24000/1001", field_order: "progressive" }],
  format: { format_name: "mov", duration: "30.03" },
};
const item = (name: string): QueueItem => {
  const video = !name.endsWith(".zip");
  return {
    id: name,
    file: { path: `/x/${name}`, name, dir: "/x", size: 1, relDirs: [] },
    ext: name.split(".").pop()!,
    mediaType: video ? "video" : undefined,
    probe: video ? { ffprobe: hd2398, errors: [] } : undefined,
    probing: false,
    overrides: {},
    selected: true,
  };
};

const DIGITAL = "FFSS26_5083_ForLoveReview_Digital_30_OnlyITThisFri_Texted_Stereo_2398_ProRes422HQ.mov";

describe("studio codes", () => {
  it("reads studio initials", () => {
    expect(studioInitials("Focus Features")).toBe("FF");
    expect(studioInitials("Amazon MGM Studios")).toBe("AM");
    expect(studioInitials("Paramount")).toBeUndefined();
  });

  it("matches studio + title initials + year, with or without a spot number after", () => {
    for (const name of [DIGITAL, "FFSS261574XH.mov"]) {
      const score = studioCodeScore(name, sense, "Focus Features");
      expect(score).toBeGreaterThan(0.8);
      expect(studioCodeScore(name, six, "Focus Features")).toBeLessThan(score - 0.25);
      expect(studioCodeScore(name, sinners, "Paramount")).toBe(0);
    }
  });

  it("picks the project from the code alone", () => {
    for (const name of [DIGITAL, "FFSS261574XH.mov"]) {
      const names = nameScores({ name, dirs: [] }, projects, studios);
      expect(chooseProject(names, new Map())?.item).toBe("ss");
    }
  });

  it("matches a remembered code at the start of a longer one", () => {
    expect(knownCode("FFSS261574XH.mov", ["FFSS26", "FF"])).toBe("FFSS26");
    expect(knownCode("STF_In_Theater.mov", ["STF"])).toBe("STF");
    expect(knownCode("STFX_In_Theater.mov", ["ST"])).toBeUndefined(); // too short to trust as a prefix
  });
});

describe("Focus names", () => {
  it("finds the asset despite the code", () => {
    const [best, next] = rankAssets({ name: DIGITAL, dirs: [], duration: 30, mediaType: "video" }, [forLove, ambition, ambitionTv], catalog.types, catalog, sense);
    expect(best.item._id).toBe("a1");
    // Enough to pick it on its own (the app's ASSET_THRESHOLD is 0.45).
    expect(best.score).toBeGreaterThan(0.5);
    expect(best.score - (next?.score ?? 0)).toBeGreaterThan(0.2);
  });

  it("names a digital spot ENG", () => {
    const p = propose(item(DIGITAL), { catalog, projects, project: sense, asset: forLove });
    expect(p.name).toMatch(/^SENSEANDSENSIBILITY_DIGITAL-SPOTS_FOR-LOVE-REVIEW-DIGITAL-30_ENG_TXTD_.*PRORES/);
  });

  it("names a US TV spot ENG-US", () => {
    const p = propose(item("FFSS261574XH.mov"), { catalog, projects, project: sense, asset: ambitionTv });
    expect(p.name).toMatch(/_ENG-US_/);
  });

  it("names zips as collects only where the convention is on", () => {
    const zip = item("FFSS26_Ambition_Digital_53_Vertical.zip");
    const rows: ConventionRow[] = [{ scope: "studio", targetId: FOCUS, values: { zipCollect: true }, updatedBy: "x", at: 0 }];
    expect(propose(zip, { catalog, projects, project: sense, asset: ambition, conventions: conventionsFor(sense, rows) }).name).toBe(
      "SENSEANDSENSIBILITY_DIGITAL-SPOTS_AMBITION-DIGITAL-53-VERTICAL_ENG_COLLECT.zip",
    );
    expect(propose(zip, { catalog, projects, project: sense, asset: ambition }).name).not.toMatch(/COLLECT/);
  });

  it("lets a project override its studio", () => {
    const rows: ConventionRow[] = [
      { scope: "studio", targetId: FOCUS, values: { zipCollect: true }, updatedBy: "x", at: 0 },
      { scope: "project", targetId: "ss", values: { zipCollect: false }, updatedBy: "x", at: 0 },
    ];
    expect(conventionsFor(sense, rows).zipCollect).toBe(false);
    expect(conventionsFor(six, rows).zipCollect).toBe(true);
  });
});
