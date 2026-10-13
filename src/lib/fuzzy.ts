// Heuristics for files that don't follow the standard ("Passenger Explainer VERT 30s GREEK subs v3.mov").
// Everything here produces *suggestions* with a confidence score; the strict parser always wins.
import { Ingest } from "@pixwel/pixwel-sdk";
import type { Asset, AssetType, Catalog, Language, Project } from "./types";
import { findTag, languageExists, parameterize, typeToken } from "./parse";

/**
 * Folder context for a file, nearest first. Inside a dropped folder that's the relative path;
 * for a single dropped file, its own parent folder is the only hint.
 */
export function dirsOf(file: { dir: string; relDirs?: string[] }): string[] {
  if (file.relDirs?.length) return [...file.relDirs].reverse();
  const parent = file.dir.split(/[\\/]/).filter(Boolean).pop();
  return parent ? [parent] : [];
}

/** The frame shape a name describes, from aspect ratios or words ("9x16", "Vert", "16x9", "Square"). */
export function orientationOf(text: string): "vertical" | "horizontal" | "square" | undefined {
  const t = text.toLowerCase();
  if (/(^|[^0-9])9x16($|[^0-9])|\bvert(ical)?\b/.test(t)) return "vertical";
  if (/(^|[^0-9])1x1($|[^0-9])|\bsquare\b/.test(t)) return "square";
  if (/(^|[^0-9])16x9($|[^0-9])|(^|[^0-9])2x1($|[^0-9])/.test(t)) return "horizontal";
  return undefined;
}

/** Lowercased leading vendor code ("STF_…" -> "stf"); see abbrev.ts vendorCode. */
function vendorCodeOf(fileName: string): string | undefined {
  const first = fileName.split(/[_\s.]/)[0] ?? "";
  return first.length >= 2 && first.length <= 6 && /^[A-Z0-9]+$/.test(first) ? first.toLowerCase() : undefined;
}

/** Lowercase word tokens, splitting on separators and letter/digit boundaries. */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const stripExt = (name: string) => (name.lastIndexOf(".") > 0 ? name.slice(0, name.lastIndexOf(".")) : name);

// Common ways vendors spell languages that don't map 1:1 onto a catalog name.
const LANGUAGE_ALIASES: Record<string, string> = {
  french: "PFR",
  parisian: "PFR",
  canadian: "CFR",
  quebec: "CFR",
  quebecois: "CFR",
  spanish: "CSP",
  castilian: "CSP",
  latam: "LAS",
  latin: "LAS",
  brazilian: "BPO",
  brazil: "BPO",
  portuguese: "EPT",
  chinese: "MAN",
  mandarin: "MAN",
  taiwan: "MAN",
  prc: "PRC",
  cantonese: "CAN",
  greek: "GRK",
  german: "GER",
  dutch: "DUT",
  flemish: "FLE",
  english: "ENG",
  bahasa: "BAH",
};

const SUB_WORDS = ["sub", "subs", "subbed", "subtitle", "subtitles", "subtitled"];
const DUB_WORDS = ["dub", "dubs", "dubbed"];

/** Words that describe the file's technical form rather than its identity. */
const NOISE = new Set([
  ...SUB_WORDS,
  ...DUB_WORDS,
  "prores", "proreshq", "hq", "lt", "proxy", "h264", "h", "264", "x264", "hevc", "h265", "265", "dnxhd", "dnxhr",
  "mpeg", "mpeg2", "mov", "mp4", "mxf", "wav", "mp3", "hd", "sd", "uhd", "4k", "2k", "k", "p", "i", "fps",
  "1080", "720", "480", "2160", "1920", "3840", "1280", "23", "976", "98", "2398", "23976", "2997", "29", "97",
  "5994", "59", "94", "x", "final", "master", "approved", "v", "ver", "version",
  "rev", "txtd", "txtl", "txtls", "txtless", "textless", "texted", "txted", "clean", "stereo", "mono", "51", "lr", "lt", "rt", "mix",
  "sec", "secs", "s", "min", "the", "a", "an", "of", "and", "for", "copy", "new", "export", "render", "output",
  // Delivery/format words: "ProRes422HQ", "Split Audio", "Splits_Narr_Dx_Mx_Fx", "NoGFX".
  "intl", "pro", "res", "422", "4444", "audio", "split", "splits", "narr", "dx", "mx", "fx", "sfx", "gfx", "nogfx", "withgfx",
]);

export interface LooseHints {
  language?: string;
  sub?: boolean;
  dub?: boolean;
  text?: string;
  version?: string;
  /** Tokens that look like they identify the asset (noise and recognised hints removed). */
  content: string[];
}

