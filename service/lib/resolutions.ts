// Team memory: how renamed files were resolved (and whether the first guess was right).
// - Lookups let the next person's app place similar files without AI.
// - Misses (no guess, or a guess someone corrected) show where the rules need work.
import { z } from "zod";
import { database } from "./db";
import type { Caller } from "./pixwel";

export const SOURCES = ["drop", "prefix", "learned", "fuzzy", "team", "ai", "manual"] as const;

const Guess = z.object({
  projectId: z.string().max(64).nullish(),
  assetId: z.string().max(64).nullish(),
  source: z.enum(SOURCES).nullish(),
  score: z.number().min(0).max(1).nullish(),
});

export const RecordRequest = z.object({
  resolutions: z
    .array(
      z.object({
        name: z.string().min(1).max(400),
        dirs: z.array(z.string().max(200)).max(12).default([]),
        projectId: z.string().min(1).max(64),
        assetId: z.string().max(64).nullish(),
        /** How the final project was chosen. */
        source: z.enum(SOURCES),
        /** What Pixname guessed before anyone touched it (absent when it couldn't guess). */
        guess: Guess.nullish(),
      }),
    )
    .min(1)
    .max(500),
});

export const LookupRequest = z.object({ names: z.array(z.string().min(1).max(400)).min(1).max(500) });

// Delivery words say how a file was exported, not what it is; they'd make variants look different.
const NOISE = new Set([
  "mov", "mp4", "mxf", "prores", "proreshq", "pro", "res", "hq", "lt", "422", "4444", "h264", "264", "hevc",
  "txtd", "txtl", "txtls", "texted", "textless", "txted", "intl", "stereo", "mono", "audio", "split", "splits",
  "narr", "dx", "mx", "fx", "sfx", "5", "1", "51", "2398", "23976", "2997", "25", "24", "final", "v", "rev",
  "the", "a", "an", "of", "and", "flat", "scope", "2k", "4k", "k", "uhd", "hd",
]);

/** Comparable words of a file name: camelCase split, lowercased, delivery words and sequence numbers dropped. */
export function nameKey(name: string): string[] {
  const words = (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
      .toLowerCase()
      // Aspect ratios stay whole ("9x16"); otherwise letters and digits are separate words ("res422hq").
      .match(/\d+x\d+|[a-z]+|\d+/g) ?? []
  ).filter((w) => !NOISE.has(w) && !/^\d{4,}$/.test(w));
  return [...new Set(words)];
}

/**
 * How alike two names' words are, 0..1. Mostly plain overlap (Jaccard); variants of one asset
 * ("Tug of War Green Box" / "Tug of War White Box ONLY") also count by how much of the shorter
 * name the longer one contains, discounted, and only for names of 3+ words so short generic
 * names don't match everything.
 */
export function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  const shared = a.filter((w) => B.has(w)).length;
  const jaccard = shared / (a.length + b.length - shared);
  const shorter = Math.min(a.length, b.length);
  const containment = shorter >= 3 ? 0.85 * (shared / shorter) : 0;
  return Math.max(jaccard, containment);
}

/**
 * A miss: Pixname had no guess, or its guess was changed by hand. Files dropped onto a project or
 * asset aren't misses; the person told Pixname where they belong.
 */
export function isMiss(r: { source: string; projectId: string; assetId?: string | null; guess?: { projectId?: string | null; assetId?: string | null } | null }) {
  if (r.source === "drop") return false;
  if (!r.guess?.projectId) return true;
  return r.guess.projectId !== r.projectId || (r.guess.assetId ?? null) !== (r.assetId ?? null);
}

