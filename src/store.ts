import { log, percent } from "./log";
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { FALLBACK_CATALOG, apiGet, fetchAssets, fetchProjects, fetchStudios, fetchWorkRequests, loadCatalog } from "./lib/api";
import { loadAliases, loadExpected, loadSettings, saveAliases, saveExpected, saveSettings, type Aliases, type ExpectedAssets, type Settings, DEFAULT_SETTINGS } from "./lib/settings";
import { expectedAsset, isExpected, withExpected } from "./lib/expected";
import { mediaTypeOf, durationOf } from "./lib/media";
import { parseFilename } from "./lib/parse";
import { dirsOf, rankAssets } from "./lib/fuzzy";
import { knownCode, vendorCode } from "./lib/abbrev";
import type { ConventionRow, Conventions } from "./lib/conventions";
import { assetEvidence, chooseProject, codeStrengths, combine, nameScores, searchQueries, teamStrength } from "./lib/projectMatch";
import { ruleFor, service, serviceEnabled, type AiFile, type AssetRule, type Health, type Resolution, type SharedCodes } from "./lib/service";
import type { Asset, Catalog, FileEntry, Match, MatchSource, Overrides, Probe, Project, QueueItem, WorkRequest } from "./lib/types";

/** A fuzzy asset guess is applied when it scores this well… */
const ASSET_THRESHOLD = 0.45;
/** …or when it scores at least this and clearly leads the runner-up. */
const ASSET_LEAD_THRESHOLD = 0.35;
const ASSET_LEAD = 0.1;
const PROBE_CONCURRENCY = 4;
/** Team memory only counts for files this alike (0..1)… */
const TEAM_MIN_SIMILARITY = 0.6;
/** …and settles the asset too when this alike. */
const TEAM_ASSET_SIMILARITY = 0.8;
/** Files the rules placed with less confidence than this are worth asking AI about. */
const AI_WHEN_BELOW = 0.75;
/** An AI suggestion is applied when at least this confident; below it's shown but not applied. */
const AI_APPLY_AT = 0.5;
/** Files per AI request. */
const AI_BATCH = 25;
/** Sources a person chose; nothing automatic replaces them. */
const CHOSEN: MatchSource[] = ["drop", "manual"];
/** How much an admin's asset rule counts toward its project. */
const RULE_STRENGTH = 0.95;

type Loadable<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: string };

export interface DropTarget {
  projectId?: string;
  assetId?: string;
}

export interface RenameResult {
  from: string;
  to: string;
  ok: boolean;
  error?: string | null;
}

interface State {
  settings: Settings;
  settingsLoaded: boolean;
  settingsOpen: boolean;
  logOpen: boolean;
  tools: { ffprobe?: string | null; mediainfo?: string | null; mediainfoBundled?: boolean };
  catalog: Catalog;
  catalogWarnings: string[];
  projects: Loadable<Project[]>;
  /** Studio names by id (projects carry only the id). */
  studios: Record<string, string>;
  assets: Record<string, Loadable<Asset[]>>;
  workRequests: Record<string, Loadable<WorkRequest[]>>;
  selectedProjectId?: string;
  view: "browse" | "review" | "activity";
  items: QueueItem[];
  lastResults?: RenameResult[];
  canUndo: boolean;
  /** Vendor codes learned from confirmed renames on this machine, e.g. { STF: "<street fighter id>" }. */
  aliases: Aliases;
  /** The Pixname service, when configured: shared codes, team memory and AI. */
  service: { status: "off" } | { status: "loading" } | { status: "ready"; health: Health } | { status: "error"; error: string };
  /** Vendor codes the whole team has confirmed (from the service). */
  sharedCodes: SharedCodes;
  /** Admins' asset rules: "a file name containing these words is this asset" (from the service). */
  assetRules: AssetRule[];
  /** House styles per studio or project, set by admins (from the service; lib/conventions). */
  conventions: ConventionRow[];
  setConventions(scope: ConventionRow["scope"], targetId: string, values: Conventions): Promise<void>;
  /** Assets pasted from a delivery list that Pixwel doesn't have yet, by project; matched like real ones. */
  expected: ExpectedAssets;
  /** Pixname-wide rules and activity changed (rules added/removed); views refetch on this. */
  rulesVersion: number;
  reloadRules(): Promise<void>;