function languageFromTokens(
  tokens: string[],
  catalog: Catalog,
  upperPieces?: Set<string>,
): { code?: string; used: Set<string> } {
  const used = new Set<string>();
  const exists = (code: string) => languageExists(catalog.territories, code) || catalog.languages.some((l) => l.code === code);

  // Exact 3-letter codes win (eng, grk, pfr…), but only when written as a standalone token.
  // In folder names they must also be uppercase, so "Cat Videos" or "Man on Fire" don't read as languages.
  for (const t of tokens) {
    if (t.length === 3 && exists(t.toUpperCase()) && (!upperPieces || upperPieces.has(t.toUpperCase()))) {
      used.add(t);
      return { code: t.toUpperCase(), used };
    }
  }
  // Full catalog names: "greek", "french canadian", "latin american spanish".
  let best: { lang: Language; size: number } | undefined;
  for (const lang of catalog.languages) {
    const words = tokenize(lang.name);
    if (words.length && words.every((w) => tokens.includes(w)) && (!best || words.length > best.size)) {
      best = { lang, size: words.length };
    }
  }
  if (best) {
    tokenize(best.lang.name).forEach((w) => used.add(w));
    return { code: best.lang.code, used };
  }
  for (const t of tokens) {
    const code = LANGUAGE_ALIASES[t];
    if (code && exists(code)) {
      used.add(t);
      return { code, used };
    }
  }
  return { used };
}

export function looseHints(name: string, catalog: Catalog, isFolder = false): LooseHints {
  const raw = isFolder ? name : stripExt(name);
  const tokens = tokenize(raw);
  const hints: LooseHints = { content: [] };
  const upperPieces = isFolder ? new Set(raw.split(/[^A-Za-z0-9]+/).filter((p) => p === p.toUpperCase())) : undefined;
  const { code, used } = languageFromTokens(tokens, catalog, upperPieces);
  hints.language = code;

  if (tokens.some((t) => SUB_WORDS.includes(t))) hints.sub = true;
  if (tokens.some((t) => DUB_WORDS.includes(t))) hints.dub = true;

  // Text tags (TXTD, TXTL2…) and REV markers are found on the raw separator-split pieces.
  for (const piece of raw.split(/[^A-Za-z0-9]+/)) {
    const tag = findTag(catalog.tags, piece);
    if (tag?.type === "Text" && !hints.text) hints.text = tag.name;
    const rev = piece.match(/^REV(\d*)$/i);
    if (rev) hints.version = rev[1] && rev[1] !== "1" ? `REV${rev[1]}` : "REV";
  }
  // Common vendor spellings that aren't tag aliases.
  if (!hints.text && tokens.some((t) => ["textless", "txtls", "txtless", "clean"].includes(t))) hints.text = "txtl";
  if (!hints.text && tokens.some((t) => ["texted", "txted"].includes(t))) hints.text = "txtd";

  hints.content = tokens.filter((t) => !used.has(t) && !NOISE.has(t) && !/^v\d+$/.test(t) && !/^\d{6,8}$/.test(t));
  return hints;
}

const singular = (t: string) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);

/**
 * Asset types named by a piece of text: "TV Spots" -> tv-spot.*, "Social" -> social,
 * "Trailers" -> every trailer type. Matches the filename part ("TVSPOT") or the type id words.
 */
export function typeHints(text: string, types: AssetType[]): string[] {
  const tokens = new Set(tokenize(text).map(singular));
  const joined = [...tokens].join("");
  return types
    .filter((type) =>
      [tokenize(typeToken(type)), tokenize(type.name.split(".")[0])].some((words) => {
        const w = words.map(singular).filter((x) => x !== "intl" && x !== "us");
        if (!w.length) return false;
        if (w.every((x) => tokens.has(x))) return true;
        const glued = w.join("");
        return glued.length >= 6 && joined.includes(glued);
      }),
    )
    .map((t) => t.name);
}

export type HintField = "language" | "sub" | "dub" | "text" | "version";

export interface ContextHints extends LooseHints {
  /** Asset types suggested by the file name or its folders. */
  types: string[];
  /** Which folder supplied a hint, when it didn't come from the file name. */
  from: Partial<Record<HintField | "types", string>>;
}

/**
 * Hints from the file name, then from each folder walking outwards. The nearest source
 * that says something about a field wins.
 */
