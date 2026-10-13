import { useEffect } from "react";
import { useStore } from "./store";
import { useDrag, useFileDrop } from "./useFileDrop";
import { Browse } from "./components/Browse";
import { Review } from "./components/Review";
import { SettingsDialog } from "./components/SettingsDialog";
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

  if (!loaded) return null;

  const probeTool = tools.mediainfo ? "mediainfo" : tools.ffprobe ? "ffprobe" : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">px</span>Pixname
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
      {settingsOpen && <SettingsDialog />}
    </div>
  );
}
