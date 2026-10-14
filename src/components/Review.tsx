import { useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { PickArt, PickButtons } from "./PickFiles";
import { useStore } from "../store";
import { useProposals, type Row, type RowStatus } from "../useProposals";
import { durationOf, formatDuration, tagsFromMediainfo } from "../lib/media";
import { ItemEditor } from "./ItemEditor";
import { countryOptions, languageOptions, parseExtra, tagOptions } from "./options";
import type { Match, QueueItem } from "../lib/types";

type Filter = "all" | "attention" | "ready";

const renameable = (r: Row) => (r.status === "ready" || r.status === "warning") && !!r.proposal.name;

/** How a project/asset was matched, when it's worth a look: the rules, a remembered code, the team, or AI. */
function Confidence({ match, item }: { match?: Match; item: QueueItem }) {
  if (!match) return null;
  const pct = `${Math.round(match.score * 100)}%`;
  switch (match.source) {
    case "fuzzy":
      return <span className="conf" title="Guessed from the file name and folders — check it">{pct}</span>;
    case "learned":
      return <span className="conf code" title="From a vendor code the team has confirmed before">Code {pct}</span>;
    case "team":
      return (
        <span className="conf team" title={item.team ? `Like "${item.team.example}", renamed by ${item.team.people} ${item.team.people === 1 ? "person" : "people"}` : "From the team's earlier renames"}>
          Team {pct}
        </span>
      );
    case "ai":
      return <span className="conf ai" title={item.ai?.reason ?? "Suggested by AI — check it"}>AI {pct}</span>;
    default:
      return null;
  }
}

function ItemRow({ row, open, onToggle }: { row: Row; open: boolean; onToggle(): void }) {
  const { item, proposal, status } = row;
  const toggleSelected = useStore((s) => s.toggleSelected);
  const project = useStore((s) => (s.projects.status === "ready" ? s.projects.data.find((p) => p._id === item.project?.id) : undefined));
  const asset = useStore((s) => {
    const list = item.project ? s.assets[item.project.id] : undefined;
    return list?.status === "ready" ? list.data.find((a) => a._id === item.asset?.id) : undefined;
  });
  const media = useMemo(() => tagsFromMediainfo(item.probe, item.mediaType), [item.probe, item.mediaType]);
  const duration = durationOf(item.probe);

  return (
    <>
      <div className={`row ${open ? "open" : ""}`} onClick={onToggle}>
        <input type="checkbox" checked={item.selected} onClick={(e) => e.stopPropagation()} onChange={() => toggleSelected(item.id)} />
        <span className={`dot ${status}`} title={status} />
        <div className="names">
          <div className="from mono" title={item.file.path}>{item.file.name}</div>
          {status === "probing" ? (
            <div className="to faint">Reading file…</div>
          ) : proposal.error ? (
            <div className="to err">{proposal.error}</div>
          ) : proposal.unchanged ? (
            <div className="to same mono">Already named correctly</div>
          ) : (
            <div className="to mono" title={proposal.name}>{proposal.name}</div>
          )}
        </div>
        <div className="ctx">
          <div>
            {project ? project.name : <span className="faint">No project</span>}
            <Confidence match={item.project} item={item} />
            {item.aiPending && <span className="conf ai pending" title="Asking AI">AI…</span>}
          </div>
          <div className="muted">
            {asset ? asset.name : <span className="faint">No asset</span>}
            <Confidence match={item.asset} item={item} />
          </div>
        </div>
        <div className="tech mono">
          <div>{[media.Codec?.toUpperCase(), media.Resolution].filter(Boolean).join(" · ") || item.mediaType || item.ext}</div>
          <div>{[media.Framerate && `${media.Framerate}${(media["Frame Mode"] ?? "p")[0]}`, formatDuration(duration)].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      {open && <ItemEditor row={row} />}
    </>
  );
}

function BulkBar({ rows }: { rows: Row[] }) {
  const catalog = useStore((s) => s.catalog);
  const askAi = useStore((s) => s.askAi);
  const aiReady = useStore((s) => s.service.status === "ready" && s.service.health.ai);
  const setOverrides = useStore((s) => s.setOverrides);
  const setAsset = useStore((s) => s.setAsset);
  const removeItems = useStore((s) => s.removeItems);
  const assetsByProject = useStore((s) => s.assets);
  const [extra, setExtra] = useState("");
  const ids = rows.map((r) => r.item.id);
  const projectIds = [...new Set(rows.map((r) => r.item.project?.id))];
  const sharedProject = projectIds.length === 1 ? projectIds[0] : undefined;
  const assetList = sharedProject ? assetsByProject[sharedProject] : undefined;

  const pick = (fn: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value !== "__") fn(e.target.value);
    e.target.value = "__";
  };

  return (
    <div className="bulk">
      <b>{rows.length} selected</b>
      {sharedProject && assetList?.status === "ready" && (
        <select className="field" defaultValue="__" onChange={pick((v) => setAsset(ids, sharedProject, v))}>
          <option value="__" disabled>Asset…</option>
          {assetList.data.map((a) => (
            <option key={a._id} value={a._id}>{a.name}</option>
          ))}
        </select>
      )}
      <select className="field" defaultValue="__" onChange={pick((v) => setOverrides(ids, { language: v }))}>
        <option value="__" disabled>Language…</option>
        {languageOptions(catalog).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <select className="field" defaultValue="__" onChange={pick((v) => setOverrides(ids, { country: v }))}>
        <option value="__" disabled>Country…</option>
        {countryOptions(catalog).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <select className="field" defaultValue="__" onChange={pick((v) => setOverrides(ids, { text: v }))}>
        <option value="__" disabled>Text…</option>
        <option value="">Default for type</option>
        {tagOptions(catalog, "Text").map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <select
        className="field"
        defaultValue="__"
        onChange={pick((v) => setOverrides(ids, { sub: v.includes("sub"), dub: v.includes("dub") }))}
      >
        <option value="__" disabled>Sub/Dub…</option>
        <option value="sub">SUB</option>
        <option value="dub">DUB</option>
        <option value="sub,dub">SUB + DUB</option>
        <option value="">Neither</option>
      </select>
      <input
        className="field mono"
        style={{ width: 150 }}
        placeholder="Extra tokens ↵"
        value={extra}
        onChange={(e) => setExtra(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setOverrides(ids, { extra: parseExtra(extra) });
            setExtra("");
          }
        }}
      />
      <span className="spacer" />
      {aiReady && (
        <button
          className="btn small"
          title="Ask AI to match these files, even ones the rules already placed"
          disabled={rows.every((r) => r.item.aiPending)}
          onClick={() => askAi(ids, true)}
        >
          {rows.some((r) => r.item.aiPending) ? "Asking AI…" : "Ask AI"}
        </button>
      )}
      <button className="btn small" onClick={() => removeItems(ids)}>Remove from list</button>
    </div>
  );
}

export function Review() {
  const rows = useProposals();
  const setView = useStore((s) => s.setView);
  const selectAll = useStore((s) => s.selectAll);
  const applyRenames = useStore((s) => s.applyRenames);
  const undo = useStore((s) => s.undo);
  const canUndo = useStore((s) => s.canUndo);
  const lastResults = useStore((s) => s.lastResults);
  const removeItems = useStore((s) => s.removeItems);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => {
    const c: Record<RowStatus, number> = { probing: 0, ready: 0, unchanged: 0, warning: 0, error: 0 };
    rows.forEach((r) => c[r.status]++);
    return c;
  }, [rows]);

  const visible = rows.filter((r) =>
    filter === "all" ? true : filter === "ready" ? r.status === "ready" : r.status === "warning" || r.status === "error",
  );
  const selected = rows.filter((r) => r.item.selected);
  const toRename = selected.filter(renameable);
  const allVisibleSelected = visible.length > 0 && visible.every((r) => r.item.selected);

  async function rename() {
    const warned = toRename.filter((r) => r.status === "warning").length;
    const ok = await ask(
      `Rename ${toRename.length} file${toRename.length === 1 ? "" : "s"} in place?` +
        (warned ? `\n\n${warned} of them have warnings or guessed matches.` : "") +
        "\n\nYou can undo the last batch afterwards.",
      { title: "Rename files", kind: "warning", okLabel: "Rename" },
    );
    if (!ok) return;
    setBusy(true);
    try {
      await applyRenames(toRename.map((r) => ({ id: r.item.id, from: r.item.file.path, to: r.proposal.name! })));
    } finally {
      setBusy(false);
    }
  }

  const failed = lastResults?.filter((r) => !r.ok) ?? [];
  const succeeded = (lastResults?.length ?? 0) - failed.length;

  return (
    <div className="review">
      <div className="review-bar">
        <button className="btn" onClick={() => setView("browse")}>← Projects</button>
        <div className="seg">
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All {rows.length}</button>
          <button className={filter === "attention" ? "on" : ""} onClick={() => setFilter("attention")}>
            Needs attention {counts.warning + counts.error}
          </button>
          <button className={filter === "ready" ? "on" : ""} onClick={() => setFilter("ready")}>Ready {counts.ready}</button>
        </div>
        <span className="muted">
          {counts.probing ? `Reading ${counts.probing} file(s)… ` : ""}
          {counts.unchanged ? `${counts.unchanged} already correct` : ""}
        </span>
        <span className="spacer" />
        {rows.length > 0 && (
          <button className="btn ghost small" onClick={() => removeItems(rows.map((r) => r.item.id))}>Clear list</button>
        )}
        <button className="btn" disabled={!canUndo || busy} onClick={() => undo()}>Undo last rename</button>
        <button className="btn primary" disabled={!toRename.length || busy || counts.probing > 0} onClick={rename}>
          {busy ? "Renaming…" : `Rename ${toRename.length} file${toRename.length === 1 ? "" : "s"}`}
        </button>
      </div>
      {selected.length > 0 && <BulkBar rows={selected} />}
      {lastResults && (
        <div className={`results ${failed.length ? "bad" : ""}`}>
          <span>
            {succeeded > 0 && `${succeeded} file${succeeded === 1 ? "" : "s"} renamed. `}
            {failed.length > 0 && `${failed.length} failed: ${failed.slice(0, 3).map((f) => `${f.from.split(/[\\/]/).pop()} (${f.error})`).join("; ")}`}
          </span>
        </div>
      )}
      <div className="rows">
        {rows.length === 0 ? (
          <div className="empty">
            <div>
              <PickArt />
              <h2>No files yet</h2>
              <p>Drop files or folders here, or go back to Projects and drop them onto an asset.</p>
              <PickButtons />
            </div>
          </div>
        ) : (
          <>
            <div className="row" style={{ cursor: "default", background: "transparent" }}>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={() => selectAll(!allVisibleSelected, visible.map((r) => r.item.id))}
              />
              <span />
              <span className="faint">Current name → proposed name</span>
              <span className="faint">Project / asset</span>
              <span className="faint" style={{ textAlign: "right" }}>Media</span>
            </div>
            {visible.map((row) => (
              <ItemRow
                key={row.item.id}
                row={row}
                open={openId === row.item.id}
                onToggle={() => setOpenId(openId === row.item.id ? null : row.item.id)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