export function contextHints(fileName: string, dirs: string[], catalog: Catalog): ContextHints {
  const own = looseHints(fileName, catalog);
  const result: ContextHints = { ...own, types: typeHints(stripExt(fileName), catalog.types), from: {} };
  for (const dir of dirs) {
    const h = looseHints(dir, catalog, true);
    for (const field of ["language", "sub", "dub", "text", "version"] as HintField[]) {
      if (result[field] === undefined && h[field] !== undefined) {
        (result as any)[field] = h[field];
        result.from[field] = dir;
      }
    }
    if (!result.types.length) {
      const types = typeHints(dir, catalog.types);
      if (types.length) {
        result.types = types;
        result.from.types = dir;
      }
    }
  }
  return result;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Similarity between two tokens; numbers must match exactly. */
function tokenSim(a: string, b: string): number {
  if (a === b) return 1;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return 0;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.85;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.6; // vert ~ vertical
  const r = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return r >= 0.75 ? r : 0;
}

const bestSim = (token: string, pool: string[]) => pool.reduce((m, t) => Math.max(m, tokenSim(token, t)), 0);

/** Platform title token for an asset, e.g. "ITR-TEST-ASSET-A" or "EXPLAINER-VERTICAL-30". */
export function assetTitleToken(asset: Asset): string {
  try {
    return Ingest.assetTitle(asset);
  } catch {
    return asset.slug.toUpperCase();
  }
}

export interface Scored<T> {
  item: T;
  score: number;
}

export interface FileFacts {
  name: string;
  /** Folder names inside what was dropped, nearest first. */
  dirs: string[];
  duration?: number;
  mediaType?: string;
}

/** How much a match found only in a folder name counts, by distance from the file. */
const folderWeight = (depth: number) => Math.max(0.7, 0.92 - depth * 0.05);

const STOP = new Set(["the", "a", "an", "of", "and", "movie", "film"]);

/** Rank a project's assets against a file and its folders. */
export function rankAssets(
  facts: FileFacts,
  assets: Asset[],
  types: AssetType[],
  catalog: Catalog,
  project?: Project,
): Scored<Asset>[] {
  const parts = stripExt(facts.name).split("_").map((p) => p.toUpperCase());
  const sections = stripExt(facts.name).split("_").map(parameterize);
  const projectWords = new Set(project ? [...tokenize(project.filePrefix ?? ""), ...tokenize(project.name)] : []);
  const hints = contextHints(facts.name, facts.dirs, catalog);
  const hintedTypes = new Set(hints.types);
  // Every type word is "context", not asset identity: "Social/Explainer 30" should match on "explainer 30".
  const typeWords = new Set(types.flatMap((t) => tokenize(typeToken(t))).map(singular));
  // Shape words name a version of an asset ("… Vertical"), even where a type uses them too.
  for (const w of ["vertical", "square"]) typeWords.delete(w);
  const code = vendorCodeOf(facts.name);
  // Tags (FLAT, SCOPE, 2K, PRORES…) describe the delivery, not which asset it is.
  const clean = (tokens: string[]) =>
    tokens.filter((t) => !projectWords.has(t) && !typeWords.has(singular(t)) && t !== code && !findTag(catalog.tags, t));
  const shape = orientationOf([facts.name, ...facts.dirs.slice(0, 1)].join(" "));

  // Each source is scored on its own, then weighted: the file name, the name plus its
  // folder ("Explainer Vertical 30/GRK_final.mov"), then each folder walking outwards.
  const fileContent = clean(looseHints(facts.name, catalog).content);
  // "9x16" means the Vertical version of an asset, "1x1" the Square one.
  if (shape === "vertical" || shape === "square") fileContent.push(shape);
  const folderContent = facts.dirs.map((d) => clean(looseHints(d, catalog, true).content));
  const sources: { tokens: string[]; weight: number }[] = [{ tokens: fileContent, weight: 1 }];
  if (folderContent[0]?.length) sources.push({ tokens: [...fileContent, ...folderContent[0]], weight: 0.95 });
  folderContent.forEach((tokens, depth) => tokens.length && sources.push({ tokens, weight: folderWeight(depth) }));

  const numbersIn = (text: string) => tokenize(text).filter((t) => /^\d{1,3}$/.test(t));
  const nearbyNumbers = [...numbersIn(stripExt(facts.name)), ...(facts.dirs[0] ? numbersIn(facts.dirs[0]) : [])];

  return assets
    .map((asset) => {
      // Already-standard names: an exact title token means certainty.
      if (parts.includes(assetTitleToken(asset))) return { item: asset, score: 1 };
      // A whole section of the name is the asset's name ("0080_Tug of War_Green Box.mov").
      const exactSection = sections.includes(asset.slug);

      const slugTokens = tokenize(asset.slug).filter((t) => !NOISE.has(t) || /^\d+$/.test(t));
      // Asset names often repeat the project ("Street Fighter - A Brotherhood Forged"); like the
      // file side, judge them on what's left.
      const identity = slugTokens.filter((t) => !typeWords.has(singular(t)) && !projectWords.has(t));
      const assetTokens = identity.length ? identity : slugTokens;
      if (!assetTokens.length) return { item: asset, score: 0 };

      let score = 0;
      for (const { tokens, weight } of sources) {
        if (!tokens.length) continue;
        const recall = assetTokens.reduce((s, t) => s + bestSim(t, tokens), 0) / assetTokens.length;
        // Numbers ("16x9", "30") are judged by the number check below, not as unmatched words.
        const words = tokens.filter((t) => !/^\d+$/.test(t));
        const precision = words.length
          ? words.reduce((s, t) => s + (bestSim(t, assetTokens) >= 0.6 ? 1 : 0), 0) / words.length
          : 0.5;
        const f = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
        score = Math.max(score, f * weight);
      }

      // Asset type named by the file or a folder ("TV Spots/", "_SOCIAL_").
      if (hintedTypes.size) score += hintedTypes.has(asset.type) ? 0.1 : -0.1;
      // Numbers in the slug (":30", "15") are strong discriminators when the file or its folder has one.
      const slugNumbers = assetTokens.filter((t) => /^\d+$/.test(t));
      if (slugNumbers.length && nearbyNumbers.length && !slugNumbers.some((n) => nearbyNumbers.includes(n))) score -= 0.15;
      // Running time of the file vs the asset's length.
      if (asset.length && facts.duration) {
        if (Math.abs(asset.length - facts.duration) <= 1.5) score += 0.1;
        else if (Math.abs(asset.length - facts.duration) > 10) score -= 0.05;
      }
      if (asset.mediaType && facts.mediaType && asset.mediaType !== facts.mediaType) score -= 0.15;
      // A vertical/square asset for a file in another shape is the wrong version.
      const assetShape = slugTokens.includes("vertical") ? "vertical" : slugTokens.includes("square") ? "square" : undefined;
      if (shape && assetShape && assetShape !== shape) score -= 0.15;
      if (exactSection) score = Math.max(score, 0.95);
      return { item: asset, score: Math.max(0, Math.min(0.99, score)) };
    })
    .filter((s) => s.score > 0)
    // Equal scores (same-named assets) go to the newest.
    .sort((a, b) => b.score - a.score || (b.item.created ?? 0) - (a.item.created ?? 0));
}

/** Rank projects against a file name and every folder above it. */
export function rankProjects(facts: FileFacts, projects: Project[]): Scored<Project>[] {
  const sources = [
    { text: stripExt(facts.name), weight: 1 },
    ...facts.dirs.map((d, depth) => ({ text: d, weight: Math.max(0.85, 0.95 - depth * 0.02) })),
  ].map((s) => ({ ...s, tokens: tokenize(s.text), first: s.text.split(/[_\s]/)[0]?.toUpperCase() }));

  return projects
    .map((project) => {
      const prefix = project.filePrefix?.toUpperCase();
      // A file or folder that starts with the project's file prefix ("PASSENGER_…", "PASSENGER/").
      if (prefix && sources.some((s) => s.first === prefix)) return { item: project, score: 1 };
      const words = tokenize(project.name).filter((w) => !STOP.has(w));
      const full = words.length ? words : tokenize(project.filePrefix ?? "");
      if (!full.length) return { item: project, score: 0 };
      // The franchise part of "PAW Patrol: The Dino Movie" counts as much as the full name, so every
      // PAW Patrol film ties on "Paw Patrol" and recency (or other evidence) decides between them.
      const main = tokenize(project.name.split(/:| - /)[0]).filter((w) => !STOP.has(w));
      const targets: [string[], number][] = [[full, 1]];
      if (main.length && main.length < full.length) targets.push([main, 1]);
      let score = 0;
      for (const [target, factor] of targets) {
        for (const s of sources) {
          const recall = target.reduce((sum, w) => sum + bestSim(w, s.tokens), 0) / target.length;
          let candidate = recall * s.weight * factor;
          // Single short words ("Home", "Love") match too easily; demand more for them.
          if (target.length === 1 && target[0].length <= 4) candidate *= 0.8;
          score = Math.max(score, candidate);
        }
      }
      return { item: project, score: Math.min(0.99, score) };
    })
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score);
}
