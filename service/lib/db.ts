// Turso (libSQL). On Vercel the Turso integration provides the URL and token;
// locally it falls back to a file so `vercel dev` and tests need no setup.
import { createClient, type Client } from "@libsql/client";

let client: Client | undefined;
let ready: Promise<void> | undefined;

const SCHEMA = [
  // One row per person per code per project: a code many people confirm for one project is
  // trustworthy; one confirmed for several projects (a vendor's own code) is not.
  `CREATE TABLE IF NOT EXISTS code_votes (
     env TEXT NOT NULL,
     code TEXT NOT NULL,
     project_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     count INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (env, code, project_id, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS code_votes_env ON code_votes (env, code)`,
  // How each renamed file was resolved, and what Pixname guessed first (see lib/resolutions.ts).
  `CREATE TABLE IF NOT EXISTS resolutions (
     id INTEGER PRIMARY KEY,
     env TEXT NOT NULL,
     user_id TEXT NOT NULL,
     name TEXT NOT NULL,
     name_key TEXT NOT NULL,
     dirs TEXT NOT NULL DEFAULT '[]',
     project_id TEXT NOT NULL,
     asset_id TEXT,
     source TEXT NOT NULL,
     guess_project_id TEXT,
     guess_asset_id TEXT,
     guess_source TEXT,
     guess_score REAL,
     missed INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS resolutions_env_created ON resolutions (env, created_at)`,
  // Rules made from the workbench: a phrase in a file name means this asset (see lib/rules.ts).
  `CREATE TABLE IF NOT EXISTS asset_rules (
     id INTEGER PRIMARY KEY,
     env TEXT NOT NULL,
     phrase TEXT NOT NULL,
     project_id TEXT NOT NULL,
     asset_id TEXT NOT NULL,
     created_by TEXT NOT NULL,
     created_by_name TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL,
     UNIQUE (env, phrase)
   )`,
  // Assets the team expects but Pixwel doesn't have yet, pasted from delivery docs (see lib/expected.ts).
  `CREATE TABLE IF NOT EXISTS expected_assets (
     env TEXT NOT NULL,
     project_id TEXT NOT NULL,
     slug TEXT NOT NULL,
     name TEXT NOT NULL,
     type TEXT NOT NULL,
     added_by TEXT NOT NULL,
     added_by_name TEXT NOT NULL DEFAULT '',
     added_at INTEGER NOT NULL,
     PRIMARY KEY (env, project_id, slug)
   )`,
  // House styles per studio or project, set by admins (see lib/conventions.ts).
  `CREATE TABLE IF NOT EXISTS conventions (
     env TEXT NOT NULL,
     scope TEXT NOT NULL,
     target_id TEXT NOT NULL,
     data TEXT NOT NULL,
     updated_by TEXT NOT NULL,
     updated_by_name TEXT NOT NULL DEFAULT '',
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (env, scope, target_id)
   )`,
];

/** Columns added after the first release; added to existing databases on startup. */
const ADDED_COLUMNS: Record<string, [string, string][]> = {
  resolutions: [
    ["new_name", "TEXT"],
    ["user_name", "TEXT NOT NULL DEFAULT ''"],
    ["size", "INTEGER"],
    ["duration", "REAL"],
    ["fingerprint", "TEXT"],
    // Set when the person undid the rename; undone rows stay in history but count nowhere else.
    ["undone_at", "INTEGER"],
  ],
};

async function migrate(db: Client) {
  await db.batch(SCHEMA, "write");
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const { rows } = await db.execute(`PRAGMA table_info(${table})`);
    const existing = new Set(rows.map((r) => String(r.name)));
    for (const [name, type] of columns) {
      if (!existing.has(name)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
  await db.execute(`CREATE INDEX IF NOT EXISTS resolutions_fingerprint ON resolutions (env, fingerprint)`);
}

export function db(): Client {
  // Blank values (as copied from .env.example) count as unset.
  const env = (name: string) => process.env[name]?.trim() || undefined;
  client ??= createClient({
    url: env("TURSO_DATABASE_URL") ?? env("DATABASE_URL") ?? "file:pixname-local.db",
    authToken: env("TURSO_AUTH_TOKEN") ?? env("DATABASE_AUTH_TOKEN"),
  });
  return client;
}

/** Creates tables on first use; cheap and idempotent, so there's no migration step to deploy. */
export async function database(): Promise<Client> {
  ready ??= migrate(db()).catch((e) => {
    ready = undefined; // retry on the next request
    throw e;
  });
  await ready;
  return db();
}

/** For tests. */
export function useDatabase(next: Client) {
  client = next;
  ready = undefined;
}
