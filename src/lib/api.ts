import { invoke } from "@tauri-apps/api/core";
import { baseUrl, type Settings } from "./settings";
import type {
  Asset,
  AssetType,
  Catalog,
  Language,
  Project,
  Tag,
  Territory,
  WorkRequest,
} from "./types";
import fixtureTags from "../data/tags.json";
import fixtureTypes from "../data/asset_types.json";
import fixtureTerritories from "../data/territories.json";
import fixtureLanguages from "../data/languages.json";

type Query = Record<string, string | number | boolean | undefined>;

export async function apiGet<T>(settings: Settings, path: string, query: Query = {}): Promise<T> {
  const pairs = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, String(v)]);
  const data = await invoke<unknown>("api_get", {
    baseUrl: baseUrl(settings),
    token: settings.token,
    path,
    query: pairs,
  });
  // Some endpoints wrap lists; normalise to the bare payload.
  if (data && typeof data === "object" && !Array.isArray(data) && "data" in data) {
    return (data as { data: T }).data;
  }
  return data as T;
}

// Fixtures key resources by `_id`; the API exposes the same value as `name`.
const named = <T extends { name?: string }>(rows: any[]): T[] =>
  rows.map((r) => ({ ...r, name: r.name ?? r._id }));

export const FALLBACK_CATALOG: Catalog = {
  tags: named<Tag>(fixtureTags as any[]),
  types: named<AssetType>(fixtureTypes as any[]),
  territories: fixtureTerritories as Territory[],
  languages: fixtureLanguages as Language[],
};

/**
 * Load the reference data the renderer and parser need. Any resource the API can't
 * provide falls back to the bundled platform fixtures so naming still works.
 */
export async function loadCatalog(settings: Settings): Promise<{ catalog: Catalog; warnings: string[] }> {
  const warnings: string[] = [];
  const get = async <T,>(path: string, fallback: T[]): Promise<T[]> => {
    try {
      const rows = await apiGet<any[]>(settings, path);
      if (Array.isArray(rows) && rows.length) return named(rows) as T[];
      warnings.push(`/${path} returned nothing; using bundled defaults`);
    } catch (e) {
      warnings.push(`/${path}: ${e}`);
    }
    return fallback;
  };
  const [tags, types, territories, languages] = await Promise.all([
    get<Tag>("tags", FALLBACK_CATALOG.tags),
    get<AssetType>("assettypes", FALLBACK_CATALOG.types),
    get<Territory>("territories", FALLBACK_CATALOG.territories),
    get<Language>("languages", FALLBACK_CATALOG.languages),
  ]);
  return { catalog: { tags, types, territories, languages }, warnings };
}

export const fetchProjects = async (settings: Settings) =>
  (await apiGet<Project[]>(settings, "projects")).filter((p) => !p.archived);

export const fetchAssets = (settings: Settings, projectId: string) =>
  apiGet<Asset[]>(settings, "assets", { project: projectId });

export const fetchWorkRequests = (settings: Settings, projectId: string) =>
  apiGet<WorkRequest[]>(settings, "workrequests", { project: projectId });

export const idOf = (ref: string | { _id: string } | undefined | null): string | undefined =>
  !ref ? undefined : typeof ref === "string" ? ref : ref._id;
