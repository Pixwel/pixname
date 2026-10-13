import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

/** Checks the GitHub release feed on launch and every few hours; installs on request. */
export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const run = () =>
      check()
        .then((u) => u && setUpdate(u))
        .catch(() => {}); // offline or feed unavailable; try again later
    run();
    const timer = setInterval(run, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  if (!update) return null;

  async function install() {
    if (!update) return;
    setError(null);
    setProgress(0);
    let total = 0;
    let received = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          received += event.data.chunkLength;
          setProgress(total ? Math.round((received / total) * 100) : 0);
        }
      });
      await relaunch();
    } catch (e) {
      setProgress(null);
      setError(String(e));
    }
  }

  return (
    <div className="update-banner">
      <span>
        Pixname {update.version} is available{error ? ` — update failed: ${error}` : "."}
      </span>
      <button className="btn small primary" disabled={progress !== null} onClick={install}>
        {progress === null ? "Update and restart" : `Updating… ${progress}%`}
      </button>
    </div>
  );
}
