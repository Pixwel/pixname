import { open } from "@tauri-apps/plugin-dialog";
import { useStore, type DropTarget } from "../store";

/** Open the system picker and queue what was chosen, as if it had been dropped on `target`. */
export async function pickPaths(kind: "folder" | "files", target: DropTarget = {}) {
  const picked = await open({
    multiple: true,
    directory: kind === "folder",
    title: kind === "folder" ? "Choose folders to rename" : "Choose files to rename",
  });
  const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
  if (paths.length) await useStore.getState().addPaths(paths, target);
}

/** The drop icon doubles as a button, with explicit folder/file choices beneath it. */
export function PickArt({ target }: { target?: DropTarget }) {
  return (
    <button className="drop-art" title="Choose a folder" onClick={() => pickPaths("folder", target)}>
      ⤓
    </button>
  );
}

export function PickButtons({ target }: { target?: DropTarget }) {
  return (
    <div className="pick-buttons">
      <button className="btn primary" onClick={() => pickPaths("folder", target)}>Choose folder…</button>
      <button className="btn" onClick={() => pickPaths("files", target)}>Choose files…</button>
    </div>
  );
}
