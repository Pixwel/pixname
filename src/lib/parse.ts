// Synchronous port of slurpee3/workflows/ingest/ingestPrepare/parse.js. Instead of querying the
// API per file it matches against the already-loaded catalog and project list. Quirks of the
// original are kept on purpose (case-sensitive type match, single-segment trailer regex, the
// lowercase-only running time regex) so results line up with what ingest would infer.
import type { Catalog, Project, Tag, Territory } from "./types";

export interface ParsedFilename {
  projectId?: string;
  assetType?: string;
  assetSlug?: string;
  assetName?: string;
  assetLength?: number;
  language?: string;
  country?: string;
  tags: string[];
  version?: string;
  preview?: boolean;
  extra: string[];
}

const DUAL_LANGUAGE_LOCALES: Record<string, string[]> = {
  "ARA-PFR": ["ARA", "PFR"],
  "PFR-FLE": ["FLE", "PFR"],
  "GER-PFR": ["GER", "PFR"],
  "EST-RUS": ["EST", "RUS"],
  "LAT-RUS": ["LAT", "RUS"],
};

const LOCALE_CORRECTIONS: Record<string, string> = { BZP: "BPO", LTH: "LIT" };
const SPLIT_TYPES = ["tv-spot.us", "film-clip.us", "radio-spot.us"];
export const DEFAULT_TEXT_TAGS: Record<string, string[]> = {
  av: ["txtd"],
  digital: ["txtd"],
  print: ["flattened"],
};

export const parameterize = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const titleize = (s: string) =>
  s
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const intlAssetType = (type?: string) =>
  type && SPLIT_TYPES.includes(type) ? type.replace(/\.us$/, ".intl") : type;

export const findTag = (tags: Tag[], part: string): Tag | undefined => {
  const p = part.toLowerCase();
  return tags.find(
    (tag) => tag.name.toLowerCase() === p || (tag.aliases ?? []).some((a) => a.toLowerCase() === p),
  );
};

export const languageExists = (territories: Territory[], code: string) =>
  territories.some((t) => (t.languages ?? []).some((l) => l.code === code));

const countryExists = (territories: Territory[], code: string) =>
  territories.some((t) => (t.countries ?? []).some((c) => c.code && c.code === code));

export const typeToken = (type: { name: string; file?: string }) =>
  type.file || type.name.replace(".", "-").toUpperCase();

