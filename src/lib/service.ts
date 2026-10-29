// Client for the Pixname service (service/ in this repo, on Vercel): shared vendor codes,
// team memory of how files were resolved, and AI matching. Calls go through Rust (no CORS),
// authenticated with the user's own Pixwel token.
import { invoke } from "@tauri-apps/api/core";
import type { ConventionRow } from "./conventions";
import type { MatchSource } from "./types";
import { serviceUrlOf, type Settings } from "./settings";

export const serviceEnabled = (s: Settings) => !!serviceUrlOf(s) && !!s.token && s.environment !== "custom";

async function call<T>(s: Settings, method: string, path: string, body?: unknown): Promise<T> {
  return invoke<T>("service_request", {
    baseUrl: serviceUrlOf(s),
    path,
    method,
    token: s.token,
    environment: s.environment,
    body: body ?? null,
  });
}

export interface Health {
  ok: boolean;
  env: string;
  ai: boolean;
  model: string;
  /** Who the token belongs to; admins see everyone's activity and manage team rules. */
  user?: { id: string; name: string; isAdmin: boolean };
}

export interface CodeProject {
  projectId: string;
  votes: number;
  people: number;
  updatedAt: number;
}
export type SharedCodes = Record<string, CodeProject[]>;

export interface TeamMatch {
  name: string;
  projectId: string;
  assetId: string | null;
  similarity: number;
  votes: number;
  people: number;
  /** The earlier file it's based on (only shown when it's yours, or to admins). */
  example: string | null;
}

export interface AiMatch {
  file: number;
  projectId: string | null;
  assetId: string | null;
  confidence: number;
  reason: string;
}

export interface AiFile {
  name: string;
  dirs: string[];
  durationSec?: number;
  aspect?: string;
  mediaType?: "video" | "image" | "audio" | "document";
}

export interface Resolution {
  name: string;
  dirs: string[];
  projectId: string;
  assetId: string | null;
  source: MatchSource;
  guess: { projectId: string | null; assetId: string | null; source: MatchSource | null; score: number | null } | null;
  newName?: string | null;
  size?: number | null;
  durationSec?: number | null;
  fingerprint?: string | null;
}

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
  source: MatchSource;
  guess: { projectId: string; assetId: string | null; source: MatchSource; score: number } | null;
  missed: boolean;
  /** When the rename was undone (still listed, but it no longer counts). */
  undoneAt: number | null;
  size: number | null;
  durationSec: number | null;
}

export interface HistoryQuery {
  q?: string;
  userId?: string;
  projectId?: string;
  source?: MatchSource;
  missedOnly?: boolean;
  before?: number;
  limit?: number;
}

export interface Stats {
  days: number;
  scope: "team" | "mine";
  files: number;
  people: number;
  missed: number;
  perDay: { day: string; files: number; missed: number }[];
  perUser: { userId: string; userName: string; files: number; missed: number; last: number }[];
  perProject: { projectId: string; files: number; missed: number; last: number }[];
  bySource: { source: MatchSource; files: number }[];
  ai: { suggested: number; kept: number };
}

export interface AssetRule {
  id: number;
  phrase: string;
  words: string[];
  projectId: string;
  assetId: string;
  createdBy: string;
  at: number;
}

export interface Suggestion {
  kind: "code" | "asset";
  key: string;
  projectId: string;
  assetId: string | null;
  files: number;
  share: number;
  examples: string[];
}

const query = (params: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

/** A project's expected asset as the team shares it (service lib/expected.ts). */
export interface SharedExpected {
  projectId: string;
  slug: string;
  name: string;
  type: string;
  addedBy: string;
  at: number;
}

/** An asset from a pasted delivery list, not in Pixwel yet. */
export interface ExpectedAiAsset {
  id: string;
  name: string;
  type: string;
  project: string;
}

export const service = {
  health: (s: Settings) => call<Health>(s, "GET", "api/health"),
  codes: async (s: Settings) => (await call<{ codes: SharedCodes }>(s, "GET", "api/codes")).codes,
  vote: (s: Settings, votes: { code: string; projectId: string }[]) => call(s, "POST", "api/codes", { votes }),
  editCode: (s: Settings, code: string, projectId: string) => call(s, "PUT", "api/codes", { code, projectId }),
  forgetCode: (s: Settings, code: string) => call(s, "DELETE", "api/codes", { code }),
  lookup: async (s: Settings, names: string[]) =>
    (await call<{ matches: (TeamMatch | null)[] }>(s, "POST", "api/resolutions/lookup", { names })).matches,
  record: (s: Settings, resolutions: Resolution[]) => call(s, "POST", "api/resolutions", { resolutions }),
  undo: (s: Settings, renames: { name: string; newName: string }[]) => call(s, "POST", "api/resolutions/undo", { renames }),
  match: async (s: Settings, files: AiFile[], candidateProjectIds: string[], expectedAssets: ExpectedAiAsset[] = []) =>
    (await call<{ matches: AiMatch[] }>(s, "POST", "api/match", { files, candidateProjectIds, expectedAssets })).matches,
  expected: async (s: Settings) => (await call<{ assets: SharedExpected[] }>(s, "GET", "api/expected")).assets,
  addExpected: async (s: Settings, projectId: string, type: string, names: string[]) =>
    (await call<{ added: number }>(s, "POST", "api/expected", { projectId, type, names })).added,
  removeExpected: (s: Settings, projectId: string, slug?: string) => call(s, "DELETE", `api/expected${query({ projectId, slug })}`),
  history: (s: Settings, q: HistoryQuery) =>
    call<{ rows: HistoryRow[]; more: boolean }>(s, "GET", `api/activity/history${query({ ...q })}`),
  stats: (s: Settings, days: number) => call<Stats>(s, "GET", `api/activity/stats${query({ days })}`),
  seen: async (s: Settings, files: { name: string; fingerprint?: string; size?: number; durationSec?: number }[]) =>
    (await call<{ matches: (HistoryRow | null)[] }>(s, "POST", "api/activity/seen", { files })).matches,
  rules: async (s: Settings) => (await call<{ rules: AssetRule[] }>(s, "GET", "api/rules")).rules,
  addRule: (s: Settings, rule: { phrase: string; projectId: string; assetId: string }) => call(s, "POST", "api/rules", rule),
  deleteRule: (s: Settings, id: number) => call(s, "DELETE", `api/rules${query({ id })}`),
  conventions: async (s: Settings) => (await call<{ conventions: ConventionRow[] }>(s, "GET", "api/conventions")).conventions,
  setConventions: (s: Settings, row: Pick<ConventionRow, "scope" | "targetId" | "values">) => call(s, "PUT", "api/conventions", row),
  suggestions: async (s: Settings, days = 90) =>
    (await call<{ suggestions: Suggestion[] }>(s, "GET", `api/rules/suggestions${query({ days })}`)).suggestions,
};

/** A file name's comparable words, split the way the service splits them (camelCase, letters/digits). */
export function nameWords(name: string): string[] {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
      .toLowerCase()
      .match(/\d+x\d+|[a-z]+|\d+/g) ?? []
  );
}

/** The asset rule a file name matches: the most specific one whose words all appear in it. */
export function ruleFor(name: string, rules: AssetRule[]): AssetRule | undefined {
  const words = new Set(nameWords(name));
  return rules
    .filter((r) => r.words.length && r.words.every((w) => words.has(w)))
    .sort((a, b) => b.words.length - a.words.length)[0];
}
