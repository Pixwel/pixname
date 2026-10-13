import { useEffect } from "react";
import { startUpdateChecks, useUpdater } from "../updater";

export function UpdateBanner() {
  const { update, progress, error, install } = useUpdater();

  useEffect(() => startUpdateChecks(), []);

  if (!update) return null;

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
