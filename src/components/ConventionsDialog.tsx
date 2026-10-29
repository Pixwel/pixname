import { useState } from "react";
import { useStore } from "../store";
import { CONVENTIONS, type ConventionKey, type Conventions } from "../lib/conventions";
import { studioIdOf, type Project } from "../lib/types";

/** Admins: a project's house style, for its whole studio or just this project. */
export function ConventionsDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const rows = useStore((s) => s.conventions);
  const studios = useStore((s) => s.studios);
  const save = useStore((s) => s.setConventions);
  const studioId = studioIdOf(project);
  const studioName = studioId ? studios[studioId] : undefined;
  const [studio, setStudio] = useState<Conventions>(
    () => rows.find((r) => r.scope === "studio" && r.targetId === studioId)?.values ?? {},
  );
  const [own, setOwn] = useState<Conventions>(
    () => rows.find((r) => r.scope === "project" && r.targetId === project._id)?.values ?? {},
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onOff = (v?: boolean) => (v ? "on" : "off");

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (studioId) await save("studio", studioId, studio);
      await save("project", project._id, own);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <h2>Naming conventions</h2>
        <div className="muted">
          House style beyond the Pixwel standard. Set it for {studioName ? `every ${studioName} project` : "the studio"}, or override it
          for {project.name} alone. It applies to everyone's renames.
        </div>
        <div className="form">
          {CONVENTIONS.map(({ key, label, hint }) => (
            <div className="convention" key={key}>
              <div>
                <b>{label}</b>
                <div className="hint">{hint}</div>
              </div>
              <label className={`check ${studioId ? "" : "disabled"}`}>
                <input
                  type="checkbox"
                  disabled={!studioId}
                  checked={!!studio[key]}
                  onChange={(e) => setStudio((s) => ({ ...s, [key]: e.target.checked || undefined }))}
                />
                <span>{studioName ? `All ${studioName} projects` : "This project has no studio"}</span>
              </label>
              <label>
                <span>{project.name}</span>
                <select
                  className="field"
                  value={own[key] === undefined ? "" : onOff(own[key])}
                  onChange={(e) =>
                    setOwn((o) => ({ ...o, [key as ConventionKey]: e.target.value === "" ? undefined : e.target.value === "on" }))
                  }
                >
                  <option value="">Same as the studio ({onOff(studio[key])})</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </label>
            </div>
          ))}
          {error && <div className="bad">{error}</div>}
        </div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
