// Client for the Pixname service (service/ in this repo, on Vercel): shared vendor codes,
// team memory of how files were resolved, and AI matching. Calls go through Rust (no CORS),
// authenticated with the user's own Pixwel token.
import { invoke } from "@tauri-apps/api/core";
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
  example: string;
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
  match: async (s: Settings, files: AiFile[], candidateProjectIds: string[]) =>
    (await call<{ matches: AiMatch[] }>(s, "POST", "api/match", { files, candidateProjectIds })).matches,
};