export function parseFilename(fileName: string, catalog: Catalog, projects: Project[]): ParsedFilename {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot + 1) : "";
  let parts = base.split("_").filter((p) => p !== "");
  const out: ParsedFilename = { tags: [], extra: [] };
  if (!parts.length) return out;

  // project — first part against filePrefix
  const project = projects.find((p) => p.filePrefix && p.filePrefix.toUpperCase() === parts[0].toUpperCase());
  if (project) {
    out.projectId = project._id;
    parts = parts.slice(1);
  }

  // type — exact, case-sensitive token compare
  if (parts.length) {
    const type = catalog.types.find((t) => parts[0] === typeToken(t));
    if (type) {
      out.assetType = type.name;
      parts = parts.slice(1);
    }
  }

  // trailer
  let isTrailer = false;
  if (parts.length && parts[0] !== "TR") {
    const m = parts[0].match(/^(D|I)?TR-([A-Z0-9]+)(?:-CRE-([A-Z0-9-]+))?$/);
    if (m) {
      let type: string;
      let name: string;
      if (m[1] === "D") {
        type = "trailer.us";
        name = `Domestic Trailer ${m[2]}`;
      } else if (m[1] === "I") {
        type = "trailer.intl";
        name = `Int'l Trailer ${m[2]}`;
      } else {
        type = "trailer";
        name = `${titleize(m[2])} Trailer`;
      }
      if (m[3]) {
        name += ` - ${titleize(m[3])}`;
        type += ".cre";
      }
      Object.assign(out, { assetType: type, assetName: name, assetSlug: parameterize(name.replace("'", "")) });
      parts = parts.slice(1);
      isTrailer = true;
    }
  }

  // nonTrailer — next part is the asset title
  if (!isTrailer && !(out.assetType ?? "").match(/^trailer/) && parts.length) {
    let name = titleize(parts[0]).replace(/\b(Intl)\b/, "Int'l");
    out.assetName = name;
    out.assetSlug = parameterize(parts[0]);
    if (/\bInt'l\b/.test(name) && out.assetType?.match(/\.us$/)) {
      out.assetType = out.assetType.replace(/\.us$/, ".intl");
    }
    const len = name.match(/\d+$/);
    if (len && parseInt(len[0], 10) % 5 === 0) out.assetLength = parseInt(len[0], 10);
    parts = parts.slice(1);
  }

  // locale — first matching part anywhere
  for (let i = 0; i < parts.length; i++) {
    let m = parts[i].match(/^([A-Z]{2,3})(-(?:([SD]UB)|([A-Z]{2,3})))?$/);
    if (!m) continue;
    const filtered = m.filter((x) => !!x);
    if (!((filtered.length === 2 || filtered.length === 4) && filtered[1].length === 3)) continue;
    let language = filtered[1] || "";
    const country = filtered[3] || "";

    if (country) {
      const sorted = [language, country].sort().join(",");
      const dual = Object.entries(DUAL_LANGUAGE_LOCALES).find(([, langs]) => langs.join(",") === sorted);
      if (dual) {
        out.language = dual[0];
        out.country = "WW";
        out.assetType = intlAssetType(out.assetType);
        parts = parts.filter((_, j) => j !== i);
        break;
      }
    }

    language = LOCALE_CORRECTIONS[language] ?? language;
    if (!languageExists(catalog.territories, language)) continue;

    out.language = language;
    out.country = country;
    if (country === "SUB" || country === "DUB") out.tags.push(country.toLowerCase());
    if (!countryExists(catalog.territories, out.country)) out.country = "WW";
    if (out.country !== "US") out.assetType = intlAssetType(out.assetType);
    parts = parts.filter((_, j) => j !== i);
    break;
  }

  // tags — by extension, then every remaining part against names/aliases
  for (const tag of catalog.tags) {
    if (tag.extension && ext && tag.extension.toLowerCase() === ext.toLowerCase()) out.tags.push(tag.name);
  }
  const unmatched: string[] = [];
  for (const part of parts) {
    const tag = findTag(catalog.tags, part);
    if (tag) out.tags.push(tag.name);
    else unmatched.push(part);
  }
  parts = unmatched;
  out.tags = [...new Set(out.tags)];
  if (out.assetType?.match(/^radio-spot\./) && !out.tags.includes("broadcast")) out.tags.push("broadcast");

  // runningTime
  for (let i = 0; i < parts.length; i++) {
    const num = parts[i].match(/^(\d{2,})$/);
    if (num) {
      out.assetLength = parseInt(num[1], 10);
      parts = parts.filter((_, j) => j !== i);
      break;
    }
    const t = parts[i].match(/^(?:([0-9]+)hr)?(?:([0-9]+)min)?(?:([0-9]+)sec)?$/);
    if (t) {
      out.assetLength =
        parseInt(t[1] || "0", 10) * 3600 + parseInt(t[2] || "0", 10) * 60 + parseInt(t[3] || "0", 10);
      parts = parts.filter((_, j) => j !== i);
      break;
    }
  }

  // version
  let version = "Final";
  let sawBareRev = false;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "REV") {
      sawBareRev = true;
      break;
    }
    const m = parts[i].match(/^REV-(.+)$/);
    if (m) {
      version = titleize(m[1]);
      parts = parts.filter((_, j) => j !== i);
      break;
    }
  }
  if (!sawBareRev && (parts[parts.length - 1] === "PREVIEW" || parts[parts.length - 1] === "OFFLINE")) {
    out.version = version;
    out.preview = true;
    parts = parts.slice(0, -1);
  }

  // extra — leftovers, minus height/framerate tokens
  out.extra = parts.filter((p) => !/[0-9]+[pi]+[0-9]*/.test(p));
  return out;
}
