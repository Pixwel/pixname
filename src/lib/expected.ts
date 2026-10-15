// Expected assets: names a team knows are coming (from a delivery doc or spreadsheet) but that
// aren't in Pixwel yet. Pasted per project, they match and name files exactly like real assets.
import type { Asset } from "./types";

export const EXPECTED_PREFIX = "expected:";

export const isExpected = (assetId?: string | null) => !!assetId && assetId.startsWith(EXPECTED_PREFIX);

/** The platform's asset slug: lowercase words joined by dashes, accents and apostrophes dropped. */
export function slugOf(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Asset names from pasted text: one per line. Spreadsheet rows keep their first cell, and list
 * bullets or numbering are dropped. Repeats (by slug) are kept once.
 */
export function parseExpectedNames(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    let name = line.split("\t").map((c) => c.trim()).find(Boolean) ?? "";
    // A spreadsheet quotes a whole cell that contains quotes: "Curtis ""50 Cent"" Jackson".
    if (/^".*"$/.test(name)) name = name.slice(1, -1).replace(/""/g, '"');
    name = name.replace(/^(?:[-*•·]|\d+[.)])\s+/, "").trim();
    const slug = slugOf(name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    names.push(name);
  }
  return names;
}

export function expectedAsset(projectId: string, name: string, type: string, addedBy?: string): Asset {
  const slug = slugOf(name);
  return { _id: `${EXPECTED_PREFIX}${projectId}:${slug}`, name, slug, type, project: projectId, expected: true, addedBy };
}

/** A project's assets plus the expected ones Pixwel doesn't have yet (a real asset with the same slug wins). */
export function withExpected(real: Asset[], expected: Asset[] = []): Asset[] {
  const slugs = new Set(real.map((a) => a.slug));
  return [...real, ...expected.filter((a) => !slugs.has(a.slug))].sort(
    (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
  );
}
