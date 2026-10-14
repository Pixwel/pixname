// Rules from the workbench. Asset rules say "a file name containing this phrase is this asset";
// suggestions come from misses (files Pixname couldn't place, or placed wrong) that keep
// resolving the same way, so a person can turn them into a rule with one click.
import { z } from "zod";
import { database } from "./db";
import { HttpError, requireAdmin, type Caller } from "./pixwel";
import { nameKey } from "./resolutions";

export const RuleRequest = z.object({
  /** Words that must all appear in a file name, e.g. "ava max callout". */
  phrase: z.string().min(2).max(120),
  projectId: z.string().min(1).max(64),
  assetId: z.string().min(1).max(64),
});

export interface AssetRule {
  id: number;
  phrase: string;
  /** The phrase's comparable words; a file matches when its name contains all of them. */
  words: string[];
  projectId: string;
  assetId: string;
  createdBy: string;
  at: number;
}

/** The phrase as the app and service compare it: same splitting as names, delivery words dropped. */
export const phraseWords = (phrase: string) => nameKey(`${phrase}.x`);

/** Everyone's matching uses the rules, so everyone can read them. */
export async function listRules(caller: Caller): Promise<AssetRule[]> {
  const db = await database();
  const { rows } = await db.execute({
    sql: `SELECT * FROM asset_rules WHERE env = ? ORDER BY phrase`,
    args: [caller.env],
  });
  return rows.map((r) => ({
    id: Number(r.id),
    phrase: String(r.phrase),
    words: phraseWords(String(r.phrase)),
    projectId: String(r.project_id),
    assetId: String(r.asset_id),
    createdBy: String(r.created_by_name || "Unknown"),
    at: Number(r.created_at),
  }));
}

export async function addRule(caller: Caller, rule: z.infer<typeof RuleRequest>) {
  requireAdmin(caller);
  const words = phraseWords(rule.phrase);
  if (!words.length) throw new HttpError(400, "That phrase has no distinctive words");
  const db = await database();
  await db.execute({
    sql: `INSERT INTO asset_rules (env, phrase, project_id, asset_id, created_by, created_by_name, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (env, phrase) DO UPDATE SET project_id = excluded.project_id, asset_id = excluded.asset_id,
            created_by = excluded.created_by, created_by_name = excluded.created_by_name, created_at = excluded.created_at`,
    args: [caller.env, words.join(" "), rule.projectId, rule.assetId, caller.userId, caller.userName, Math.floor(Date.now() / 1000)],
  });
}

export async function deleteRule(caller: Caller, id: number) {
  requireAdmin(caller);
  const db = await database();
  await db.execute({ sql: `DELETE FROM asset_rules WHERE env = ? AND id = ?`, args: [caller.env, id] });
}

export interface Suggestion {
  kind: "code" | "asset";
  /** The vendor code ("FH") or the phrase ("ava max callout"). */
  key: string;
  projectId: string;
  assetId: string | null;
  /** How many missed files resolved this way, and the share of all misses with this key. */
  files: number;
  share: number;
  examples: string[];
}

/**
 * Patterns in recent misses worth a rule:
 * - a vendor code whose misses keep landing in one project → "code" rule
 * - words shared by misses that keep landing on one asset → "asset" rule
 */
export async function suggestions(caller: Caller, days = 90, minFiles = 2): Promise<Suggestion[]> {
  requireAdmin(caller);
  const db = await database();
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const { rows } = await db.execute({
    sql: `SELECT name, project_id, asset_id FROM resolutions WHERE env = ? AND undone_at IS NULL AND created_at >= ? AND missed = 1 AND source != 'drop'
          ORDER BY id DESC LIMIT 2000`,
    args: [caller.env, since],
  });
  const misses = rows.map((r) => ({
    name: String(r.name),
    projectId: String(r.project_id),
    assetId: r.asset_id == null ? null : String(r.asset_id),
  }));
  const rules = new Set((await listRules(caller)).map((r) => r.phrase));
  const out: Suggestion[] = [];

  // Vendor codes: the leading all-caps/digit chunk, not a sequence number.
  const byCode = new Map<string, typeof misses>();
  for (const m of misses) {
    const code = m.name.split(/[_\s.]/)[0] ?? "";
    if (!/^[A-Z0-9]{2,6}$/.test(code) || /^\d+$/.test(code)) continue;
    byCode.set(code, [...(byCode.get(code) ?? []), m]);
  }
  for (const [code, list] of byCode) {
    const top = mostCommon(list.map((m) => m.projectId));
    if (top.count >= minFiles && top.count / list.length >= 0.8) {
      out.push({
        kind: "code",
        key: code,
        projectId: top.value,
        assetId: null,
        files: top.count,
        share: top.count / list.length,
        examples: list.filter((m) => m.projectId === top.value).slice(0, 3).map((m) => m.name),
      });
    }
  }

  // Assets: words common to every miss that landed on the same asset (minus the vendor code).
  const byAsset = new Map<string, typeof misses>();
  for (const m of misses) if (m.assetId) byAsset.set(`${m.projectId}/${m.assetId}`, [...(byAsset.get(`${m.projectId}/${m.assetId}`) ?? []), m]);
  for (const list of byAsset.values()) {
    if (list.length < minFiles) continue;
    const keys = list.map((m) => {
      const code = m.name.split(/[_\s.]/)[0]?.toLowerCase();
      return nameKey(m.name).filter((w) => w !== code && !/^\d+$/.test(w));
    });
    const shared = keys[0].filter((w) => keys.every((k) => k.includes(w)));
    if (shared.length < 2 || rules.has(shared.join(" "))) continue;
    out.push({
      kind: "asset",
      key: shared.join(" "),
      projectId: list[0].projectId,
      assetId: list[0].assetId,
      files: list.length,
      share: 1,
      examples: list.slice(0, 3).map((m) => m.name),
    });
  }
  return out.sort((a, b) => b.files - a.files);
}

function mostCommon(values: string[]) {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [value, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  return { value, count };
}
