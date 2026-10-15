// Expected assets: names the team knows are coming (from a delivery doc) but that aren't in
// Pixwel yet. One person pastes a project's list; everyone who can see the project matches
// and names files with it. A real asset with the same name takes over in the app.
import { createHash } from "node:crypto";
import { z } from "zod";
import { database } from "./db";
import { HttpError, pixwelGet, type Caller } from "./pixwel";

export const MAX_NAMES = 500;

/** The platform's asset slug, as the app builds it (src/lib/expected.ts). */
export function slugOf(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const AddRequest = z.object({
  projectId: z.string().min(1).max(64),
  type: z.string().min(1).max(64),
  names: z.array(z.string().trim().min(1).max(300)).min(1).max(MAX_NAMES),
});

export interface ExpectedAsset {
  projectId: string;
  slug: string;
  name: string;
  type: string;
  addedBy: string;
  at: number;
}

/** Projects each caller can see, briefly cached (keyed by a hash of the token, never the token). */
const visibleCache = new Map<string, { ids: Set<string>; expires: number }>();
const VISIBLE_TTL_MS = 5 * 60 * 1000;

async function visibleProjects(caller: Caller): Promise<Set<string>> {
  const key = createHash("sha256").update(`${caller.env}:${caller.token}`).digest("hex");
  const cached = visibleCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.ids;
  const projects = await pixwelGet<{ _id: string }[]>(caller, "projects");
  const ids = new Set(projects.map((p) => p._id));
  visibleCache.set(key, { ids, expires: Date.now() + VISIBLE_TTL_MS });
  return ids;
}

async function requireProject(caller: Caller, projectId: string) {
  if (!(await visibleProjects(caller)).has(projectId)) throw new HttpError(404, "No such project, or you can't see it in Pixwel");
}

/** Every expected asset of the projects the caller can see. */
export async function listExpected(caller: Caller): Promise<ExpectedAsset[]> {
  const visible = await visibleProjects(caller);
  const db = await database();
  const { rows } = await db.execute({
    sql: `SELECT * FROM expected_assets WHERE env = ? ORDER BY project_id, name`,
    args: [caller.env],
  });
  return rows
    .filter((r) => visible.has(String(r.project_id)))
    .map((r) => ({
      projectId: String(r.project_id),
      slug: String(r.slug),
      name: String(r.name),
      type: String(r.type),
      addedBy: String(r.added_by_name || "Unknown"),
      at: Number(r.added_at),
    }));
}

/** Add names to a project's list; names already on it are left as they are. Returns how many were new. */
export async function addExpected(caller: Caller, request: z.infer<typeof AddRequest>): Promise<number> {
  await requireProject(caller, request.projectId);
  const now = Math.floor(Date.now() / 1000);
  const rows = new Map(request.names.map((name) => [slugOf(name), name] as const));
  rows.delete("");
  if (!rows.size) return 0;
  const db = await database();
  const results = await db.batch(
    [...rows].map(([slug, name]) => ({
      sql: `INSERT INTO expected_assets (env, project_id, slug, name, type, added_by, added_by_name, added_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      args: [caller.env, request.projectId, slug, name, request.type, caller.userId, caller.userName, now],
    })),
    "write",
  );
  return results.reduce((sum, r) => sum + r.rowsAffected, 0);
}

/** Forget one expected asset, or a project's whole list when no slug is given. */
export async function removeExpected(caller: Caller, projectId: string, slug?: string) {
  await requireProject(caller, projectId);
  const db = await database();
  await db.execute(
    slug
      ? { sql: `DELETE FROM expected_assets WHERE env = ? AND project_id = ? AND slug = ?`, args: [caller.env, projectId, slug] }
      : { sql: `DELETE FROM expected_assets WHERE env = ? AND project_id = ?`, args: [caller.env, projectId] },
  );
}
