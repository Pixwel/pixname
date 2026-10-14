// Choosing a project for a file from several independent signals:
//   - the name/folders mention the project (rankProjects)
//   - a vendor code abbreviates it ("STF" -> Street Fighter)
//   - the file's words match an asset that lives in it (cross-project asset search)
// Each signal alone may be weak or ambiguous; together they usually agree.
import { abbrevScore, vendorCode } from "./abbrev";
import { looseHints, rankAssets, rankProjects, tokenize, type FileFacts, type Scored } from "./fuzzy";
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
/** When the top two are this close, the guess is too ambiguous to apply automatically… */
const AMBIGUITY_MARGIN = 0.1;
/** …unless one is clearly newer: current work beats old projects ("Tug of War" in 2026 vs 2020). */
const RECENCY_GAP_SECONDS = 180 * 24 * 60 * 60;

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
export function searchQueries(fileName: string, catalog: Catalog, max = 5): string[] {
  const base = fileName.replace(/\.[^.]+$/, "");
  const code = vendorCode(fileName);
  const words = (text: string) =>
    looseHints(text, catalog, true).content.filter((t) => !/^\d+$/.test(t) && !findTag(catalog.tags, t));

  const queries: string[] = [];
  for (const section of base.split("_").filter((p) => p.trim() && p !== code).slice(0, 2)) {
    const w = words(section);
    if (!w.length) continue;
    // Spaced out ("AvaMaxCallout" -> "ava max callout"), and the leading pair ("ava max"),
    // since asset names often continue past what the vendor wrote.
    queries.push(tokenize(section).join(" "));
    if (w.length >= 3) queries.push(w.slice(0, 2).join(" "));
  }
  queries.push(
    ...words(base)
      .filter((t) => t !== code?.toLowerCase() && t.length >= 3)
      .sort((a, b) => b.length - a.length)
      .slice(0, 2),
  );

  const seen = new Set<string>();
  return queries
    .filter((q) => q.length >= 3 && !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase()))
    .slice(0, max);
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
  created: Map<string, number> = new Map(),
): Scored<string> | undefined {
  const ids = new Set([...names.keys(), ...evidence.keys()]);
  const ranked = [...ids]
    .map((id) => {
      const n = names.get(id) ?? 0;
      const e = (evidence.get(id)?.score ?? 0) * EVIDENCE_WEIGHT;
      return { item: id, score: Math.min(0.99, 1 - (1 - n) * (1 - e)) };
    })
    .sort((a, b) => b.score - a.score);
  const [best] = ranked;
  if (!best || best.score < PROJECT_THRESHOLD) return undefined;
  const tied = ranked.filter((r) => best.score - r.score < AMBIGUITY_MARGIN);
  // (Exact file prefixes and remembered codes are settled before this, so a near-tie here is real.)
  if (tied.length === 1) return best;

  // A near-tie goes to the newest project, if it's clearly newer than every other contender.
  const age = (r: Scored<string>) => created.get(r.item) ?? 0;
  const [newest, ...others] = [...tied].sort((a, b) => age(b) - age(a));
  const clearlyNewer = others.every((o) => age(newest) - age(o) >= RECENCY_GAP_SECONDS);
  return newest.score >= PROJECT_THRESHOLD && age(newest) > 0 && clearlyNewer ? newest : undefined;
}

/** Two independent clues about the same project (noisy-OR). */
export const combine = (a: number, b: number) => 1 - (1 - a) * (1 - b);

interface CodeVotes {
  projectId: string;
  votes: number;
  people: number;
}

/**
 * How strongly a remembered vendor code points at each project. A code used for one project by
 * several people is strong; one person's single rename is a hint; a vendor's own code that turns up
 * across projects ("FH") splits its weight. Local remembered codes count as one person's vote.
 */
export function codeStrengths(local: string | undefined, shared: CodeVotes[] = []): Map<string, number> {
  const all = [...shared];
  if (local && !all.some((c) => c.projectId === local)) all.push({ projectId: local, votes: 1, people: 1 });
  const total = all.reduce((n, c) => n + c.votes, 0);
  const strengths = new Map<string, number>();
  for (const c of all) strengths.set(c.projectId, 0.95 * (c.votes / total) * (1 - 0.5 ** c.people));
  return strengths;
}

/** Team memory: how much an earlier, similar file's resolution counts. */
export const teamStrength = (t: { similarity: number; people: number }) => t.similarity * (1 - 0.5 ** (t.people + 1));
