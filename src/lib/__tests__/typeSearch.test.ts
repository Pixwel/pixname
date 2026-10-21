import { describe, expect, it } from "vitest";
import { FALLBACK_CATALOG as catalog } from "../api";
import { FREQUENT_MAX, groupTypes, typeMatches } from "../typeSearch";

const type = (name: string) => catalog.types.find((t) => t.name === name)!;
const names = (ts: { name: string }[]) => ts.map((t) => t.name);

describe("typeMatches", () => {
  it("matches every word anywhere in the name", () => {
    expect(typeMatches(type("film-clip.intl"), "clip intl")).toBe(true);
    expect(typeMatches(type("film-clip.intl"), "clip us")).toBe(false);
  });

  it("matches the file token", () => {
    expect(typeMatches(type("living-one-sheet"), "LOS")).toBe(true);
  });
});

describe("groupTypes", () => {
  it("puts used types first, most used on top, the rest A–Z", () => {
    const { frequent, rest } = groupTypes(catalog.types, "", { epk: 1, "b-roll": 5 });
    expect(names(frequent)).toEqual(["b-roll", "epk"]);
    expect(rest).toHaveLength(catalog.types.length - 2);
    expect(names(rest)).toEqual([...names(rest)].sort((a, b) => a.localeCompare(b)));
  });

  it("caps the frequent group", () => {
    const uses = Object.fromEntries(catalog.types.map((t) => [t.name, 1]));
    expect(groupTypes(catalog.types, "", uses).frequent).toHaveLength(FREQUENT_MAX);
  });

  it("filters both groups by the query", () => {
    const { frequent, rest } = groupTypes(catalog.types, "film clip", { "film-clip.us": 3, epk: 9 });
    expect(names(frequent)).toEqual(["film-clip.us"]);
    expect(names(rest)).toEqual(["film-clip.home-video", "film-clip.intl"]);
  });
});
