import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { FALLBACK_CATALOG, fetchAssets, fetchProjects, fetchWorkRequests, loadCatalog } from "./lib/api";
import { loadSettings, saveSettings, type Settings, DEFAULT_SETTINGS } from "./lib/settings";
import { mediaTypeOf, durationOf } from "./lib/media";
import { parseFilename } from "./lib/parse";
import { dirsOf, rankAssets, rankProjects } from "./lib/fuzzy";
import type { Asset, Catalog, FileEntry, Overrides, Probe, Project, QueueItem, WorkRequest } from "./lib/types";

/** Below these scores a fuzzy guess is left for the user to make. */
const PROJECT_THRESHOLD = 0.6;
const ASSET_THRESHOLD = 0.45;
const PROBE_CONCURRENCY = 4;

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
  tools: { ffprobe?: string | null; mediainfo?: string | null };
  catalog: Catalog;
  catalogWarnings: string[];
  projects: Loadable<Project[]>;
  assets: Record<string, Loadable<Asset[]>>;
  workRequests: Record<string, Loadable<WorkRequest[]>>;
  selectedProjectId?: string;
  view: "browse" | "review";
  items: QueueItem[];
  lastResults?: RenameResult[];
  canUndo: boolean;

  init(): Promise<void>;
  openSettings(open: boolean): void;
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
  toggleSelected(id: string, selected?: boolean): void;
  selectAll(selected: boolean, ids?: string[]): void;
  removeItems(ids: string[]): void;
  applyRenames(ops: { id: string; from: string; to: string }[]): Promise<RenameResult[]>;
  undo(): Promise<RenameResult[]>;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useStore = create<State>((set, get) => {
  const pending = new Map<string, Promise<any>>();

  /** Fill in project/asset guesses for one item from its name, folders and probe. */
  async function match(id: string) {
    const item = get().items.find((i) => i.id === id);
    const projects = get().projects;
    if (!item || projects.status !== "ready") return;
    const facts = { name: item.file.name, dirs: dirsOf(item.file), duration: durationOf(item.probe), mediaType: item.mediaType };

    let project = item.project;
    if (!project) {
      const parsed = parseFilename(item.file.name, get().catalog, projects.data);
      if (parsed.projectId) project = { id: parsed.projectId, source: "prefix", score: 1 };
      else {
        const best = rankProjects(facts, projects.data)[0];
        if (best && best.score >= PROJECT_THRESHOLD) project = { id: best.item._id, source: "fuzzy", score: best.score };
      }
    }
    if (!project) return;

    let asset = item.asset;
    if (!asset || asset.source === "fuzzy") {
      const assets = await get().ensureAssets(project.id);
      const projectRecord = projects.data.find((p) => p._id === project!.id);
      const best = rankAssets(facts, assets, get().catalog.types, get().catalog, projectRecord)[0];
      if (best && best.score >= ASSET_THRESHOLD) {
        asset = { id: best.item._id, source: best.score === 1 ? "prefix" : "fuzzy", score: best.score };
      }
    }
    get().updateItem(id, { project, asset });
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
      get().updateItem(id, { probe: { errors: [errorText(e)] }, probing: false });
    }
    await match(id);
  }

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
    tools: {},
    catalog: FALLBACK_CATALOG,
    catalogWarnings: [],
    projects: { status: "loading" },
    assets: {},
    workRequests: {},
    view: "browse",
    items: [],
    canUndo: false,

    async init() {
      const settings = await loadSettings();
      set({ settings, settingsLoaded: true, settingsOpen: !settings.token });
      invoke<boolean>("has_undo").then((canUndo) => set({ canUndo }));
      await get().refresh();
    },

    openSettings(open) {
      set({ settingsOpen: open });
    },

    async updateSettings(settings) {
      await saveSettings(settings);
      set({ settings, settingsOpen: false, assets: {}, workRequests: {} });
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
      set({ projects: { status: "loading" } });
      const [catalogResult, projectsResult] = await Promise.allSettled([loadCatalog(settings), fetchProjects(settings)]);
      if (catalogResult.status === "fulfilled") {
        set({ catalog: catalogResult.value.catalog, catalogWarnings: catalogResult.value.warnings });
      }
      if (projectsResult.status === "fulfilled") {
        const data = [...projectsResult.value].sort((a, b) => a.name.localeCompare(b.name));
        set({ projects: { status: "ready", data } });
        // Items dropped before projects loaded can be matched now.
        get().items.filter((i) => !i.probing).forEach((i) => match(i.id));
      } else {
        set({ projects: { status: "error", error: errorText(projectsResult.reason) } });
      }
    },

    selectProject(id) {
      set({ selectedProjectId: id });
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
            const sorted = [...data].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
            set((s) => ({ assets: { ...s.assets, [projectId]: { status: "ready", data: sorted } } }));
            return sorted;
          })
          .catch((e) => {
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
      const entries = await invoke<FileEntry[]>("expand_paths", { paths });
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
      await probeAll(fresh.map((i) => i.id));
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

    async undo() {
      const results = await invoke<RenameResult[]>("undo_last_rename");
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
