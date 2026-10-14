// Team memory: how renamed files were resolved (and whether the first guess was right).
// - Lookups let the next person's app place similar files without AI.
// - Misses (no guess, or a guess someone corrected) show where the rules need work.
import { z } from "zod";
import { database } from "./db";
import { requireAdmin, type Caller } from "./pixwel";

export const SOURCES = ["drop", "prefix", "learned", "rule", "fuzzy", "team", "ai", "manual"] as const;

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
        /** The new name, for history and "already delivered". */
        newName: z.string().max(400).nullish(),
        size: z.number().int().nonnegative().nullish(),
        durationSec: z.number().nonnegative().nullish(),
        /** Content fingerprint from the app (size + start/end of the file), to spot re-deliveries. */
        fingerprint: z.string().max(128).nullish(),
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
              (env, user_id, user_name, name, new_name, size, duration, fingerprint, name_key, dirs, project_id, asset_id, source,
               guess_project_id, guess_asset_id, guess_source, guess_score, missed, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        caller.env,
        caller.userId,
        caller.userName,
        r.name,
        r.newName ?? null,
        r.size ?? null,
        r.durationSec ?? null,
        r.fingerprint ?? null,
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
  /** The previous file it's based on (only an admin's or your own). */
  example: string | null;
}

/** For each name, the answer the team gave most often for the most similar earlier file. */
export async function lookup(caller: Caller, names: string[], minSimilarity = 0.6): Promise<(TeamMatch | null)[]> {
  const db = await database();
  // Recent history is plenty for a team; keeps this a single cheap query.
  const { rows } = await db.execute({
    sql: `SELECT name, name_key, project_id, asset_id, user_id FROM resolutions
          WHERE env = ? AND undone_at IS NULL ORDER BY created_at DESC LIMIT 5000`,
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
    const tally = new Map<string, { projectId: string; assetId: string | null; votes: number; people: Set<string>; example: string | null }>();
    for (const h of close) {
      const k = `${h.projectId}/${h.assetId ?? ""}`;
      // Other people's file names are only shown to admins.
      const example = caller.isAdmin || h.userId === caller.userId ? h.name : null;
      const t = tally.get(k) ?? { projectId: h.projectId, assetId: h.assetId, votes: 0, people: new Set<string>(), example };
      t.example ??= example;
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
  requireAdmin(caller);
  const db = await database();
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const [bySource, aiAccuracy, misses] = await db.batch(
    [
      {
        sql: `SELECT source, COUNT(*) AS files, SUM(missed) AS missed FROM resolutions
              WHERE env = ? AND undone_at IS NULL AND created_at >= ? GROUP BY source ORDER BY files DESC`,
        args: [caller.env, since],
      },
      {
        sql: `SELECT COUNT(*) AS suggested, SUM(CASE WHEN missed = 0 THEN 1 ELSE 0 END) AS kept FROM resolutions
              WHERE env = ? AND undone_at IS NULL AND created_at >= ? AND guess_source = 'ai'`,
        args: [caller.env, since],
      },
      {
        sql: `SELECT name, dirs, project_id, asset_id, source, guess_project_id, guess_asset_id, guess_source, guess_score, created_at
              FROM resolutions WHERE env = ? AND undone_at IS NULL AND created_at >= ? AND missed = 1 ORDER BY created_at DESC LIMIT 200`,
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

// ---------------------------------------------------------------------------------------------
// Activity: history, stats and "already delivered". Everyone on the team sees everything.

export const HistoryQuery = z.object({
  q: z.string().max(200).optional(),
  userId: z.string().max(64).optional(),
  projectId: z.string().max(64).optional(),
  source: z.enum(SOURCES).optional(),
  missedOnly: z.coerce.boolean().optional(),
  /** Rows older than this id (for paging). */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export interface HistoryRow {
  id: number;
  at: number;
  userId: string;
  userName: string;
  name: string;
  newName: string | null;
  dirs: string[];
  projectId: string;
  assetId: string | null;
  source: string;
  guess: { projectId: string; assetId: string | null; source: string; score: number } | null;
  missed: boolean;
  /** When the rename was undone; undone renames don't count in stats, team memory or votes. */
  undoneAt: number | null;
  size: number | null;
  durationSec: number | null;
}

const toHistory = (r: Record<string, unknown>): HistoryRow => ({
  id: Number(r.id),
  at: Number(r.created_at),
  userId: String(r.user_id),
  userName: String(r.user_name || "Unknown"),
  name: String(r.name),
  newName: r.new_name == null ? null : String(r.new_name),
  dirs: JSON.parse(String(r.dirs ?? "[]")) as string[],
  projectId: String(r.project_id),
  assetId: r.asset_id == null ? null : String(r.asset_id),
  source: String(r.source),
  guess: r.guess_project_id
    ? {
        projectId: String(r.guess_project_id),
        assetId: r.guess_asset_id == null ? null : String(r.guess_asset_id),
        source: String(r.guess_source),
        score: Number(r.guess_score),
      }
    : null,
  missed: Number(r.missed) === 1,
  undoneAt: r.undone_at == null ? null : Number(r.undone_at),
  size: r.size == null ? null : Number(r.size),
  durationSec: r.duration == null ? null : Number(r.duration),
});

/** Every rename, newest first; searchable by old or new name. */
export async function history(caller: Caller, q: z.infer<typeof HistoryQuery>): Promise<{ rows: HistoryRow[]; more: boolean }> {
  const db = await database();
  const where = ["env = ?"];
  const args: (string | number)[] = [caller.env];
  if (q.q?.trim()) {
    where.push("(name LIKE ? ESCAPE '\\' OR new_name LIKE ? ESCAPE '\\')");
    const like = `%${q.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    args.push(like, like);
  }
  // Admins see everyone's renames; everyone else only their own.
  const userId = caller.isAdmin ? q.userId : caller.userId;
  if (userId) (where.push("user_id = ?"), args.push(userId));
  if (q.projectId) (where.push("project_id = ?"), args.push(q.projectId));
  if (q.source) (where.push("source = ?"), args.push(q.source));
  if (q.missedOnly) where.push("missed = 1 AND undone_at IS NULL");
  if (q.before) (where.push("id < ?"), args.push(q.before));
  const { rows } = await db.execute({
    sql: `SELECT * FROM resolutions WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`,
    args: [...args, q.limit + 1],
  });
  return { rows: rows.slice(0, q.limit).map((r) => toHistory(r as Record<string, unknown>)), more: rows.length > q.limit };
}

/** Totals for a period: per day, person, project and match source, plus how AI did. */
export async function stats(caller: Caller, days = 30) {
  const db = await database();
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  // Admins see the whole team; everyone else only their own numbers.
  const mine = caller.isAdmin ? "" : " AND user_id = ?";
  const args = caller.isAdmin ? [caller.env, since] : [caller.env, since, caller.userId];
  const [totals, perDay, perUser, perProject, perSource, ai] = await db.batch(
    [
      { sql: `SELECT COUNT(*) AS files, COUNT(DISTINCT user_id) AS people, SUM(missed) AS missed FROM resolutions WHERE env = ? AND undone_at IS NULL AND created_at >= ?${mine}`, args },
      {
        sql: `SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS files, SUM(missed) AS missed FROM resolutions
              WHERE env = ? AND undone_at IS NULL AND created_at >= ?${mine} GROUP BY day ORDER BY day`,
        args,
      },
      {
        sql: `SELECT user_id, MAX(user_name) AS user_name, COUNT(*) AS files, SUM(missed) AS missed, MAX(created_at) AS last
              FROM resolutions WHERE env = ? AND undone_at IS NULL AND created_at >= ?${mine} GROUP BY user_id ORDER BY files DESC`,
        args,
      },
      {
        sql: `SELECT project_id, COUNT(*) AS files, SUM(missed) AS missed, MAX(created_at) AS last
              FROM resolutions WHERE env = ? AND undone_at IS NULL AND created_at >= ?${mine} GROUP BY project_id ORDER BY files DESC LIMIT 50`,
        args,
      },
      { sql: `SELECT source, COUNT(*) AS files FROM resolutions WHERE env = ? AND undone_at IS NULL AND created_at >= ?${mine} GROUP BY source ORDER BY files DESC`, args },
      {
        sql: `SELECT COUNT(*) AS suggested, SUM(CASE WHEN missed = 0 THEN 1 ELSE 0 END) AS kept FROM resolutions
              WHERE env = ? AND undone_at IS NULL AND created_at >= ?${mine} AND guess_source = 'ai'`,
        args,
      },
    ],
    "read",
  );
  const n = (v: unknown) => Number(v ?? 0);
  return {
    days,
    scope: caller.isAdmin ? ("team" as const) : ("mine" as const),
    files: n(totals.rows[0]?.files),
    people: n(totals.rows[0]?.people),
    missed: n(totals.rows[0]?.missed),
    perDay: perDay.rows.map((r) => ({ day: String(r.day), files: n(r.files), missed: n(r.missed) })),
    perUser: perUser.rows.map((r) => ({ userId: String(r.user_id), userName: String(r.user_name || "Unknown"), files: n(r.files), missed: n(r.missed), last: n(r.last) })),
    perProject: perProject.rows.map((r) => ({ projectId: String(r.project_id), files: n(r.files), missed: n(r.missed), last: n(r.last) })),
    bySource: perSource.rows.map((r) => ({ source: String(r.source), files: n(r.files) })),
    ai: { suggested: n(ai.rows[0]?.suggested), kept: n(ai.rows[0]?.kept) },
  };
}

export const SeenRequest = z.object({
  files: z
    .array(
      z.object({
        name: z.string().max(400),
        fingerprint: z.string().max(128).nullish(),
        size: z.number().int().nonnegative().nullish(),
        durationSec: z.number().nonnegative().nullish(),
      }),
    )
    .min(1)
    .max(500),
});

/**
 * Files someone already renamed: the same fingerprint, or failing that the same size and running time.
 * A file's own earlier rename (its current name is the recorded new name) doesn't count.
 */
export async function seen(caller: Caller, files: z.infer<typeof SeenRequest>["files"]): Promise<(HistoryRow | null)[]> {
  const db = await database();
  // Admins are warned about anyone's earlier rename; everyone else about their own.
  const mine = caller.isAdmin ? "" : " AND user_id = ?";
  const own = caller.isAdmin ? [] : [caller.userId];
  return Promise.all(
    files.map(async (f) => {
      const byFingerprint = f.fingerprint
        ? await db.execute({
            sql: `SELECT * FROM resolutions WHERE env = ? AND undone_at IS NULL AND fingerprint = ? AND COALESCE(new_name, '') != ?${mine}
                  ORDER BY id DESC LIMIT 1`,
            args: [caller.env, f.fingerprint, f.name, ...own],
          })
        : undefined;
      let row = byFingerprint?.rows[0];
      if (!row && f.size && f.durationSec) {
        const r = await db.execute({
          sql: `SELECT * FROM resolutions WHERE env = ? AND undone_at IS NULL AND size = ? AND ABS(duration - ?) < 0.05 AND COALESCE(new_name, '') != ?${mine}
                ORDER BY id DESC LIMIT 1`,
          args: [caller.env, f.size, f.durationSec, f.name, ...own],
        });
        row = r.rows[0];
      }
      return row ? toHistory(row as Record<string, unknown>) : null;
    }),
  );
}

export const UndoRequest = z.object({
  renames: z
    .array(z.object({ name: z.string().min(1).max(400), newName: z.string().min(1).max(400) }))
    .min(1)
    .max(500),
});

/**
 * Renames the caller undid: their latest matching rename of each file is marked undone (kept in
 * history, dropped from stats, team memory and suggestions), and its vendor-code vote taken back.
 */
export async function undoRenames(caller: Caller, renames: z.infer<typeof UndoRequest>["renames"]) {
  const db = await database();
  const now = Math.floor(Date.now() / 1000);
  let undone = 0;
  for (const { name, newName } of renames) {
    const { rows } = await db.execute({
      sql: `SELECT id, project_id FROM resolutions
            WHERE env = ? AND user_id = ? AND name = ? AND new_name = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1`,
      args: [caller.env, caller.userId, name, newName],
    });
    const row = rows[0];
    if (!row) continue;
    const code = name.split(/[_\s.]/)[0] ?? "";
    await db.batch(
      [
        { sql: `UPDATE resolutions SET undone_at = ? WHERE id = ?`, args: [now, Number(row.id)] },
        ...(/^[A-Z0-9]{2,6}$/.test(code) && !/^\d+$/.test(code)
          ? [
              {
                sql: `UPDATE code_votes SET count = MAX(count - 1, 0), updated_at = ?
                      WHERE env = ? AND code = ? AND project_id = ? AND user_id = ?`,
                args: [now, caller.env, code, String(row.project_id), caller.userId],
              },
            ]
          : []),
      ],
      "write",
    );
    undone++;
  }
  return undone;
}
