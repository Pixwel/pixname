import { useMemo, useState } from "react";
import { useStore } from "../store";
import { useDropHot } from "../useFileDrop";
import { PickArt, PickButtons, pickPaths } from "./PickFiles";
import { ExpectedDialog } from "./ExpectedDialog";
import { assetTitleToken } from "../lib/fuzzy";
import { formatDuration } from "../lib/media";
import { typeToken } from "../lib/parse";
import type { Asset, Project } from "../lib/types";

function useQueuedCounts() {
  const items = useStore((s) => s.items);
  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of items) {
      if (i.project) counts[`project:${i.project.id}`] = (counts[`project:${i.project.id}`] ?? 0) + 1;
      if (i.asset) counts[`asset:${i.asset.id}`] = (counts[`asset:${i.asset.id}`] ?? 0) + 1;
    }
    return counts;
  }, [items]);
}

function ProjectRow({ project, active, count }: { project: Project; active: boolean; count?: number }) {
  const selectProject = useStore((s) => s.selectProject);
  const hot = useDropHot(`project:${project._id}`);
  return (
    <div
      className={`project-row ${active ? "active" : ""} ${hot ? "drop-hot" : ""}`}
      data-drop-project={project._id}
      data-drop-label={project.name}
      onClick={() => selectProject(active ? undefined : project._id)}
      title={active ? "Click again to close" : undefined}
    >
      <span className="name">{project.name}</span>
      {count ? <span className="count-badge">{count}</span> : null}
      <span className="prefix mono">{project.filePrefix}</span>
    </div>
  );
}

function AssetRow({ asset, project, count }: { asset: Asset; project: Project; count?: number }) {
  const hot = useDropHot(`asset:${asset._id}`);
  const removeExpected = useStore((s) => s.removeExpected);
  return (
    <div
      className={`asset-row ${asset.expected ? "expected" : ""} ${hot ? "drop-hot" : ""}`}
      data-drop-project={project._id}
      data-drop-asset={asset._id}
      data-drop-label={`${asset.name}`}
    >
      <div className="name">
        {asset.name} {count ? <span className="count-badge">{count}</span> : null}
        {asset.expected && (
          <span className="expected-tag" title={`From a pasted list${asset.addedBy ? ` (added by ${asset.addedBy})` : ""}; not in Pixwel yet`}>
            Expected
            <button
              className="forget"
              title="Forget this expected asset"
              aria-label={`Forget ${asset.name}`}
              onClick={() => removeExpected(project._id, asset._id)}
            >
              ✕
            </button>
          </span>
        )}
      </div>
      <div className="title mono">{assetTitleToken(asset)}</div>
      <div className="faint">{asset.length ? formatDuration(asset.length) : ""}</div>
      <div className="faint">{asset.mediaType ?? ""}</div>
    </div>
  );
}

function ProjectPane({ project }: { project: Project }) {
  const selectProject = useStore((s) => s.selectProject);
  const assets = useStore((s) => s.assets[project._id]);
  const types = useStore((s) => s.catalog.types);
  const counts = useQueuedCounts();
  const [query, setQuery] = useState("");
  const [pasting, setPasting] = useState(false);
  const hot = useDropHot(`project:${project._id}`);

  const groups = useMemo(() => {
    if (assets?.status !== "ready") return [];
    const q = query.trim().toLowerCase();
    const filtered = assets.data.filter(
      (a) => !q || a.name.toLowerCase().includes(q) || a.slug.includes(q) || a.type.includes(q),
    );
    const byType = new Map<string, Asset[]>();
    for (const a of filtered) byType.set(a.type, [...(byType.get(a.type) ?? []), a]);
    return [...byType.entries()];
  }, [assets, query]);

  const typeLabel = (name: string) => {
    const t = types.find((t) => t.name === name);
    return t ? `${name} · ${/trailer/.test(name) ? "no type token" : typeToken(t)}` : name;
  };

  return (
    <div className="main">
      <div
        className={`project-head ${hot ? "drop-hot" : ""}`}
        data-drop-project={project._id}
        data-drop-label={`${project.name} (assets matched automatically)`}
      >
        <div style={{ flex: 1 }}>
          <h1>{project.name}</h1>
          <div className="sub">
            Prefix <span className="mono">{project.filePrefix ?? "— none set —"}</span> · Drop files on an asset, or here to
            match assets automatically
          </div>
        </div>
        <button className="btn" title={`Choose a folder for ${project.name}`} onClick={() => pickPaths("folder", { projectId: project._id })}>
          Choose…
        </button>
        <button
          className="btn"
          title="Paste the asset names you're expecting (not in Pixwel yet) so files can be matched and named to them"
          onClick={() => setPasting(true)}
        >
          Expected…
        </button>
        <input className="field" style={{ width: 240 }} placeholder="Filter assets" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn ghost" title="Close project (Esc)" aria-label="Close project" onClick={() => selectProject(undefined)}>
          ✕
        </button>
      </div>
      <div className="assets">
        {assets?.status === "loading" && <div className="empty">Loading assets…</div>}
        {assets?.status === "error" && <div className="empty">Couldn't load assets: {assets.error}</div>}
        {assets?.status === "ready" && !groups.length && <div className="empty">No assets{query ? " match" : ""}.</div>}
        {groups.map(([type, list]) => (
          <div className="type-group" key={type}>
            <div className="type-label">{typeLabel(type)}</div>
            {list.map((a) => (
              <AssetRow key={a._id} asset={a} project={project} count={counts[`asset:${a._id}`]} />
            ))}
          </div>
        ))}
      </div>
      {pasting && <ExpectedDialog project={project} onClose={() => setPasting(false)} />}
    </div>
  );
}

export function Browse() {
  const projects = useStore((s) => s.projects);
  const selectedId = useStore((s) => s.selectedProjectId);
  const openSettings = useStore((s) => s.openSettings);
  const counts = useQueuedCounts();
  const [query, setQuery] = useState("");

  const list = useMemo(() => {
    if (projects.status !== "ready") return [];
    const q = query.trim().toLowerCase();
    return projects.data.filter(
      (p) => !q || p.name.toLowerCase().includes(q) || (p.filePrefix ?? "").toLowerCase().includes(q),
    );
  }, [projects, query]);
  const selected = projects.status === "ready" ? projects.data.find((p) => p._id === selectedId) : undefined;

  return (
    <div className="browse">
      <aside className="sidebar">
        <div className="sidebar-head">
          <input className="field search" placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="list">
          {projects.status === "loading" && <div className="empty">Loading projects…</div>}
          {projects.status === "error" && (
            <div className="empty">
              <div>
                <p>{projects.error}</p>
                <button className="btn" style={{ marginTop: 10 }} onClick={() => openSettings(true)}>
                  Open settings
                </button>
              </div>
            </div>
          )}
          {list.map((p) => (
            <ProjectRow key={p._id} project={p} active={p._id === selectedId} count={counts[`project:${p._id}`]} />
          ))}
        </div>
      </aside>
      {selected ? (
        <ProjectPane project={selected} />
      ) : (
        <div className="empty">
          <div>
            <PickArt />
            <h2>Drop a folder of files</h2>
            <p>
              Drop onto a project or asset to tell Pixname where the files belong, or anywhere on this window and it will
              work out the project and asset from the file names, folders and running times.
            </p>
            <PickButtons />
          </div>
        </div>
      )}
    </div>
  );
}
