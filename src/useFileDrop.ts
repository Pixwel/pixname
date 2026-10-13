import { useEffect } from "react";
import { create } from "zustand";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useStore, type DropTarget } from "./store";

interface DragState {
  dragging: boolean;
  count: number;
  hoverKey?: string;
  label?: string;
}

export const useDrag = create<DragState>(() => ({ dragging: false, count: 0 }));

/** Elements opt in with data-drop-project / data-drop-asset / data-drop-label. */
function targetAt(x: number, y: number): DropTarget & { key?: string; label?: string } {
  const el = document.elementFromPoint(x / window.devicePixelRatio, y / window.devicePixelRatio);
  const hit = el?.closest<HTMLElement>("[data-drop-project]");
  if (!hit) return {};
  const { dropProject, dropAsset, dropLabel } = hit.dataset;
  return {
    projectId: dropProject || undefined,
    assetId: dropAsset || undefined,
    key: dropAsset ? `asset:${dropAsset}` : `project:${dropProject}`,
    label: dropLabel,
  };
}

/** True while files are dragged over the element registered with this key. */
export const useDropHot = (key: string) => useDrag((s) => s.dragging && s.hoverKey === key);

export function useFileDrop() {
  useEffect(() => {
    let paths: string[] = [];
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "leave") {
        useDrag.setState({ dragging: false, hoverKey: undefined, label: undefined });
        return;
      }
      if (payload.type === "enter") paths = payload.paths;
      const target = targetAt(payload.position.x, payload.position.y);
      if (payload.type === "drop") {
        useDrag.setState({ dragging: false, hoverKey: undefined, label: undefined });
        const dropped = payload.paths.length ? payload.paths : paths;
        if (dropped.length) useStore.getState().addPaths(dropped, target);
        return;
      }
      const prev = useDrag.getState();
      if (!prev.dragging || prev.hoverKey !== target.key) {
        useDrag.setState({ dragging: true, count: paths.length, hoverKey: target.key, label: target.label });
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
