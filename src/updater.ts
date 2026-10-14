import { log } from "./log";
import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

export const CHECK_EVERY_MS = 15 * 60 * 1000;

interface UpdaterState {
  version?: string;
  update: Update | null;
  checking: boolean;
  /** Result of the last check the user asked for, shown in Settings. */
  message?: string;
  progress: number | null;
  error?: string;
  check(manual?: boolean): Promise<void>;
  install(): Promise<void>;
}

export const useUpdater = create<UpdaterState>((set, get) => ({
  update: null,
  checking: false,
  progress: null,

  async check(manual = false) {
    if (get().checking || get().progress !== null) return;
    if (import.meta.env.DEV) {
      if (manual) set({ message: "Updates are disabled in development builds." });
      return;
    }
    set({ checking: true, ...(manual ? { message: undefined } : {}) });
    try {
      const update = await check();
      if (update) {
        log.info(`Update ${update.version} available`);
        set({ update, message: `Pixname ${update.version} is available.` });
      }
      else if (manual) set({ message: `You're up to date (${get().version ?? "current version"}).` });
    } catch (e) {
      log.warn(`Update check failed: ${e}`);
      // Background checks fail quietly (offline, feed unavailable); manual ones say why.
      if (manual) set({ message: `Couldn't check for updates: ${e}` });
    } finally {
      set({ checking: false });
    }
  },

  async install() {
    const { update } = get();
    if (!update) return;
    set({ error: undefined, progress: 0 });
    let total = 0;
    let received = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          received += event.data.chunkLength;
          set({ progress: total ? Math.round((received / total) * 100) : 0 });
        }
      });
      await relaunch();
    } catch (e) {
      log.error(`Update install failed: ${e}`);
      set({ progress: null, error: String(e) });
    }
  },
}));

/** Check on launch and then on an interval. */
export function startUpdateChecks(): () => void {
  getVersion()
    .then((version) => useUpdater.setState({ version }))
    .catch(() => {});
  const run = () => useUpdater.getState().check();
  run();
  const timer = setInterval(run, CHECK_EVERY_MS);
  return () => clearInterval(timer);
}