export async function recordResolutions(caller: Caller, rows: z.infer<typeof RecordRequest>["resolutions"]) {
  const db = await database();
  const now = Math.floor(Date.now() / 1000);
  await db.batch(
    rows.map((r) => ({
      sql: `INSERT INTO resolutions
              (env, user_id, name, name_key, dirs, project_id, asset_id, source,
               guess_project_id, guess_asset_id, guess_source, guess_score, missed, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        caller.env,
        caller.userId,
        r.name,
        nameKey(r.name).join(" "),
        JSON.stringify(r.dirs),
        r.projectId,
        r.assetId ?? null,
        r.source,
        r.guess?.projectId ?? null,
        r.guess?.assetId ?? null,
        r.guess?.source ?? null,
        r.guess?.score ?? null,
        isMiss(r) ? 1 : 0,
        now,
      ],
    })),
    "write",
  );
}

export interface TeamMatch {
  name: string;
  projectId: string;
  assetId: string | null;
  /** How alike the names are, 0..1; 1 is the same name. */
  similarity: number;
  /** How many renames agree on this answer, and from how many people. */
  votes: number;
  people: number;
  /** The previous file it's based on. */
  example: string;
}

/** For each name, the answer the team gave most often for the most similar earlier file. */
export async function lookup(caller: Caller, names: string[], minSimilarity = 0.6): Promise<(TeamMatch | null)[]> {
  const db = await database();
  // Recent history is plenty for a team; keeps this a single cheap query.
  const { rows } = await db.execute({
    sql: `SELECT name, name_key, project_id, asset_id, user_id FROM resolutions
          WHERE env = ? ORDER BY created_at DESC LIMIT 5000`,
    args: [caller.env],
  });
  const history = rows.map((r) => ({
    name: String(r.name),
    key: String(r.name_key).split(" ").filter(Boolean),
    projectId: String(r.project_id),
    assetId: r.asset_id === null ? null : String(r.asset_id),
    userId: String(r.user_id),
  }));

  return names.map((name) => {
    const key = nameKey(name);
    let best = 0;
    for (const h of history) best = Math.max(best, h.name === name ? 1 : similarity(key, h.key));
    if (best < minSimilarity) return null;
    // Among the closest earlier files, the answer most people agreed on.
    const close = history.filter((h) => (h.name === name ? 1 : similarity(key, h.key)) >= best - 0.05);
    const tally = new Map<string, { projectId: string; assetId: string | null; votes: number; people: Set<string>; example: string }>();
    for (const h of close) {
      const k = `${h.projectId}/${h.assetId ?? ""}`;
      const t = tally.get(k) ?? { projectId: h.projectId, assetId: h.assetId, votes: 0, people: new Set<string>(), example: h.name };
      t.votes++;
      t.people.add(h.userId);
      tally.set(k, t);
    }
    const top = [...tally.values()].sort((a, b) => b.people.size - a.people.size || b.votes - a.votes)[0];
    return {
      name,
      projectId: top.projectId,
      assetId: top.assetId,
      similarity: Math.round(best * 100) / 100,
      votes: top.votes,
      people: top.people.size,
      example: top.example,
    };
  });
}

/** Where matching needs work: how files were resolved, how often guesses missed, and recent misses. */
export async function insights(caller: Caller, days = 30) {
  const db = await database();
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const [bySource, aiAccuracy, misses] = await db.batch(
    [
      {
        sql: `SELECT source, COUNT(*) AS files, SUM(missed) AS missed FROM resolutions
              WHERE env = ? AND created_at >= ? GROUP BY source ORDER BY files DESC`,
        args: [caller.env, since],
      },
      {
        sql: `SELECT COUNT(*) AS suggested, SUM(CASE WHEN missed = 0 THEN 1 ELSE 0 END) AS kept FROM resolutions
              WHERE env = ? AND created_at >= ? AND guess_source = 'ai'`,
        args: [caller.env, since],
      },
      {
        sql: `SELECT name, dirs, project_id, asset_id, source, guess_project_id, guess_asset_id, guess_source, guess_score, created_at
              FROM resolutions WHERE env = ? AND created_at >= ? AND missed = 1 ORDER BY created_at DESC LIMIT 200`,
        args: [caller.env, since],
      },
    ],
    "read",
  );
  return {
    days,
    bySource: bySource.rows.map((r) => ({ source: String(r.source), files: Number(r.files), missed: Number(r.missed ?? 0) })),
    ai: { suggested: Number(aiAccuracy.rows[0]?.suggested ?? 0), kept: Number(aiAccuracy.rows[0]?.kept ?? 0) },
    misses: misses.rows.map((r) => ({
      name: String(r.name),
      dirs: JSON.parse(String(r.dirs ?? "[]")) as string[],
      projectId: String(r.project_id),
      assetId: r.asset_id === null ? null : String(r.asset_id),
      source: String(r.source),
      guess: r.guess_project_id
        ? { projectId: String(r.guess_project_id), assetId: r.guess_asset_id === null ? null : String(r.guess_asset_id), source: String(r.guess_source), score: Number(r.guess_score) }
        : null,
      at: Number(r.created_at),
    })),
  };
}
