import { describe, expect, it } from "vitest";
import { abbrevScore, vendorCode } from "../abbrev";
import type { Project } from "../types";

const p = (name: string, filePrefix = name.toUpperCase().replace(/[^A-Z0-9]/g, "")): Project => ({
  _id: name, name, slug: name.toLowerCase(), filePrefix,
});

const streetFighter = p("Street Fighter");
const pawPatrol3 = p("Paw Patrol 3");
const pawPatrolMovie = p("Paw Patrol: The Mighty Movie", "PAWPATROL2");
const sinFronteras = p("Sin Fronteras");
const superFan = p("The Super Fan");
const hazbin = p("Hazbin Hotel", "HZBN");
const projects = [streetFighter, pawPatrol3, pawPatrolMovie, sinFronteras, superFan, hazbin, p("Focker In-Law"), p("Inside Out")];

const rank = (code: string) =>
  projects.map((proj) => ({ name: proj.name, score: abbrevScore(code, proj) })).sort((a, b) => b.score - a.score);

describe("vendorCode", () => {
  it("takes a short all-caps leading chunk", () => {
    expect(vendorCode("STF_In_Theater_Ettiquette_2K_FLAT.mov")).toBe("STF");
    expect(vendorCode("PP3_Paw Patrol Pups ADR Session.mov")).toBe("PP3");
    expect(vendorCode("0080_Tug of War_No Box.mov")).toBe("0080");
    expect(vendorCode("Chun Li vert 30.mov")).toBeUndefined();
    expect(vendorCode("STREETFIGHTER_SOCIAL_X.mov")).toBeUndefined(); // longer than a code
  });
});

describe("abbrevScore", () => {
  it("prefers initials that start every word", () => {
    expect(abbrevScore("SF", streetFighter)).toBeGreaterThan(0.9);
    expect(abbrevScore("STF", streetFighter)).toBeGreaterThan(0.7);
    expect(abbrevScore("FH", streetFighter)).toBe(0);
  });

  it("ranks the intended project first", () => {
    expect(rank("STF")[0].name).toBe("Street Fighter");
    expect(rank("PP3")[0].name).toBe("Paw Patrol 3");
    expect(rank("HZBN")[0].name).toBe("Hazbin Hotel");
  });

  it("uses sequel numbers", () => {
    expect(abbrevScore("PP3", pawPatrol3)).toBeGreaterThan(abbrevScore("PP3", pawPatrolMovie));
  });

  it("skips leading articles", () => {
    expect(abbrevScore("SF", superFan)).toBeGreaterThan(0.9);
  });

  it("leaves genuinely ambiguous initials tied", () => {
    // SF fits Street Fighter, Sin Fronteras and The Super Fan equally; other evidence must decide.
    const top = rank("SF").slice(0, 3).map((r) => r.score);
    expect(Math.max(...top) - Math.min(...top)).toBeLessThan(0.05);
  });
});
