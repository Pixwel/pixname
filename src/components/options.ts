import type { Catalog } from "../lib/types";

export interface Option {
  value: string;
  label: string;
}

export function languageOptions(catalog: Catalog): Option[] {
  const byCode = new Map<string, string>();
  for (const l of catalog.languages) if (l.code) byCode.set(l.code, l.name);
  for (const t of catalog.territories) for (const l of t.languages ?? []) if (!byCode.has(l.code)) byCode.set(l.code, l.name);
  return [...byCode.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([code, name]) => ({ value: code, label: `${name} (${code})` }));
}

export function countryOptions(catalog: Catalog): Option[] {
  const byCode = new Map<string, string>();
  for (const t of catalog.territories) for (const c of t.countries ?? []) if (c.code) byCode.set(c.code, c.name);
  return [
    { value: "WW", label: "Worldwide (WW — omitted)" },
    ...[...byCode.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([code, name]) => ({ value: code, label: `${name} (${code})` })),
  ];
}

export const tagOptions = (catalog: Catalog, type: string): Option[] =>
  catalog.tags
    .filter((t) => t.type === type)
    .map((t) => ({ value: t.name, label: `${t.name.toUpperCase()}${t.display && t.display.toLowerCase() !== t.name.toLowerCase() ? ` — ${t.display}` : ""}` }));

/** "coming soon, date" -> ["COMING-SOON", "DATE"]; underscores split tokens, spaces inside a token become dashes. */
export function parseExtra(text: string): string[] {
  return text
    .split(/[,_]+/)
    .map((t) => t.trim().replace(/\s+/g, "-").toUpperCase())
    .filter(Boolean);
}