  init(): Promise<void>;
  openSettings(open: boolean): void;
  openLog(open: boolean): void;
  updateSettings(settings: Settings): Promise<void>;
  refresh(): Promise<void>;
  selectProject(id?: string): void;
  setView(view: State["view"]): void;
  ensureAssets(projectId: string): Promise<Asset[]>;
  ensureWorkRequests(projectId: string): Promise<WorkRequest[]>;
  addPaths(paths: string[], target: DropTarget): Promise<void>;
  updateItem(id: string, patch: Partial<QueueItem>): void;
  setOverrides(ids: string[], overrides: Overrides): void;
  setAsset(ids: string[], projectId: string | undefined, assetId: string | undefined): void;
  /** Use the team's or the AI's suggestion for a file (kept as that source, so it counts as right). */
  acceptSuggestion(id: string, from: "team" | "ai"): void;
  toggleSelected(id: string, selected?: boolean): void;
  selectAll(selected: boolean, ids?: string[]): void;
  removeItems(ids: string[]): void;
  applyRenames(ops: { id: string; from: string; to: string }[]): Promise<RenameResult[]>;
  undo(): Promise<RenameResult[]>;
  /** Forget one remembered code, or all of them when no code is given. */
  forgetAliases(code?: string): Promise<void>;
  /** Point a remembered code at a different project (for the whole team when the service is connected). */
  setAlias(code: string, projectId: string): Promise<void>;
  /** Ask the service's AI about these files (all of them when asked by hand). */
  askAi(ids: string[], manual?: boolean): Promise<void>;
  /** Add expected asset names to a project; returns how many were new. */
  addExpected(projectId: string, names: string[], type: string): Promise<number>;
  /** Forget one expected asset, or all of a project's when no id is given. */
  removeExpected(projectId: string, assetId?: string): Promise<void>;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useStore = create<State>((set, get) => {
  const pending = new Map<string, Promise<any>>();
  /** Assets as Pixwel returned them, by project; `assets` adds the expected ones on top. */
  const realAssets = new Map<string, Asset[]>();

  /** Rebuild a loaded project's asset list after its expected assets changed. */
  const remerge = (projectId: string) => {
    const real = realAssets.get(projectId);
    if (real) set((s) => ({ assets: { ...s.assets, [projectId]: { status: "ready", data: withExpected(real, s.expected[projectId]) } } }));
  };

  /** Show a new set of expected assets in every loaded project they touch. */
  function showExpected(expected: ExpectedAssets) {
    const touched = new Set([...Object.keys(get().expected), ...Object.keys(expected)]);
    set({ expected });
    touched.forEach(remerge);
  }

  let expectedFetchedAt = 0;
  /** Expected assets: the team's lists from the service, or this computer's when working alone. */
  async function loadExpectedLists(force = true) {
    const settings = get().settings;
    if (!serviceReady()) {
      showExpected(await loadExpected(settings).catch(() => ({})));
      return;
    }
    if (!force && Date.now() - expectedFetchedAt < 30_000) return;
    expectedFetchedAt = Date.now();
    try {
      // Lists pasted on this computer before the team shared them move to the service once.
      const local = await loadExpected(settings).catch(() => ({}) as ExpectedAssets);
      if (Object.keys(local).length) {
        for (const [projectId, list] of Object.entries(local)) {
          const byType = new Map<string, string[]>();
          for (const a of list) byType.set(a.type, [...(byType.get(a.type) ?? []), a.name]);
          for (const [type, names] of byType) await service.addExpected(settings, projectId, type, names).catch(() => 0);
        }
        await saveExpected(settings, {});
        log.info(`Shared this computer's expected assets with the team`);
      }
      const expected: ExpectedAssets = {};
      for (const a of await service.expected(settings)) {
        (expected[a.projectId] ??= []).push(expectedAsset(a.projectId, a.name, a.type, a.addedBy));
      }
      showExpected(expected);
    } catch (e) {
      log.warn(`Loading the team's expected assets failed: ${errorText(e)}`);
    }
  }

  /** Re-match files of a project after its expected assets changed. */
  function rematchProject(projectId: string, removed = new Set<string>()) {
    const affected = get().items.filter((i) => i.asset && removed.has(i.asset.id));
    for (const i of affected) get().updateItem(i.id, { asset: undefined });
    get()
      .items.filter((i) => !i.probing && i.project?.id === projectId && (!i.asset || i.asset.source === "fuzzy"))
      .forEach((i) => match(i.id));
  }
  /** Cross-project asset searches by query, shared by every file in a drop. */
  const assetSearches = new Map<string, Promise<Asset[]>>();

  const searchAssets = (query: string) => {
    const key = query.toLowerCase();
    if (!assetSearches.has(key)) {
      assetSearches.set(key, apiGet<Asset[]>(get().settings, "assets", { q: query, limit: 200 }).catch(() => []));
    }
    return assetSearches.get(key)!;
  };

  /**
   * Guess the project for a file nobody assigned one to. The file's own project prefix settles it;
   * otherwise every clue adds up: the name and folders, vendor codes the team (or this machine)
   * confirmed, how the team resolved similar files, and assets elsewhere that match the name.
   */
  async function guessProject(item: QueueItem, facts: ReturnType<typeof factsOf>, projects: Project[]): Promise<Match | undefined> {
    const parsed = parseFilename(item.file.name, get().catalog, projects);
    if (parsed.projectId) return { id: parsed.projectId, source: "prefix", score: 1 };

    const created = new Map(projects.map((p) => [p._id, p.created ?? 0]));
    const names = nameScores(facts, projects, get().studios);
    // The strongest clue behind each project's score, to say how it was matched.
    const why = new Map<string, { source: MatchSource; strength: number }>();
    for (const [id, score] of names) why.set(id, { source: "fuzzy", strength: score });
    const add = (id: string, strength: number, source: MatchSource) => {
      if (!created.has(id) || strength <= 0) return;
      names.set(id, combine(names.get(id) ?? 0, strength));
      if (strength > (why.get(id)?.strength ?? 0)) why.set(id, { source, strength });
    };

    const code = knownCode(item.file.name, [...Object.keys(get().aliases), ...Object.keys(get().sharedCodes)]);
    if (code) for (const [id, strength] of codeStrengths(get().aliases[code], get().sharedCodes[code])) add(id, strength, "learned");
    if (item.team && item.team.similarity >= TEAM_MIN_SIMILARITY) add(item.team.projectId, teamStrength(item.team), "team");
    // An admin's asset rule is a deliberate decision: nearly as good as the file's own prefix.
    const rule = ruleFor(item.file.name, get().assetRules);
    if (rule) add(rule.projectId, RULE_STRENGTH, "rule");

    let evidence = new Map<string, { score: number }>();
    if (Math.max(0, ...names.values()) < 1) {
      const found = (await Promise.all(searchQueries(item.file.name, get().catalog).map(searchAssets))).flat();
      const unique = [...new Map(found.map((a) => [a._id, a])).values()];
      evidence = assetEvidence(facts, unique, get().catalog);
      // Only projects the user can pick count (archived ones aren't listed).
      for (const id of evidence.keys()) if (!created.has(id)) evidence.delete(id);
    }
    const best = chooseProject(names, evidence, created);
    if (!best) return undefined;
    const source = why.get(best.item)?.source ?? "fuzzy";
    return { id: best.item, source, score: best.score };
  }

  const factsOf = (item: QueueItem) => ({
    name: item.file.name,
    dirs: dirsOf(item.file),
    duration: durationOf(item.probe),
    mediaType: item.mediaType,
  });

  /** Fill in project/asset guesses for one item from its name, folders and probe. */
  async function match(id: string) {
    const item = get().items.find((i) => i.id === id);
    const projects = get().projects;
    if (!item || projects.status !== "ready") return;
    const facts = factsOf(item);

    // A project from a person or the AI stays; rules re-run otherwise (e.g. after probing).
    const keep = item.project && (CHOSEN.includes(item.project.source) || item.project.source === "ai" || item.project.accepted);
    const project = keep ? item.project : (await guessProject(item, facts, projects.data)) ?? item.project;
    if (!project) {
      log.info(`No confident project for "${item.file.name}" (folders: ${facts.dirs.join(" / ") || "none"})`);
      return;
    }
    // Someone (or the AI) may have picked a project while we were searching.
    const current = get().items.find((i) => i.id === id);
    const settled =
      current?.project && (CHOSEN.includes(current.project.source) || current.project.source === "ai" || current.project.accepted);
    if (settled && current!.project!.id !== project.id) return;

    let asset = item.asset;
    // An automatic asset belongs to the project it was found in.
    if (asset && item.project?.id !== project.id && !CHOSEN.includes(asset.source) && !asset.accepted) asset = undefined;
    const team = item.team;
    const rule = ruleFor(item.file.name, get().assetRules);
    if (asset?.accepted) {
      // Keep what a person accepted.
    } else if ((!asset || !CHOSEN.includes(asset.source)) && rule && rule.projectId === project.id) {
      asset = { id: rule.assetId, source: "rule", score: RULE_STRENGTH };
    } else if (
      (!asset || asset.source === "fuzzy") &&
      team?.assetId &&
      team.projectId === project.id &&
      team.similarity >= TEAM_ASSET_SIMILARITY
    ) {
      asset = { id: team.assetId, source: "team", score: teamStrength(team) };
    } else if (!asset || asset.source === "fuzzy") {
      const assets = await get().ensureAssets(project.id);
      const projectRecord = projects.data.find((p) => p._id === project!.id);
      const [best, runnerUp] = rankAssets(facts, assets, get().catalog.types, get().catalog, projectRecord);
      const leads = best && best.score >= ASSET_LEAD_THRESHOLD && best.score - (runnerUp?.score ?? 0) >= ASSET_LEAD;
      if (best && (best.score >= ASSET_THRESHOLD || leads)) {
        asset = { id: best.item._id, source: best.score === 1 ? "prefix" : "fuzzy", score: best.score };
      }
    }
    // Keep Pixname's latest own suggestion; a person's choice doesn't erase what it had guessed.
    const automatic = (m?: Match) => (m && !CHOSEN.includes(m.source) ? m : undefined);
    const guess = { project: automatic(project) ?? item.guess?.project, asset: automatic(asset) ?? item.guess?.asset };
    get().updateItem(id, { project, asset, guess });

    // Why a file landed where it did: the first thing to check when a match looks wrong.
    const loaded = get().assets[project.id];
    const assetName = !asset
      ? "no asset"
      : (loaded?.status === "ready" ? loaded.data.find((a) => a._id === asset!.id)?.name : undefined) ?? asset.id;
    const projectName = projects.data.find((p) => p._id === project.id)?.name ?? project.id;
    log.info(
      `Matched "${item.file.name}" -> ${projectName} (${project.source} ${percent(project.score)}) / ${assetName}` +
        (asset ? ` (${asset.source} ${percent(asset.score)})` : ""),
    );
  }

  async function probe(id: string) {
    const { file } = get().items.find((i) => i.id === id)!;
    const { ffprobePath, mediainfoPath } = get().settings;
    try {
      const result = await invoke<Probe>("probe_file", {
        path: file.path,
        ffprobe: ffprobePath || null,
        mediainfo: mediainfoPath || null,
      });
      get().updateItem(id, { probe: result, probing: false });
    } catch (e) {
      log.warn(`Probe failed for "${file.path}": ${errorText(e)}`);
      get().updateItem(id, { probe: { errors: [errorText(e)] }, probing: false });
    }
    await match(id);
  }

  /** Connect to the Pixname service (if configured) and load the team's vendor codes. */
  async function loadService() {
    const { settings } = get();
    if (!serviceEnabled(settings)) {
      set({ service: { status: "off" }, sharedCodes: {}, assetRules: [], conventions: [] });
      await loadExpectedLists();
      return;
    }
    set({ service: { status: "loading" } });
    try {
      const [health, sharedCodes, assetRules] = await Promise.all([
        service.health(settings),
        service.codes(settings),
        service.rules(settings),
      ]);
      set({ service: { status: "ready", health }, sharedCodes, assetRules });
      // Separately, so an older service without conventions still connects.
      service
        .conventions(settings)
        .then((conventions) => set({ conventions }))
        .catch((e) => log.warn(`Loading conventions failed: ${errorText(e)}`));
      log.info(`Pixname service connected (${health.ai ? `AI: ${health.model}` : "AI off"}), ${Object.keys(sharedCodes).length} shared codes`);
    } catch (e) {
      set({ service: { status: "error", error: errorText(e) } });
      log.warn(`Pixname service unavailable: ${errorText(e)}`);
    }
    await loadExpectedLists();
  }

  const serviceReady = () => get().service.status === "ready";

  /** Expected assets aren't in Pixwel, so their ids mean nothing to the team's records. */
  const pixwelAsset = (id?: string) => (id && !isExpected(id) ? id : null);

  /** Tell the service how renamed files were resolved: shared codes and team memory for everyone. */
  function reportRenames(items: QueueItem[], newNames: Map<string, string>) {
    if (!serviceReady() || !items.length) return;
    const settings = get().settings;
    const projects = get().projects.status === "ready" ? (get().projects as { data: Project[] }).data : [];
    const resolutions: Resolution[] = items
      .filter((i) => i.project)
      .map((i) => ({
        name: i.file.name,
        dirs: dirsOf(i.file),
        projectId: i.project!.id,
        assetId: pixwelAsset(i.asset?.id),
        source: i.project!.source,
        guess: i.guess?.project
          ? { projectId: i.guess.project.id, assetId: pixwelAsset(i.guess.asset?.id), source: i.guess.project.source, score: i.guess.project.score }
          : null,
        newName: newNames.get(i.file.path) ?? null,
        size: i.file.size,
        durationSec: durationOf(i.probe) ?? null,
        fingerprint: i.probe?.fingerprint ?? null,
      }));
    const votes = items.flatMap((i) => {
      const code = vendorCode(i.file.name);
      const prefix = projects.find((p) => p._id === i.project?.id)?.filePrefix?.toUpperCase();
      return code && i.project && code !== prefix && !/^\d+$/.test(code) ? [{ code, projectId: i.project.id }] : [];
    });
    service.record(settings, resolutions).catch((e) => log.warn(`Recording renames failed: ${errorText(e)}`));
    if (votes.length) {
      service
        .vote(settings, votes)
        .then(() => service.codes(settings))
        .then((sharedCodes) => set({ sharedCodes }))
        .catch((e) => log.warn(`Sharing vendor codes failed: ${errorText(e)}`));
    }
  }

  /** Warn about files someone already renamed (same content), so nothing is delivered twice. */
  async function checkDelivered(ids: string[]) {
    if (!serviceReady() || !ids.length) return;
    const items = ids.map((id) => get().items.find((i) => i.id === id)).filter(Boolean) as QueueItem[];
    try {
      const matches = await service.seen(
        get().settings,
        items.map((i) => ({
          name: i.file.name,
          fingerprint: i.probe?.fingerprint,
          size: i.file.size,
          durationSec: durationOf(i.probe),
        })),
      );
      items.forEach((item, n) => {
        const m = matches[n];
        get().updateItem(item.id, {
          delivered: m ? { newName: m.newName, name: m.name, userName: m.userName, at: m.at, projectId: m.projectId, assetId: m.assetId } : null,
        });
        if (m) log.info(`Already delivered: "${item.file.name}" matches "${m.name}" -> "${m.newName ?? "?"}" (${m.userName})`);
      });
    } catch (e) {
      log.warn(`Delivery check failed: ${errorText(e)}`);
    }
  }

  /** How the team resolved files like these before; stored on the items as a clue. */
  async function lookupTeam(ids: string[]) {
    if (!serviceReady() || !ids.length) return;
    const items = ids.map((id) => get().items.find((i) => i.id === id)).filter(Boolean) as QueueItem[];
    try {
      const matches = await service.lookup(get().settings, items.map((i) => i.file.name));
      items.forEach((item, n) => get().updateItem(item.id, { team: matches[n] }));
      const found = matches.filter(Boolean).length;
      if (found) log.info(`Team memory: ${found} of ${items.length} file(s) resemble earlier renames`);
    } catch (e) {
      log.warn(`Team memory lookup failed: ${errorText(e)}`);
    }
  }

  const aspectOf = (probe?: Probe): string | undefined => {
    const video = (probe?.ffprobe as any)?.streams?.find((s: any) => s.codec_type === "video");
    if (video?.width && video?.height) return `${video.width}x${video.height}`;
    const track = (probe?.mediainfo as any)?.media?.track?.find((t: any) => t["@type"] === "Video");
    return track?.Width && track?.Height ? `${track.Width}x${track.Height}` : undefined;
  };

  /** Files the rules and team memory couldn't place well enough. */
  const needsAi = (i: QueueItem) =>
    !i.probing &&
    !i.aiPending &&
    !i.ai &&
    !(i.project && (CHOSEN.includes(i.project.source) || i.project.source === "prefix")) &&
    (!i.project || i.project.score < AI_WHEN_BELOW || !i.asset);

  async function probeAll(ids: string[]) {
    const queue = [...ids];
    const worker = async () => {
      while (queue.length) await probe(queue.shift()!);
    };
    await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));
  }

