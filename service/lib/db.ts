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
];

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
  ready ??= db().batch(SCHEMA, "write").then(() => undefined);
  await ready;
  return db();
}

/** For tests. */
export function useDatabase(next: Client) {
  client = next;
  ready = undefined;
}
