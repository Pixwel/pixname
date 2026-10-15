// AI matching: given badly named files and the Pixwel projects/assets the caller can see,
// suggest a project and asset for each. Only used for files the app's own matcher can't place.
import { generateText, Output } from "ai";
import { z } from "zod";
import { aiAvailable, languageModel } from "./model";
import { HttpError, pixwelGet, type Caller } from "./pixwel";

export const MAX_FILES = 25;
export const MAX_CANDIDATE_PROJECTS = 8;
export const MAX_EXPECTED_ASSETS = 500;

export const MatchRequest = z.object({
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(400),
        /** Folder names from the dropped folder down to the file (outermost first). */
        dirs: z.array(z.string().max(200)).max(12).default([]),
        durationSec: z.number().nonnegative().optional(),
        /** Display aspect, e.g. "16x9", "9x16", "2.39". */
        aspect: z.string().max(16).optional(),
        mediaType: z.enum(["video", "image", "audio", "document"]).optional(),
      }),
    )
    .min(1)
    .max(MAX_FILES),
  /** The app's own best guesses; their assets are what the model chooses from. */
  candidateProjectIds: z.array(z.string().min(1).max(64)).max(MAX_CANDIDATE_PROJECTS).default([]),
  /** Assets the team expects but Pixwel doesn't have yet (pasted from a delivery list in the app). */
  expectedAssets: z
    .array(z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(300), type: z.string().max(64), project: z.string().max(64) }))
    .max(MAX_EXPECTED_ASSETS)
    .default([]),
});
export type MatchRequest = z.infer<typeof MatchRequest>;

export interface Project {
  _id: string;
  name: string;
  filePrefix?: string;
  created?: number;
  archived?: boolean;
}

export interface Asset {
  _id: string;
  name: string;
  type?: string;
  length?: number;
  mediaType?: string;
  project?: string | { _id: string };
}

export interface Match {
  file: number;
  projectId: string | null;
  assetId: string | null;
  confidence: number;
  reason: string;
}

const ModelOutput = z.object({
  matches: z.array(
    z.object({
      file: z.number().int().describe("Index of the file in the list"),
      projectId: z.string().nullable().describe("A project reference from the list (P1, P2…), or null when unsure"),
      assetId: z.string().nullable().describe("An asset reference from the list (A1, A2…), or null when no asset fits"),
      confidence: z.number().min(0).max(1).describe("0..1; below 0.5 means a guess"),
      reason: z.string().describe("One short sentence a person can check"),
    }),
  ),
});

export const projectOf = (asset: Asset) => (typeof asset.project === "string" ? asset.project : asset.project?._id);

const month = (seconds?: number) => (seconds ? new Date(seconds * 1000).toISOString().slice(0, 7) : "?");

export const INSTRUCTIONS = `You match media files delivered by vendors to projects and assets in Pixwel, a film-marketing asset platform.
The goal is to find where each file belongs so it can be renamed to Pixwel's standard. Most files do NOT follow
that standard: vendors name files however they like, so expect abbreviations, typos, run-together words,
their own codes and numbering, and missing information.

Clues that work on messy names:
- A short code at the start often abbreviates the title ("STF" Street Fighter, "PP3" a third PAW Patrol film),
  but it can also be the vendor's own code or a sequence number ("0080") unrelated to the title.
- Asset names often appear whole, abbreviated or misspelled in the file name or folders
  ("Tug of War", "AvaMaxCallout" = "Ava Max Callout", "Ettiquette" = "Etiquette").
- Folder names often carry the project or asset.
- 9x16 means a vertical version, 1x1 square, 16x9 the regular one; prefer an asset whose name says "Vertical" for 9x16 files.
- Running time should be close to the asset's length when both are known.
- When titles tie, prefer the more recently created project.
- Delivery details describe how the file was exported, not which asset it is, and should be ignored for matching:
  codecs and formats (ProRes, ProRes422HQ, H264), text versions (Texted, Textless, TXTD, TXTL, Clean, NoGFX/WithGFX),
  language or region (INTL, ENG, LAS, PFR, GER-AT), audio (Stereo, 5.1, Split Audio, Narr/Dx/Mx/Fx),
  frame rates and resolutions (2398, 1080p, 2K, FLAT, SCOPE), and words like Final, v2, REV.
- Words that tell versions of the same asset apart (Green Box / White Box ONLY, With GFX / No GFX) are variants,
  not different assets.

Occasionally a file is already (partly) in the Pixwel standard, which is the format Pixname renames to:
  PROJECTPREFIX_ASSETTYPE_TITLE_LANG[-CC]_TEXT_CUSTTAG_VERSION_CODEC_ENCODE.ext
  e.g. PAWPATROL3_SOCIAL_TUG-OF-WAR_ENG_TXTD_GREEN-BOX_PRORES_1920p2398.mov
  Only when the first part exactly equals a project's file prefix does it identify the project. TITLE is the
  asset name in caps with dashes (TUG-OF-WAR = "Tug of War"); ASSETTYPE (SOCIAL, TV-SPOT-INTL, FEATURETTE, EPK,
  B-ROLL, TOOLKIT, ITR-ONLINE1…) should agree with the asset's type; CUSTTAG (GREEN-BOX) marks a variant.

Only use references from the lists (P… for projects, A… for assets). Return null rather than guessing wildly, and keep confidence honest: 0.9+ only
when the name clearly identifies it. Return one match per file, using the file's index.`;

