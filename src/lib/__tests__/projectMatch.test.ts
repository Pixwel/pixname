import { describe, expect, it } from "vitest";
import { FALLBACK_CATALOG as catalog } from "../api";
import { assetEvidence, chooseProject, nameScores, searchQueries } from "../projectMatch";
import { rankAssets } from "../fuzzy";
import type { Asset, Project } from "../types";

const proj = (_id: string, name: string, filePrefix: string): Project => ({ _id, name, slug: _id, filePrefix });
const projects = [
  proj("sf", "Street Fighter", "STREETFIGHTER"),
  proj("sinf", "Sin Fronteras", "SINFRONTERAS"),
  proj("fan", "The Super Fan", "SUPERFAN"),
  proj("pp3", "Paw Patrol 3", "PAWPATROL3"),
  proj("io", "Inside Out", "INSIDEOUT"),
  proj("cine", "Cinemark Preshow", "CINEMARK"),
];
const asset = (_id: string, name: string, type: string, project: string, length = 30): Asset => ({
  _id, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), type, project, length, mediaType: "video",
});
// Everything a cross-project search might return.
const searchable = [
  asset("a1", "In Theater Etiquette", "in-theater", "sf"),
  asset("a2", "Andrew vs Noah: A Brotherhood Forged", "social", "sf"),
  asset("a3", "Tug of War", "social", "io"),
  asset("a4", "Theater Takeover", "in-theater", "sinf"),
  asset("a5", "Pups ADR Session", "featurette", "pp3"),
];

const decide = (name: string, withSearch = true) => {
  const facts = { name, dirs: [], duration: 30, mediaType: "video" };
  const evidence = withSearch ? assetEvidence(facts, searchable, catalog) : new Map();
  return chooseProject(nameScores(facts, projects), evidence)?.item;
};

describe("project matching from vendor codes and asset evidence", () => {
  it("searches name sections and distinctive words, skipping the code, tags and numbers", () => {
    const stf = searchQueries("STF_In_Theater_Ettiquette_2K_FLAT_30_Textless_5_1_Split_Audio_Prores.mov", catalog);
    expect(stf).toContain("ettiquette");
    expect(stf).not.toContain("STF");
    expect(stf.map((q) => q.toLowerCase())).not.toContain("flat");
    expect(searchQueries("0080_Tug of War_Green Box ONLY.mov", catalog)).toContain("Tug of War");
  });

  it("a section that is exactly an asset name is near-certain, despite variant words", () => {
    for (const variant of ["Green Box ONLY", "Green Box", "No Box", "White Box ONLY", "White Box"]) {
      const [best] = rankAssets({ name: `0080_Tug of War_${variant}.mov`, dirs: [] }, searchable, catalog.types, catalog);
      expect(best.item._id).toBe("a3");
      expect(best.score).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("STF + an Etiquette asset (misspelled in the file) -> Street Fighter", () => {
    expect(decide("STF_In_Theater_Ettiquette_2K_FLAT_30_Textless_5_1_Split_Audio_Prores.mov")).toBe("sf");
  });

  it("asset evidence beats a misleading vendor code", () => {
    // Same file, but the Etiquette asset lives in another project: STF must not drag it to Street Fighter.
    const moved = searchable.map((a) => (a._id === "a1" ? { ...a, project: "cine" } : a));
    const facts = { name: "STF_In_Theater_Ettiquette_30_INTL_16x9_Texted_Stereo_Audio_Prores.mov", dirs: [], duration: 30, mediaType: "video" };
    expect(chooseProject(nameScores(facts, projects), assetEvidence(facts, moved, catalog))?.item).toBe("cine");
  });

  it("a code that clearly fits one project is enough on its own", () => {
    expect(decide("STF_Something_Else.mov", false)).toBe("sf");
  });

  it("an ambiguous SF is settled by the asset it matches", () => {
    expect(decide("SF_AndrewVsNoah_ABrotherhoodForged_INTL_9x16_Prores.mov")).toBe("sf");
  });

  it("an ambiguous code with no supporting asset is left for the user", () => {
    expect(decide("SF_Something_Unrelated.mov", false)).toBeUndefined();
  });

  it("asset evidence alone can find the project", () => {
    expect(decide("0080_Tug of War_No Box.mov")).toBe("io");
  });

  it("code plus words in the name", () => {
    expect(decide("PP3_Paw Patrol Pups ADR Session_9x16 Textless ProResHQ 2398 Split Audio.mov")).toBe("pp3");
  });
});
