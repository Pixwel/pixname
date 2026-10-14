import { useEffect } from "react";
import { useStore } from "./store";
import { useDrag, useFileDrop } from "./useFileDrop";
import { Browse } from "./components/Browse";
import { Review } from "./components/Review";
import { SettingsDialog } from "./components/SettingsDialog";
import { UpdateBanner } from "./components/UpdateBanner";
import { PixwelLogo } from "./components/PixwelLogo";
import { Splash } from "./components/Splash";
import { ThemePicker } from "./components/ThemePicker";
import { LogViewer } from "./components/LogViewer";
import { listen } from "@tauri-apps/api/event";
import "./styles.css";

function DragBanner() {
  const { dragging, count, label } = useDrag();
  if (!dragging) return null;
  const what = count === 1 ? "1 item" : `${count} items`;
  return <div className="drag-banner">{label ? `Drop ${what} on ${label}` : `Drop ${what} — Pixname will match them`}</div>;
}

export default function App() {
  return (
    <>
      <Main />
      <Splash />
    </>
  );
}

function Main() {
  const init = useStore((s) => s.init);
  const loaded = useStore((s) => s.settingsLoaded);
  const settings = useStore((s) => s.settings);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const logOpen = useStore((s) => s.logOpen);
  const openSettings = useStore((s) => s.openSettings);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const itemCount = useStore((s) => s.items.length);
  const tools = useStore((s) => s.tools);
  const catalogWarnings = useStore((s) => s.catalogWarnings);
  useFileDrop();

  useEffect(() => {
    init();
  }, []);

  // Help → Show Log (macOS menu).
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const stop = listen("show-log", () => useStore.getState().openLog(true));
    return () => {
      stop.then((unlisten) => unlisten());
    };
  }, []);

  // Esc backs out one level: review -> projects -> start screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const s = useStore.getState();
      if (s.settingsOpen) return s.settings.token ? s.openSettings(false) : undefined;
      if (document.activeElement instanceof HTMLInputElement && document.activeElement.value) return;
      if (s.view === "review") s.setView("browse");
      else if (s.selectedProjectId) s.selectProject(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!loaded) return null;

  const probeTool = tools.mediainfo ? "mediainfo" : tools.ffprobe ? "ffprobe" : null;

  return (
    <div className="app">
      <header className="topbar">
        <div
          className="brand"
          role="button"
          title="Back to start"
          style={{ cursor: "pointer" }}
          onClick={() => {
            setView("browse");
            useStore.getState().selectProject(undefined);
          }}
        >
          <PixwelLogo className="brand-mark" />
          Pixname
        </div>
        <span className={`env ${settings.environment}`}>{settings.environment}</span>
        <span className="spacer" />
        {catalogWarnings.length > 0 && (
          <span className="tool-pill missing" title={catalogWarnings.join("\n")}>Using bundled reference data</span>
        )}
        {/* Which tool reads media is in Settings → Advanced; only its absence is worth showing here. */}
        {!probeTool && (
          <span className="tool-pill missing" title="Install mediainfo or ffprobe, or set a path in Settings → Advanced">
            No media reader — names only
          </span>
        )}
        {view === "browse" ? (
          <button className="btn" onClick={() => setView("review")}>Review{itemCount ? ` (${itemCount})` : ""}</button>
        ) : null}
        <ThemePicker />
        <button className="btn" onClick={() => openSettings(true)}>Settings</button>
      </header>
      {view === "browse" ? <Browse /> : <Review />}
      <DragBanner />
      <UpdateBanner />
      {settingsOpen && <SettingsDialog />}
      {logOpen && <LogViewer />}
    </div>
  );
}
