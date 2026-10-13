// Assemble everything known about a file into the SDK's ingest shape and render the name.
// Precedence follows the platform: filename < ffprobe tags < mediainfo < work request < user.
import { Ingest } from "@pixwel/pixwel-sdk";
import type { Asset, Catalog, DownloadTags, Project, QueueItem, WorkRequest } from "./types";
import { DEFAULT_TEXT_TAGS, parseFilename } from "./parse";
import { assetTitleToken, contextHints, dirsOf } from "./fuzzy";
import { tagsFromFfprobe, tagsFromMediainfo } from "./media";

export interface Proposal {
  name?: string;
  error?: string;
  warnings: string[];
  notes: string[];
  language?: string;
  country?: string;
  version?: string;
  tags: DownloadTags;
  unchanged: boolean;
}

export interface ProposeContext {
  catalog: Catalog;
  projects: Project[];
  project?: Project;
  asset?: Asset;
  workRequest?: WorkRequest;
}

/** npm `slugify` defaults, as the UI uses to build work request tag tokens. */
export const slugifyTag = (name: string) =>
  name
    .replace(/[^\w\s$*_+~.()'"!\-:@]+/g, "")
    .trim()
    .replace(/[-\s]+/g, "-");

const codeOf = (v: unknown): string | undefined =>
  !v ? undefined : typeof v === "string" ? v : (v as { code?: string }).code;

export const isSubOrder = (wr: WorkRequest) => {
  if (!wr.dng) return false;
  if (wr.dng === "Subtitled") return true;
  return JSON.stringify(wr.dng).includes("Subtitled");
};

export const isDubOrder = (wr: WorkRequest) => {
  if (!wr.dng || typeof wr.dng !== "object") return false;
  return (wr.dng.dialogue ?? []).includes("Dedicated / Localized") || (wr.dng.narration ?? []).includes("Dedicated / Localized");
};

/** Mirrors WorkRequests::revisionByTagSlug. */
export function revisionFor(wr: WorkRequest, tagSlug?: string | null): number {
  let revision = 0;
  for (const r of wr.rejections ?? []) {
    if ((r.tag && slugifyTag(r.tag) === tagSlug) || (!r.tag && !tagSlug)) revision = r.revision ?? 0;
  }
  return revision;
}

export function propose(item: QueueItem, ctx: ProposeContext): Proposal {
  const { catalog, project, asset, workRequest } = ctx;
  const o = item.overrides;
  const warnings: string[] = [];
  const notes: string[] = [];
  const tags: DownloadTags = { SubDub: { sub: null, dub: null }, Extra: [] };
  const result = (extra: Partial<Proposal>): Proposal => ({ warnings, notes, tags, unchanged: false, ...extra });

  // 1. Filename: strict platform parse, plus loose hints for messy names.
  const parsed = parseFilename(item.file.name, catalog, ctx.projects);
  const hints = contextHints(item.file.name, dirsOf(item.file), catalog);
  const HINT_LABELS: Record<string, string> = { language: "Language", sub: "SUB", dub: "DUB", text: "Text", version: "Version" };
  for (const [field, dir] of Object.entries(hints.from)) {
    if (HINT_LABELS[field]) notes.push(`${HINT_LABELS[field]} taken from folder “${dir}”`);
  }
  const filenameTags = new Set(parsed.tags);
  if (hints.sub) filenameTags.add("sub");
  if (hints.dub) filenameTags.add("dub");
  if (hints.text) filenameTags.add(hints.text);
  const filenameGroups: Record<string, string[]> = {};
  for (const name of filenameTags) {
    const tag = catalog.tags.find((t) => t.name === name);
    if (tag?.type) (filenameGroups[tag.type] ??= []).push(tag.name);
  }

  // 2. ffprobe tags replace filename tags group by group (InferSelectedDownload).
  const ffGroups = item.probe?.ffprobe ? tagsFromFfprobe(item.probe.ffprobe, catalog.tags) : {};
  for (const [group, values] of Object.entries(ffGroups)) {
    const fromName = filenameGroups[group];
    if (fromName && fromName.some((v) => !values.includes(v))) {
      notes.push(`${group}: file says ${values.join("/")}, name says ${fromName.join("/")} — using the file`);
    }
  }
  const groups = { ...filenameGroups, ...ffGroups };
  for (const [group, values] of Object.entries(groups)) {
    if (group === "SubDub") values.forEach((v) => ((tags.SubDub as any)[v] = true));
    else tags[group] = values[0];
  }

  // Leftover parts only become Extra tokens when the name was already in the standard form;
  // for messy names they would just be noise.
  const looksStandard = !!parsed.projectId && !!asset && item.file.name.split(/[_.]/).includes(assetTitleToken(asset));
  if (looksStandard) tags.Extra = parsed.extra.filter((p) => !/^REV\d*$/.test(p));

  // 3. mediainfo (via the SDK) wins over both.
  const mediainfoTags = tagsFromMediainfo(item.probe, item.mediaType);
  for (const [k, v] of Object.entries(mediainfoTags)) if (v !== null && v !== undefined) tags[k] = v;

  let language = parsed.language ?? hints.language;
  let country = parsed.language ? parsed.country : undefined;
  let version: string | undefined = hints.version;

  // 4. Work request context (Ingest.assemble).
  if (workRequest) {
    tags.Extra = [];
    const tagSlug = o.workRequestTag ? slugifyTag(o.workRequestTag) : null;
    if (tagSlug) tags.Extra = [tagSlug];
    const revision = revisionFor(workRequest, tagSlug);
    version = revision ? (revision === 1 ? "REV" : `REV${revision}`) : undefined;
    const territory = codeOf(workRequest.territory);
    if (territory) country = territory;
    const wrLanguage = codeOf(workRequest.language);
    if (wrLanguage) language = wrLanguage;
    tags.Text = "txtd";
    if (isSubOrder(workRequest) || isDubOrder(workRequest)) {
      tags.SubDub = { sub: isSubOrder(workRequest), dub: isDubOrder(workRequest) };
    }
  }

  // 5. Explicit user edits.
  if (o.language !== undefined) language = o.language || undefined;
  if (o.country !== undefined) country = o.country || undefined;
  if (o.text !== undefined) tags.Text = o.text || null;
  if (o.sub !== undefined) tags.SubDub = { ...tags.SubDub, sub: o.sub };
  if (o.dub !== undefined) tags.SubDub = { ...tags.SubDub, dub: o.dub };
  if (o.extra !== undefined) tags.Extra = o.extra;
  if (o.version !== undefined) version = o.version || undefined;
  if (o.codec !== undefined) tags.Codec = o.codec || null;
  if (o.frameMode !== undefined) tags["Frame Mode"] = o.frameMode || null;

  if (!project) return result({ error: "Choose a project", language, country, version });
  if (!project.filePrefix) return result({ error: `Project "${project.name}" has no file prefix`, language, country, version });
  if (!asset) return result({ error: "Choose an asset", language, country, version });
  if (!language) return result({ error: "Choose a language", language, country, version });

  // Default text tag by asset type category (parse.js defaultTextTag).
  if (!tags.Text && !tags.SubDub.sub && !tags.SubDub.dub) {
    const category = catalog.types.find((t) => t.name === asset.type)?.category ?? "av";
    const fallback = DEFAULT_TEXT_TAGS[category]?.[0];
    if (fallback) tags.Text = fallback;
  }

  if (item.mediaType === "video") {
    if (!tags["Frame Mode"]) {
      tags["Frame Mode"] = "progressive";
      warnings.push("Scan type unknown — assumed progressive");
    }
    if (!item.probe?.ffprobe && !item.probe?.mediainfo) warnings.push("No media metadata — install ffprobe or mediainfo");
    else if (tags.Resolution && !tags.Aspect) {
      warnings.push("Display aspect ratio isn't in the platform table, so (like ingest) no resolution token is added");
    } else if (tags.Resolution && !tags.Standard) {
      warnings.push(`Frame rate ${tags.Framerate ?? "?"} has no NTSC/PAL standard, so no resolution token is added`);
    }
  }

  const ext = (item.ext || "").toLowerCase();
  try {
    const ingest = new Ingest({
      asset: {
        name: asset.name,
        slug: asset.slug,
        type: asset.type,
        length: asset.length,
        mediaType: item.mediaType,
        project: { filePrefix: project.filePrefix },
      },
      selected: {
        download: structuredClone({ language, country: country ?? "WW", version, tags }),
      },
    });
    const name: string = ingest.renderFilename({ allTags: catalog.tags, allTypes: catalog.types, extension: ext });
    return result({ name, language, country, version, unchanged: name === item.file.name });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return result({ error: message.replace(/^missing options\.tags\[?\.?/, "Missing ").replace(/\]$/, ""), language, country, version });
  }
}