  return {
    settings: DEFAULT_SETTINGS,
    settingsLoaded: false,
    settingsOpen: false,
    logOpen: false,
    tools: {},
    catalog: FALLBACK_CATALOG,
    catalogWarnings: [],
    projects: { status: "loading" },
    studios: {},
    assets: {},
    workRequests: {},
    view: "browse",
    items: [],
    canUndo: false,
    aliases: {},
    service: { status: "off" },
    sharedCodes: {},
    assetRules: [],
    conventions: [],
    expected: {},
    rulesVersion: 0,

    async reloadRules() {
      if (!serviceReady()) return;
      const settings = get().settings;
      const [sharedCodes, assetRules] = await Promise.all([service.codes(settings), service.rules(settings)]);
      set((s) => ({ sharedCodes, assetRules, rulesVersion: s.rulesVersion + 1 }));
      // Re-run matching for files nobody has settled yet.
      get()
        .items.filter((i) => !i.probing && !(i.project && (CHOSEN.includes(i.project.source) || i.project.accepted)))
        .forEach((i) => match(i.id));
    },

    async init() {
      const settings = await loadSettings();
      set({ settings, settingsLoaded: true, settingsOpen: !settings.token });
      loadAliases(settings).then((aliases) => set({ aliases })).catch(() => {});
      invoke<boolean>("has_undo").then((canUndo) => set({ canUndo }));
      await get().refresh();
    },

    openSettings(open) {
      set({ settingsOpen: open });
    },

    openLog(open) {
      set({ logOpen: open });
    },

    async updateSettings(settings) {
      await saveSettings(settings);
      assetSearches.clear();
      realAssets.clear();
      set({
        settings,
        settingsOpen: false,
        assets: {},
        workRequests: {},
        aliases: await loadAliases(settings).catch(() => ({})),
        expected: {},
      });
      await get().refresh();
    },

    async refresh() {
      const { settings } = get();
      invoke<State["tools"]>("tool_status", {
        ffprobe: settings.ffprobePath || null,
        mediainfo: settings.mediainfoPath || null,
      }).then((tools) => set({ tools }));
      if (!settings.token) {
        set({ projects: { status: "error", error: "Add an API token in Settings to load projects." } });
        return;
      }
      loadService();
      set({ projects: { status: "loading" } });
      const [catalogResult, projectsResult, studiosResult] = await Promise.allSettled([
        loadCatalog(settings),
        fetchProjects(settings),
        fetchStudios(settings),
      ]);
      // Studios only help matching ("FFSS26" = Focus Features' Sense and Sensibility) and filtering.
      if (studiosResult.status === "fulfilled") set({ studios: studiosResult.value });
      else log.warn(`Loading studios failed: ${errorText(studiosResult.reason)}`);
      if (catalogResult.status === "fulfilled") {
        set({ catalog: catalogResult.value.catalog, catalogWarnings: catalogResult.value.warnings });
        for (const w of catalogResult.value.warnings) log.warn(`Reference data: ${w}`);
      }
      if (projectsResult.status === "fulfilled") {
        const data = [...projectsResult.value].sort((a, b) => a.name.localeCompare(b.name));
        set({ projects: { status: "ready", data } });
        log.info(`Loaded ${data.length} projects from ${settings.environment}`);
        // Items dropped before projects loaded can be matched now.
        get().items.filter((i) => !i.probing).forEach((i) => match(i.id));
      } else {
        set({ projects: { status: "error", error: errorText(projectsResult.reason) } });
        log.error(`Loading projects from ${settings.environment} failed: ${errorText(projectsResult.reason)}`);
      }
    },

    selectProject(id) {
      set({ selectedProjectId: id });
      if (id) loadExpectedLists(false);
      if (id) get().ensureAssets(id).catch(() => {});
    },

    setView(view) {
      set({ view });
    },

    async ensureAssets(projectId) {
      const existing = get().assets[projectId];
      if (existing?.status === "ready") return existing.data;
      const key = `assets:${projectId}`;
      if (!pending.has(key)) {
        set((s) => ({ assets: { ...s.assets, [projectId]: { status: "loading" } } }));
        const p = fetchAssets(get().settings, projectId)
          .then((data) => {
            realAssets.set(projectId, data);
            const merged = withExpected(data, get().expected[projectId]);
            set((s) => ({ assets: { ...s.assets, [projectId]: { status: "ready", data: merged } } }));
            return merged;
          })
          .catch((e) => {
            log.error(`Loading assets for ${projectId} failed: ${errorText(e)}`);
            set((s) => ({ assets: { ...s.assets, [projectId]: { status: "error", error: errorText(e) } } }));
            return [] as Asset[];
          })
          .finally(() => pending.delete(key));
        pending.set(key, p);
      }
      return pending.get(key)!;
    },

    async ensureWorkRequests(projectId) {
      const existing = get().workRequests[projectId];
      if (existing?.status === "ready") return existing.data;
      const key = `wr:${projectId}`;
      if (!pending.has(key)) {
        set((s) => ({ workRequests: { ...s.workRequests, [projectId]: { status: "loading" } } }));
        const p = fetchWorkRequests(get().settings, projectId)
          .then((data) => {
            set((s) => ({ workRequests: { ...s.workRequests, [projectId]: { status: "ready", data } } }));
            return data;
          })
          .catch((e) => {
            set((s) => ({ workRequests: { ...s.workRequests, [projectId]: { status: "error", error: errorText(e) } } }));
            return [] as WorkRequest[];
          })
          .finally(() => pending.delete(key));
        pending.set(key, p);
      }
      return pending.get(key)!;
    },

    async addPaths(paths, target) {
      loadExpectedLists(false);
      const entries = await invoke<FileEntry[]>("expand_paths", { paths });
      log.info(
        `Added ${entries.length} file(s) from ${paths.length} path(s)` +
          (target.projectId ? ` onto project ${target.projectId}${target.assetId ? ` / asset ${target.assetId}` : ""}` : ""),
      );
      const known = new Set(get().items.map((i) => i.file.path));
      const fresh: QueueItem[] = entries
        .filter((f) => !known.has(f.path))
        .map((file) => {
          const dot = file.name.lastIndexOf(".");
          const ext = dot > 0 ? file.name.slice(dot + 1) : "";
          return {
            id: file.path,
            file,
            ext,
            mediaType: mediaTypeOf(ext),
            probing: true,
            project: target.projectId ? { id: target.projectId, source: "drop", score: 1 } : undefined,
            asset: target.assetId ? { id: target.assetId, source: "drop", score: 1 } : undefined,
            overrides: {},
            selected: true,
          };
        });
      // Re-dropping files already queued onto an asset re-targets them.
      const retarget = entries.filter((f) => known.has(f.path)).map((f) => f.path);
      if (retarget.length && target.projectId) get().setAsset(retarget, target.projectId, target.assetId);

      set((s) => ({ items: [...s.items, ...fresh], view: "review", lastResults: undefined }));
      if (target.projectId) get().ensureAssets(target.projectId);
      const ids = fresh.map((i) => i.id);
      await lookupTeam(ids);
      await probeAll(ids);
      await checkDelivered(ids);
      // AI only for what the rules and the team's history couldn't settle.
      if (get().settings.aiMatching) await get().askAi(ids);
    },

    updateItem(id, patch) {
      set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
    },

    setOverrides(ids, overrides) {
      const idSet = new Set(ids);
      set((s) => ({
        items: s.items.map((i) => (idSet.has(i.id) ? { ...i, overrides: { ...i.overrides, ...overrides } } : i)),
      }));
    },

    setAsset(ids, projectId, assetId) {
      const idSet = new Set(ids);
      set((s) => ({
        items: s.items.map((i) => {
          if (!idSet.has(i.id)) return i;
          const projectChanged = i.project?.id !== projectId;
          return {
            ...i,
            project: projectId ? { id: projectId, source: "manual", score: 1 } : undefined,
            asset: assetId ? { id: assetId, source: "manual", score: 1 } : undefined,
            // Work requests belong to a project.
            overrides: projectChanged ? { ...i.overrides, workRequestId: null, workRequestTag: null } : i.overrides,
          };
        }),
      }));
      if (projectId) get().ensureAssets(projectId);
    },

    acceptSuggestion(id, from) {
      const item = get().items.find((i) => i.id === id);
      const hint = from === "ai" ? item?.ai : item?.team;
      if (!item || !hint?.projectId) return;
      const score = from === "ai" ? item.ai!.confidence : teamStrength(item.team!);
      const project: Match = { id: hint.projectId, source: from, score, accepted: true };
      const asset: Match | undefined = hint.assetId ? { id: hint.assetId, source: from, score, accepted: true } : undefined;
      const projectChanged = item.project?.id !== project.id;
      get().updateItem(id, {
        project,
        asset,
        guess: { project, asset },
        overrides: projectChanged ? { ...item.overrides, workRequestId: null, workRequestTag: null } : item.overrides,
      });
      get().ensureAssets(project.id);
    },

    toggleSelected(id, selected) {
      set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, selected: selected ?? !i.selected } : i)) }));
    },

    selectAll(selected, ids) {
      const idSet = ids ? new Set(ids) : null;
      set((s) => ({ items: s.items.map((i) => (!idSet || idSet.has(i.id) ? { ...i, selected } : i)) }));
    },

    removeItems(ids) {
      const idSet = new Set(ids);
      set((s) => ({ items: s.items.filter((i) => !idSet.has(i.id)) }));
    },

    async applyRenames(ops) {
      const results = await invoke<RenameResult[]>("rename_files", {
        ops: ops.map(({ from, to }) => ({ from, to })),
      });
      const byFrom = new Map(results.map((r) => [r.from, r]));
      const failedCount = results.filter((r) => !r.ok).length;
      log.info(`Renamed ${results.length - failedCount} of ${results.length} file(s)`);

      // A rename confirms the file's project: remember its vendor code for next time.
      const projectList = get().projects.status === "ready" ? (get().projects as { data: Project[] }).data : [];
      const aliases = { ...get().aliases };
      let learned = false;
      for (const item of get().items) {
        const code = vendorCode(item.file.name);
        const project = projectList.find((p) => p._id === item.project?.id);
        if (!code || /^\d+$/.test(code) || !project || !byFrom.get(item.file.path)?.ok) continue;
        if (code === project.filePrefix?.toUpperCase() || aliases[code] === project._id) continue;
        aliases[code] = project._id;
        learned = true;
      }
      if (learned) {
        set({ aliases });
        saveAliases(get().settings, aliases).catch(() => {});
      }
      reportRenames(
        get().items.filter((i) => byFrom.get(i.file.path)?.ok),
        new Map(results.filter((r) => r.ok).map((r) => [r.from, r.to.split(/[\\/]/).pop()!])),
      );

      set((s) => ({
        lastResults: results,
        canUndo: results.some((r) => r.ok) || s.canUndo,
        items: s.items.map((i) => {
          const r = byFrom.get(i.file.path);
          if (!r?.ok) return i;
          const name = r.to.split(/[\\/]/).pop()!;
          return { ...i, id: r.to, file: { ...i.file, path: r.to, name }, selected: false };
        }),
      }));
      return results;
    },

    async askAi(ids, manual = false) {
      if (!serviceReady() || (get().service as { health: Health }).health?.ai === false) return;
      const projects = get().projects;
      if (projects.status !== "ready") return;
      const items = ids
        .map((id) => get().items.find((i) => i.id === id))
        .filter((i): i is QueueItem => !!i && (manual ? !i.probing && !i.aiPending : needsAi(i)));
      if (!items.length) return;

      for (let start = 0; start < items.length; start += AI_BATCH) {
        const batch = items.slice(start, start + AI_BATCH);
        // The likeliest projects per file, so the AI sees their assets.
        const candidates = new Map<string, number>();
        for (const item of batch) {
          const ranked = [...nameScores(factsOf(item), projects.data, get().studios)].sort((a, b) => b[1] - a[1]).slice(0, 3);
          for (const [id, score] of ranked) candidates.set(id, (candidates.get(id) ?? 0) + score);
          for (const id of [item.project?.id, item.team?.projectId]) if (id) candidates.set(id, (candidates.get(id) ?? 0) + 1);
        }
        const candidateIds = [...candidates].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
        const files: AiFile[] = batch.map((i) => ({
          name: i.file.name,
          dirs: dirsOf(i.file),
          durationSec: durationOf(i.probe),
          aspect: aspectOf(i.probe),
          mediaType: i.mediaType === "video" || i.mediaType === "image" || i.mediaType === "audio" ? i.mediaType : undefined,
        }));

        batch.forEach((i) => get().updateItem(i.id, { aiPending: true }));
        log.info(`Asking AI about ${batch.length} file(s)`);
        try {
          const expectedAssets = candidateIds.flatMap((projectId) =>
            (get().expected[projectId] ?? []).map((a) => ({ id: a._id, name: a.name, type: a.type, project: projectId })),
          );
          const matches = await service.match(get().settings, files, candidateIds, expectedAssets);
          for (const m of matches) {
            const original = batch[m.file];
            const item = original && get().items.find((i) => i.id === original.id);
            if (!item) continue;
            const ai = { projectId: m.projectId, assetId: m.assetId, confidence: m.confidence, reason: m.reason };
            const chosen = item.project && CHOSEN.includes(item.project.source);
            const better = !item.project || m.confidence > item.project.score || (!item.asset && item.project.id === m.projectId);
            const apply = !!m.projectId && m.confidence >= AI_APPLY_AT && !chosen && better;
            log.info(
              `AI: "${item.file.name}" -> ${m.projectId ?? "no project"} / ${m.assetId ?? "no asset"} ` +
                `(${percent(m.confidence)}${apply ? "" : ", not applied"}): ${m.reason}`,
            );
            if (!apply) {
              get().updateItem(item.id, { ai, aiPending: false });
              continue;
            }
            const project: Match = { id: m.projectId!, source: "ai", score: m.confidence };
            const asset: Match | undefined = m.assetId
              ? { id: m.assetId, source: "ai", score: m.confidence }
              : item.project?.id === m.projectId ? item.asset : undefined;
            get().updateItem(item.id, { ai, aiPending: false, project, asset, guess: { project, asset } });
            get().ensureAssets(project.id);
          }
        } catch (e) {
          log.warn(`AI matching failed: ${errorText(e)}`);
        } finally {
          batch.forEach((i) => {
            if (get().items.find((x) => x.id === i.id)?.aiPending) get().updateItem(i.id, { aiPending: false });
          });
        }
      }
    },

    async addExpected(projectId, names, type) {
      const settings = get().settings;
      let added: number;
      if (serviceReady()) {
        added = await service.addExpected(settings, projectId, type, names);
        await loadExpectedLists();
      } else {
        const current = get().expected[projectId] ?? [];
        const slugs = new Set(current.map((a) => a.slug));
        const fresh = names.map((name) => expectedAsset(projectId, name, type)).filter((a) => !slugs.has(a.slug) && slugs.add(a.slug));
        added = fresh.length;
        const expected = { ...get().expected, [projectId]: [...current, ...fresh] };
        showExpected(expected);
        await saveExpected(settings, expected);
      }
      log.info(`Added ${added} expected asset(s) to ${projectId}${serviceReady() ? " for the team" : ""}`);
      // Files in this project still waiting for an asset may fit one of the new names.
      if (added) rematchProject(projectId);
      return added;
    },

    async removeExpected(projectId, assetId) {
      const settings = get().settings;
      const current = get().expected[projectId] ?? [];
      const gone = current.filter((a) => !assetId || a._id === assetId);
      if (serviceReady()) {
        await service.removeExpected(settings, projectId, assetId ? gone[0]?.slug : undefined);
        await loadExpectedLists();
      } else {
        const expected = { ...get().expected, [projectId]: current.filter((a) => !gone.includes(a)) };
        if (!expected[projectId].length) delete expected[projectId];
        showExpected(expected);
        await saveExpected(settings, expected);
      }
      rematchProject(projectId, new Set(gone.map((a) => a._id)));
    },

    async setConventions(scope, targetId, values) {
      const settings = get().settings;
      await service.setConventions(settings, { scope, targetId, values });
      set({ conventions: await service.conventions(settings) });
      log.info(`Conventions for ${scope} ${targetId}: ${JSON.stringify(values)}`);
    },

    async setAlias(code, projectId) {
      if (serviceReady()) {
        await service.editCode(get().settings, code, projectId);
        set({ sharedCodes: await service.codes(get().settings) });
        log.info(`Vendor code ${code} now points at ${projectId} for the team`);
      }
      const aliases = { ...get().aliases, [code]: projectId };
      set({ aliases });
      await saveAliases(get().settings, aliases);
    },

    async forgetAliases(code) {
      if (serviceReady() && code) {
        await service.forgetCode(get().settings, code);
        set({ sharedCodes: await service.codes(get().settings) });
        log.info(`Vendor code ${code} forgotten for the team`);
      }
      const aliases = code ? Object.fromEntries(Object.entries(get().aliases).filter(([c]) => c !== code)) : {};
      set({ aliases });
      await saveAliases(get().settings, aliases);
    },

    async undo() {
      const results = await invoke<RenameResult[]>("undo_last_rename");
      // Undone renames shouldn't count in stats, team memory or code votes. Undo results run
      // new name → old name, so `to` is the original name the rename was recorded under.
      const reversed = results
        .filter((r) => r.ok)
        .map((r) => ({ name: r.to.split(/[\\/]/).pop()!, newName: r.from.split(/[\\/]/).pop()! }));
      log.info(`Undid ${reversed.length} of ${results.length} rename(s)`);
      if (serviceReady() && reversed.length) {
        service
          .undo(get().settings, reversed)
          .then(() => get().reloadRules())
          .catch((e) => log.warn(`Telling the service about the undo failed: ${errorText(e)}`));
      }
      const byFrom = new Map(results.map((r) => [r.from, r]));
      set((s) => ({
        lastResults: results,
        canUndo: false,
        items: s.items.map((i) => {
          const r = byFrom.get(i.file.path);
          if (!r?.ok) return i;
          return { ...i, id: r.to, file: { ...i.file, path: r.to, name: r.to.split(/[\\/]/).pop()! } };
        }),
      }));
      return results;
    },
  };
});
