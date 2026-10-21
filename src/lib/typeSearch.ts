import { typeToken } from "./parse";
import type { AssetType } from "./types";

/** How many types the "Frequent" group shows before the rest. */
export const FREQUENT_MAX = 6;

/** "tv intl" matches tv-spot.intl; "los" matches living-one-sheet by its file token. */
export function typeMatches(type: AssetType, query: string): boolean {
  const words = query.toLowerCase().split(/[\s_]+/).filter(Boolean);
  const hay = `${type.name} ${typeToken(type)}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export interface TypeGroups {
  frequent: AssetType[];
  rest: AssetType[];
}

/**
 * Types to offer: with a query, every match (frequent ones first); without one, the most used
 * (by score: your picks plus the project's assets) followed by everything else A–Z.
 */
export function groupTypes(types: AssetType[], query: string, uses: Record<string, number>): TypeGroups {
  const byName = (a: AssetType, b: AssetType) => a.name.localeCompare(b.name);
  const byUse = (a: AssetType, b: AssetType) => (uses[b.name] ?? 0) - (uses[a.name] ?? 0) || byName(a, b);
  const shown = query.trim() ? types.filter((t) => typeMatches(t, query)) : types;
  const frequent = shown.filter((t) => (uses[t.name] ?? 0) > 0).sort(byUse).slice(0, FREQUENT_MAX);
  const top = new Set(frequent);
  return { frequent, rest: shown.filter((t) => !top.has(t)).sort(byName) };
}
