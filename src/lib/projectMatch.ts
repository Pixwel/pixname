// Choosing a project for a file from several independent signals:
//   - the name/folders mention the project (rankProjects)
//   - a vendor code abbreviates it ("STF" -> Street Fighter)
//   - the file's words match an asset that lives in it (cross-project asset search)
// Each signal alone may be weak or ambiguous; together they usually agree.
import { abbrevScore, vendorCode } from "./abbrev";
import { looseHints, rankAssets, rankProjects, type FileFacts, type Scored } from "./fuzzy";
import { findTag } from "./parse";
import type { Asset, Catalog, Project } from "./types";

/**
 * A code that clearly abbreviates one project ("STF" -> Street Fighter) is enough for a guess,
 * shown as such. Ties ("SF": Street Fighter / Sin Fronteras) fall under the ambiguity margin,
 * and real asset evidence for another project still outweighs a code.
 */
const ABBREV_WEIGHT = 0.75;
const EVIDENCE_WEIGHT = 0.9;
export const PROJECT_THRESHOLD = 0.6;
/** When the top two are this close, the guess is too ambiguous to apply automatically. */
const AMBIGUITY_MARGIN = 0.1;

/** Name, folder and vendor-code scores per project id. */
export function nameScores(facts: FileFacts, projects: Project[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const { item, score } of rankProjects(facts, projects)) scores.set(item._id, score);
  const codes = [vendorCode(facts.name), ...facts.dirs.slice(0, 2).map(vendorCode)].filter(Boolean) as string[];
  for (const code of codes) {
    for (const project of projects) {
      const a = abbrevScore(code, project) * ABBREV_WEIGHT;
      if (a > (scores.get(project._id) ?? 0)) scores.set(project._id, a);
    }
  }
  return scores;
}

/**
 * Queries for a cross-project asset search (the API matches them as substrings of asset names):
 * - the file name's underscore sections, which are often the asset name itself ("Tug of War")
 * - the longest distinctive words, which survive misspellings in the rest of the section
 * The vendor code, tags (PRORES, FLAT) and numbers are skipped.
 */
export function searchQueries(fileName: string, catalog: Catalog, max = 4): string[] {
  const base = fileName.replace(/\.[^.]+$/, "");
  const code = vendorCode(fileName);
  const meaningful = (text: string) => looseHints(text, catalog, true).content.filter((t) => !/^\d+$/.test(t));

  const sections = base
    .split("_")
    .map((p) => p.trim().replace(/\s+/g, " "))
    .filter((p) => p && p !== code && !findTag(catalog.tags, p) && meaningful(p).length > 0)
    .slice(0, 2);
  const words = looseHints(fileName, catalog)
    .content.filter((t) => t !== code?.toLowerCase() && t.length >= 3 && !/^\d+$/.test(t) && !findTag(catalog.tags, t))
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);

  const seen = new Set<string>();
  return [...sections, ...words].filter((q) => {
    const key = q.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, max);
}

/** Best asset match per project id, from assets found by a cross-project search. */
export function assetEvidence(facts: FileFacts, assets: Asset[], catalog: Catalog): Map<string, { score: number; asset: Asset }> {
  const byProject = new Map<string, { score: number; asset: Asset }>();
  for (const { item, score } of rankAssets(facts, assets, catalog.types, catalog)) {
    const projectId = typeof item.project === "string" ? item.project : item.project?._id;
    if (!projectId) continue;
    if (score > (byProject.get(projectId)?.score ?? 0)) byProject.set(projectId, { score, asset: item });
  }
  return byProject;
}

/** Combine signals (noisy-OR) and pick a project only if it clearly wins. */
export function chooseProject(
  names: Map<string, number>,
  evidence: Map<string, { score: number }>,
): Scored<string> | undefined {
  const ids = new Set([...names.keys(), ...evidence.keys()]);
  const ranked = [...ids]
    .map((id) => {
      const n = names.get(id) ?? 0;
      const e = (evidence.get(id)?.score ?? 0) * EVIDENCE_WEIGHT;
      return { item: id, score: Math.min(0.99, 1 - (1 - n) * (1 - e)) };
    })
    .sort((a, b) => b.score - a.score);
  const [best, second] = ranked;
  if (!best || best.score < PROJECT_THRESHOLD) return undefined;
  if (second && best.score - second.score < AMBIGUITY_MARGIN && best.score < 0.9) return undefined;
  return best;
}

