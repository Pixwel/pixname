// House styles: how a studio (or one project) wants its file names, beyond the platform standard,
// e.g. Focus Features names zips "…_COLLECT.zip". Admins set them; everyone's app applies them.
import { z } from "zod";
import { database } from "./db";
import { requireAdmin, type Caller } from "./pixwel";

/** Known switches; unset means the app's general behaviour. Mirrors src/lib/conventions.ts. */
export const Values = z.object({ zipCollect: z.boolean().optional() }).strict();

export const SetRequest = z.object({
  scope: z.enum(["studio", "project"]),
  targetId: z.string().min(1).max(64),
  /** Empty clears the row. */
  values: Values,
});

export interface ConventionRow {
  scope: "studio" | "project";
  targetId: string;
  values: z.infer<typeof Values>;
  updatedBy: string;
  at: number;
}

/** Everyone's naming uses them, so everyone can read them. */
export async function listConventions(caller: Caller): Promise<ConventionRow[]> {
  const db = await database();
  const { rows } = await db.execute({ sql: `SELECT * FROM conventions WHERE env = ? ORDER BY scope, target_id`, args: [caller.env] });
  return rows.map((r) => ({
    scope: String(r.scope) as ConventionRow["scope"],
    targetId: String(r.target_id),
    // Switches dropped in a later version are ignored rather than failing the list.
    values: Values.strip().safeParse(JSON.parse(String(r.data))).data ?? {},
    updatedBy: String(r.updated_by_name || "Unknown"),
    at: Number(r.updated_at),
  }));
}

export async function setConventions(caller: Caller, { scope, targetId, values }: z.infer<typeof SetRequest>) {
  requireAdmin(caller);
  const db = await database();
  const set = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
  if (!Object.keys(set).length) {
    await db.execute({ sql: `DELETE FROM conventions WHERE env = ? AND scope = ? AND target_id = ?`, args: [caller.env, scope, targetId] });
    return;
  }
  await db.execute({
    sql: `INSERT INTO conventions (env, scope, target_id, data, updated_by, updated_by_name, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (env, scope, target_id) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by,
            updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at`,
    args: [caller.env, scope, targetId, JSON.stringify(set), caller.userId, caller.userName, Math.floor(Date.now() / 1000)],
  });
}