/**
 * Short references (P1, A12) stand in for Pixwel's 24-character ids in the prompt: models copy short
 * labels reliably, but can slip on long hex ids and land on a real-but-wrong record.
 */
export function references(projects: Project[], assets: Asset[]) {
  const project = new Map(projects.map((p, i) => [p._id, `P${i + 1}`]));
  const asset = new Map(assets.map((a, i) => [a._id, `A${i + 1}`]));
  return {
    project,
    asset,
    projectFor: new Map(projects.map((p, i) => [`P${i + 1}`, p])),
    assetFor: new Map(assets.map((a, i) => [`A${i + 1}`, a])),
  };
}

/** The prompt: every project the caller can see, plus the assets of the likely ones. */
export function buildPrompt(request: MatchRequest, projects: Project[], assets: Asset[]): string {
  const refs = references(projects, assets);
  const projectLines = projects.map(
    (p) => `${refs.project.get(p._id)} | ${p.name} | prefix ${p.filePrefix ?? "-"} | created ${month(p.created)}`,
  );
  const byProject = new Map<string, Asset[]>();
  for (const a of assets) {
    const id = projectOf(a);
    if (id) byProject.set(id, [...(byProject.get(id) ?? []), a]);
  }
  const assetBlocks = [...byProject].map(([id, list]) => {
    const name = projects.find((p) => p._id === id)?.name ?? id;
    const lines = list.map(
      (a) => `${refs.asset.get(a._id)} | ${a.name} | ${a.type ?? "-"} | ${a.length ? `${a.length}s` : "-"} | ${a.mediaType ?? "-"}`,
    );
    return `Assets of ${name} (${refs.project.get(id) ?? "?"}):\nref | name | type | length | media\n${lines.join("\n")}`;
  });
  const fileLines = request.files.map((f, i) => {
    const facts = [
      f.dirs.length ? `folders ${f.dirs.join(" / ")}` : null,
      f.durationSec !== undefined ? `${Math.round(f.durationSec)}s` : null,
      f.aspect ? `aspect ${f.aspect}` : null,
      f.mediaType ?? null,
    ].filter(Boolean);
    return `${i}. ${f.name}${facts.length ? ` (${facts.join(", ")})` : ""}`;
  });

  return [
    `Projects:\nref | name | file prefix | created\n${projectLines.join("\n")}`,
    assetBlocks.length ? assetBlocks.join("\n\n") : "No candidate assets were loaded; choose projects only.",
    `Files:\n${fileLines.join("\n")}`,
  ].join("\n\n");
}

/** Turn references back into Pixwel ids, keeping only real ones with the asset inside the chosen project. */
export function validate(raw: z.infer<typeof ModelOutput>, request: MatchRequest, projects: Project[], assets: Asset[]): Match[] {
  const refs = references(projects, assets);
  const out: Match[] = request.files.map((_, file) => ({ file, projectId: null, assetId: null, confidence: 0, reason: "No suggestion" }));
  for (const m of raw.matches) {
    if (!Number.isInteger(m.file) || m.file < 0 || m.file >= request.files.length) continue;
    const asset = m.assetId ? refs.assetFor.get(m.assetId.trim().toUpperCase()) : undefined;
    // An asset settles the project; otherwise the project must be one we listed.
    const project = m.projectId ? refs.projectFor.get(m.projectId.trim().toUpperCase()) : undefined;
    const projectId = asset ? projectOf(asset) ?? null : project?._id ?? null;
    if (!projectId) continue;
    out[m.file] = {
      file: m.file,
      projectId,
      assetId: asset ? asset._id : null,
      confidence: Math.max(0, Math.min(1, m.confidence)),
      reason: m.reason.slice(0, 300),
    };
  }
  return out;
}

/** Expected assets of the candidate projects, unless Pixwel now has an asset by that name. */
export function expectedOf(request: MatchRequest, candidates: string[], real: Asset[]): Asset[] {
  const names = new Set(real.map((a) => `${projectOf(a)}|${a.name.trim().toLowerCase()}`));
  return request.expectedAssets
    .filter((a) => candidates.includes(a.project) && !names.has(`${a.project}|${a.name.trim().toLowerCase()}`))
    .map((a) => ({ _id: a.id, name: a.name, type: a.type, project: a.project }));
}

export async function match(caller: Caller, request: MatchRequest): Promise<Match[]> {
  if (!aiAvailable()) throw new HttpError(503, "AI matching is off on this service (PIXNAME_AI=off, or no model key)");

  const projects = (await pixwelGet<Project[]>(caller, "projects")).filter((p) => !p.archived);
  const visible = new Set(projects.map((p) => p._id));
  // Only projects the caller can see; their assets come from Pixwel with the caller's own token.
  const candidates = request.candidateProjectIds.filter((id) => visible.has(id));
  const real = (await Promise.all(candidates.map((id) => pixwelGet<Asset[]>(caller, "assets", { project: id })))).flat();
  const assets = [...real, ...expectedOf(request, candidates, real)];

  const { output } = await generateText({
    model: languageModel(),
    system: INSTRUCTIONS,
    prompt: buildPrompt(request, projects, assets),
    output: Output.object({ schema: ModelOutput }),
  });
  return validate(output, request, projects, assets);
}
