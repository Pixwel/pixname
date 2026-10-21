import { useMemo, useState } from "react";
import { useStore } from "../store";
import { parseExpectedNames, slugOf } from "../lib/expected";
import { typeToken } from "../lib/parse";
import type { Project } from "../lib/types";
import { TypePicker } from "./TypePicker";

const TYPE_KEY = "px-expected-type";
const USES_KEY = "px-type-uses";

function rememberedType(): string | null {
  try {
    return localStorage.getItem(TYPE_KEY);
  } catch {
    return null;
  }
}

/** How often you've picked each type here. */
function pickedUses(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(USES_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

/** Paste the asset names a delivery doc lists; files then match and get named as if Pixwel had them. */
export function ExpectedDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const types = useStore((s) => s.catalog.types);
  const assets = useStore((s) => s.assets[project._id]);
  const addExpected = useStore((s) => s.addExpected);
  const removeExpected = useStore((s) => s.removeExpected);
  const existing = useStore((s) => s.expected[project._id]?.length ?? 0);
  const shared = useStore((s) => s.service.status === "ready");
  const [text, setText] = useState("");
  const [type, setType] = useState(() => {
    const saved = rememberedType();
    return types.find((t) => t.name === saved)?.name ?? types.find((t) => t.name === "special-events")?.name ?? types[0]?.name ?? "";
  });
  const [busy, setBusy] = useState(false);

  // Your picks plus the types this project already has.
  const uses = useMemo(() => {
    const out = pickedUses();
    for (const a of assets?.status === "ready" ? assets.data : []) out[a.type] = (out[a.type] ?? 0) + 1;
    return out;
  }, [assets]);
  const names = useMemo(() => parseExpectedNames(text), [text]);
  const known = useMemo(() => new Set(assets?.status === "ready" ? assets.data.map((a) => a.slug) : []), [assets]);
  const fresh = names.filter((n) => !known.has(slugOf(n)));
  const chosen = types.find((t) => t.name === type);

  async function add() {
    setBusy(true);
    try {
      localStorage.setItem(TYPE_KEY, type);
      const picked = pickedUses();
      localStorage.setItem(USES_KEY, JSON.stringify({ ...picked, [type]: (picked[type] ?? 0) + 1 }));
    } catch {
      // Only a convenience.
    }
    await addExpected(project._id, fresh, type);
    setBusy(false);
    onClose();
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (fresh.length) add();
        }}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <h2>Expected assets</h2>
        <div className="muted">
          Paste the asset names you're expecting for {project.name}, one per line (straight from the doc or spreadsheet).
          Files are matched to them and named as if Pixwel already had them.
          {shared ? " The list is shared with everyone who can see this project." : " Connect the Pixname service to share it with the team."}
        </div>
        <div className="form">
          <label>
            <span>Asset names</span>
            <textarea
              className="field paste"
              rows={10}
              autoFocus
              spellCheck={false}
              placeholder={"World Premiere - Callina Liang\nWorld Premiere - Cody Rhodes\nCapcom Nakayama Reel Vertical"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {names.length > 0 && (
              <span className="hint">
                {fresh.length} new{names.length > fresh.length ? ` · ${names.length - fresh.length} already in this project` : ""}
              </span>
            )}
          </label>
          <div className="field-group">
            <span>Asset type</span>
            <TypePicker types={types} value={type} onChange={setType} uses={uses} />
            <span className="hint">
              {chosen && !/trailer/.test(chosen.name) ? `Goes into the new names (…_${typeToken(chosen)}_…). ` : ""}Paste lists of other
              types separately.
            </span>
          </div>
        </div>
        <div className="actions">
          {existing > 0 && (
            <button
              type="button"
              className="btn ghost"
              title={`Forget every expected asset of this project${shared ? ", for everyone" : ""}`}
              onClick={() => removeExpected(project._id).then(onClose)}
            >
              Forget all {existing}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!fresh.length || !type || busy}>
            Add {fresh.length || ""} {fresh.length === 1 ? "asset" : "assets"}
          </button>
        </div>
      </form>
    </div>
  );
}
