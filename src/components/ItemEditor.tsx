import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { idOf } from "../lib/api";
import { dirsOf, rankAssets } from "../lib/fuzzy";
import { durationOf, formatBytes, formatDuration, tagsFromMediainfo } from "../lib/media";
import type { Row } from "../useProposals";
import { countryOptions, languageOptions, parseExtra, tagOptions } from "./options";

export function ItemEditor({ row }: { row: Row }) {
  const { item, proposal } = row;
  const catalog = useStore((s) => s.catalog);
  const projects = useStore((s) => s.projects);
  const assets = useStore((s) => (item.project ? s.assets[item.project.id] : undefined));
  const workRequests = useStore((s) => (item.project ? s.workRequests[item.project.id] : undefined));
  const setAsset = useStore((s) => s.setAsset);
  const setOverrides = useStore((s) => s.setOverrides);
  const ensureWorkRequests = useStore((s) => s.ensureWorkRequests);
  const ids = [item.id];
  const [extraText, setExtraText] = useState(proposal.tags.Extra.join(", "));

  useEffect(() => setExtraText(proposal.tags.Extra.join(", ")), [proposal.tags.Extra.join("_")]);
  useEffect(() => {
    if (item.project) ensureWorkRequests(item.project.id);
  }, [item.project?.id]);

  const projectList = projects.status === "ready" ? projects.data : [];
  const project = projectList.find((p) => p._id === item.project?.id);

  const rankedAssets = useMemo(() => {
    if (assets?.status !== "ready") return [];
    const ranked = rankAssets(
      { name: item.file.name, dirs: dirsOf(item.file), duration: durationOf(item.probe), mediaType: item.mediaType },
      assets.data, catalog.types, catalog, project,
    ).slice(0, 5);
    const top = new Set(ranked.map((r) => r.item._id));
    return [
      ...ranked.map((r) => ({ asset: r.item, label: `${Math.round(r.score * 100)}% · ${r.item.name}` })),
      ...assets.data.filter((a) => !top.has(a._id)).map((a) => ({ asset: a, label: `${a.name} · ${a.type}` })),
    ];
  }, [assets, item.file.name, item.probe, project]);

  const wrList = workRequests?.status === "ready" ? workRequests.data : [];
  const relevantWrs = wrList.filter((w) => !item.asset || !w.asset || idOf(w.asset) === item.asset.id);
  const wr = wrList.find((w) => w._id === item.overrides.workRequestId);
  const media = tagsFromMediainfo(item.probe, item.mediaType);
  const duration = durationOf(item.probe);
  const languages = useMemo(() => languageOptions(catalog), [catalog]);
  const countries = useMemo(() => countryOptions(catalog), [catalog]);

  const wrLabel = (w: (typeof wrList)[number]) =>
    [w.name, typeof w.language === "string" ? w.language : w.language?.code, typeof w.territory === "string" ? w.territory : w.territory?.code, w.status]
      .filter(Boolean)
      .join(" · ") || w._id;

  return (
    <div className="editor" onClick={(e) => e.stopPropagation()}>
      <label className="f wide">
        <span>Project</span>
        <select className="field" value={item.project?.id ?? ""} onChange={(e) => setAsset(ids, e.target.value || undefined, undefined)}>
          <option value="">— choose —</option>
          {projectList.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name} ({p.filePrefix ?? "no prefix"})
            </option>
          ))}
        </select>
      </label>
      <label className="f wide">
        <span>Asset {assets?.status === "loading" ? "(loading…)" : ""}</span>
        <select
          className="field"
          value={item.asset?.id ?? ""}
          disabled={!item.project}
          onChange={(e) => setAsset(ids, item.project?.id, e.target.value || undefined)}
        >
          <option value="">— choose —</option>
          {rankedAssets.map(({ asset, label }) => (
            <option key={asset._id} value={asset._id}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="f wide">
        <span>Work request {workRequests?.status === "loading" ? "(loading…)" : workRequests?.status === "error" ? "(unavailable)" : ""}</span>
        <select
          className="field"
          value={item.overrides.workRequestId ?? ""}
          disabled={!item.project}
          onChange={(e) => setOverrides(ids, { workRequestId: e.target.value || null, workRequestTag: null })}
        >
          <option value="">None</option>
          {relevantWrs.map((w) => (
            <option key={w._id} value={w._id}>
              {wrLabel(w)}
            </option>
          ))}
        </select>
      </label>
      <label className="f wide">
        <span>Work request tag</span>
        <select
          className="field"
          value={item.overrides.workRequestTag ?? ""}
          disabled={!wr}
          onChange={(e) => setOverrides(ids, { workRequestTag: e.target.value || null })}
        >
          <option value="">None</option>
          {(wr?.tags ?? []).map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <label className="f">
        <span>Language</span>
        <select className="field" value={proposal.language ?? ""} onChange={(e) => setOverrides(ids, { language: e.target.value })}>
          <option value="">— choose —</option>
          {languages.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="f">
        <span>Country</span>
        <select className="field" value={proposal.country ?? "WW"} onChange={(e) => setOverrides(ids, { country: e.target.value })}>
          {countries.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="f">
        <span>Text</span>
        <select className="field" value={proposal.tags.Text ?? ""} onChange={(e) => setOverrides(ids, { text: e.target.value })}>
          <option value="">Default for type</option>
          {tagOptions(catalog, "Text").map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="f">
        <span>Subtitled / dubbed (replaces text)</span>
        <div style={{ display: "flex", gap: 14, height: 30, alignItems: "center" }}>
          <label className="check">
            <input type="checkbox" checked={!!proposal.tags.SubDub.sub} onChange={(e) => setOverrides(ids, { sub: e.target.checked })} /> SUB
          </label>
          <label className="check">
            <input type="checkbox" checked={!!proposal.tags.SubDub.dub} onChange={(e) => setOverrides(ids, { dub: e.target.checked })} /> DUB
          </label>
        </div>
      </div>

      <label className="f wide">
        <span>Extra tokens (comma separated)</span>
        <input
          className="field mono"
          value={extraText}
          placeholder="e.g. DATE, COMING-SOON"
          onChange={(e) => setExtraText(e.target.value)}
          onBlur={() => setOverrides(ids, { extra: parseExtra(extraText) })}
          onKeyDown={(e) => e.key === "Enter" && setOverrides(ids, { extra: parseExtra(extraText) })}
        />
      </label>
      <label className="f">
        <span>Version</span>
        <input
          className="field mono"
          value={proposal.version ?? ""}
          placeholder="REV, REV2…"
          onChange={(e) => setOverrides(ids, { version: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") })}
        />
      </label>
      {item.mediaType === "video" && (
        <label className="f">
          <span>Codec</span>
          <select className="field" value={(proposal.tags.Codec as string) ?? ""} onChange={(e) => setOverrides(ids, { codec: e.target.value })}>
            <option value="">— none —</option>
            {tagOptions(catalog, "Codec").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="f full">
        <div className="facts">
          <span>Size <b>{formatBytes(item.file.size)}</b></span>
          {duration !== undefined && <span>Duration <b>{formatDuration(duration)}</b></span>}
          {media.Resolution && <span>Resolution <b>{media.Resolution}</b></span>}
          {media.Framerate && <span>Frame rate <b>{media.Framerate}</b></span>}
          {media["Frame Mode"] && <span>Scan <b>{media["Frame Mode"]}</b></span>}
          {media.Aspect && <span>Aspect <b>{media.Aspect}</b></span>}
          {media.Codec && <span>Codec <b>{media.Codec}</b></span>}
          <span>Metadata from <b>{item.probe?.mediainfo ? "mediainfo" : item.probe?.ffprobe ? "ffprobe" : "file name only"}</b></span>
          <span className="faint">{item.file.dir}</span>
        </div>
      </div>
      <Hints row={row} />
      {(proposal.warnings.length || proposal.notes.length || item.probe?.errors.length || proposal.error) && (
        <div className="f full msgs">
          {proposal.error && <div className="msg err">{proposal.error}</div>}
          {proposal.warnings.map((w) => (
            <div key={w} className="msg warn">⚠ {w}</div>
          ))}
          {proposal.notes.map((n) => (
            <div key={n} className="msg note">{n}</div>
          ))}
          {item.probe?.errors.map((e) => (
            <div key={e} className="msg note">{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** What the team's earlier renames and the AI suggest for this file, with a way to use it. */
function Hints({ row }: { row: Row }) {
  const { item } = row;
  const acceptSuggestion = useStore((s) => s.acceptSuggestion);
  const projects = useStore((s) => s.projects);
  const assetsByProject = useStore((s) => s.assets);
  const ensureAssets = useStore((s) => s.ensureAssets);
  const projectName = (id: string | null) =>
    (id && projects.status === "ready" && projects.data.find((p) => p._id === id)?.name) || "no project";
  const assetName = (projectId: string | null, assetId: string | null) => {
    const list = projectId ? assetsByProject[projectId] : undefined;
    return (assetId && list?.status === "ready" && list.data.find((a) => a._id === assetId)?.name) || (assetId ? "an asset" : "no asset");
  };
  useEffect(() => {
    for (const id of [item.ai?.projectId, item.team?.projectId]) if (id) ensureAssets(id);
  }, [item.ai?.projectId, item.team?.projectId]);

  const current = (projectId: string | null, assetId: string | null) =>
    item.project?.id === projectId && (item.asset?.id ?? null) === assetId;
  const { team, ai } = item;
  if (!team && !ai) return null;

  return (
    <div className="f full hints">
      {team && (
        <div className="hint-row">
          <span className="conf team">Team</span>
          <span>
            {projectName(team.projectId)} / {assetName(team.projectId, team.assetId)}
            <span className="muted">
              {" "}
              — like <span className="mono">{team.example}</span> ({Math.round(team.similarity * 100)}% alike, {team.people}{" "}
              {team.people === 1 ? "person" : "people"})
            </span>
          </span>
          {!current(team.projectId, team.assetId) && (
            <button className="btn small" onClick={() => acceptSuggestion(item.id, "team")}>Use this</button>
          )}
        </div>
      )}
      {ai && (
        <div className="hint-row">
          <span className="conf ai">AI {Math.round(ai.confidence * 100)}%</span>
          <span>
            {ai.projectId ? `${projectName(ai.projectId)} / ${assetName(ai.projectId, ai.assetId)}` : "No suggestion"}
            <span className="muted"> — {ai.reason}</span>
          </span>
          {ai.projectId && !current(ai.projectId, ai.assetId) && (
            <button className="btn small" onClick={() => acceptSuggestion(item.id, "ai")}>Use this</button>
          )}
        </div>
      )}
    </div>
  );
}
