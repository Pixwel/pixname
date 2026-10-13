import { useEffect } from "react";
import { useStore } from "./store";
import { useDrag, useFileDrop } from "./useFileDrop";
import { Browse } from "./components/Browse";
import { Review } from "./components/Review";
import { SettingsDialog } from "./components/SettingsDialog";
import { UpdateBanner } from "./components/UpdateBanner";
import { PixwelLogo } from "./components/PixwelLogo";
import "./styles.css";

function DragBanner() {
  const { dragging, count, label } = useDrag();
  if (!dragging) return null;
  const what = count === 1 ? "1 item" : `${count} items`;
  return <div className="drag-banner">{label ? `Drop ${what} on ${label}` : `Drop ${what} — Pixname will match them`}</div>;
}

export default function App() {
  const init = useStore((s) => s.init);
  const loaded = useStore((s) => s.settingsLoaded);
  const settings = useStore((s) => s.settings);
  const settingsOpen = useStore((s) => s.settingsOpen);
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
        <span className={`tool-pill ${probeTool ? "" : "missing"}`} title={[tools.mediainfo, tools.ffprobe].filter(Boolean).join("\n")}>
          {probeTool ? `Reading media with ${probeTool}` : "ffprobe not found — names only"}
        </span>
        {view === "browse" ? (
          <button className="btn" onClick={() => setView("review")}>Review{itemCount ? ` (${itemCount})` : ""}</button>
        ) : null}
        <button className="btn" onClick={() => openSettings(true)}>Settings</button>
      </header>
      {view === "browse" ? <Browse /> : <Review />}
      <DragBanner />
      <UpdateBanner />
      {settingsOpen && <SettingsDialog />}
    </div>
  );
}
