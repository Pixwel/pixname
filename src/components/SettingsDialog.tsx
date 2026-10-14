import { useState } from "react";
import { useStore } from "../store";
import { apiGet } from "../lib/api";
import { BUILT_IN_SERVICE_URL, ENVIRONMENT_URLS, serviceUrlOf, type Environment, type Settings } from "../lib/settings";
import { useUpdater } from "../updater";

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

export function SettingsDialog() {
  const current = useStore((s) => s.settings);
  const tools = useStore((s) => s.tools);
  const updateSettings = useStore((s) => s.updateSettings);
  const openSettings = useStore((s) => s.openSettings);
  const [draft, setDraft] = useState<Settings>(current);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const updater = useUpdater();
  const aliases = useStore((s) => s.aliases);
  const forgetAliases = useStore((s) => s.forgetAliases);
  const setAlias = useStore((s) => s.setAlias);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const projects = useStore((s) => s.projects);
  const projectName = (id: string) =>
    projects.status === "ready" ? projects.data.find((p) => p._id === id)?.name ?? "unknown project" : id;
  const projectOptions =
    projects.status === "ready" ? [...projects.data].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const serviceState = useStore((s) => s.service);
  const sharedCodes = useStore((s) => s.sharedCodes);
  const shared = serviceState.status === "ready";
  // With the service connected, the list is the team's; otherwise this machine's.
  const codeRows: { code: string; projectId: string; detail?: string }[] = shared
    ? Object.entries(sharedCodes)
        .map(([code, list]) => {
          const [top] = list;
          const others = list.length - 1;
          const people = Math.max(...list.map((c) => c.people));
          return {
            code,
            projectId: top.projectId,
            detail: `${top.votes} rename${top.votes === 1 ? "" : "s"} by ${people} ${people === 1 ? "person" : "people"}${others ? `, also used for ${others} other project${others === 1 ? "" : "s"}` : ""}`,
          };
        })
        .sort((a, b) => a.code.localeCompare(b.code))
    : Object.entries(aliases)
        .map(([code, projectId]) => ({ code, projectId }))
        .sort((a, b) => a.code.localeCompare(b.code));

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setTest(null);
  };

  // Most people only need a token. Open Advanced when a setting there was changed from its default.
  const advancedOpen = current.environment !== "production" || !!current.ffprobePath || !!current.mediainfoPath;

  const tokenLooksRight = !draft.token || /^(pat|svc)_\S+$/i.test(draft.token.trim());

  async function testConnection() {
    setTesting(true);
    try {
      const languages = await apiGet<unknown[]>(draft, "languages");
      setTest({ ok: true, text: `Connected — ${Array.isArray(languages) ? languages.length : 0} languages available` });
    } catch (e) {
      setTest({ ok: false, text: String(e) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && current.token && openSettings(false)}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          updateSettings({ ...draft, token: draft.token.trim() });
        }}
      >
        <h2>Settings</h2>
        <div className="muted">Connect to Pixwel to load projects, assets and work requests.</div>
        <div className="form">
          <label>
            <span>API token</span>
            <div className="secret">
              <input
                className="field mono"
                type={showToken ? "text" : "password"}
                value={draft.token}
                placeholder="svc_… or pat_…"
                autoFocus={!current.token}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => set("token", e.target.value)}
              />
              <button
                type="button"
                className="reveal"
                title={showToken ? "Hide token" : "Show token"}
                aria-label={showToken ? "Hide token" : "Show token"}
                aria-pressed={showToken}
                onClick={(e) => {
                  e.preventDefault();
                  setShowToken((v) => !v);
                }}
              >
                <EyeIcon off={showToken} />
              </button>
            </div>
            <span className="hint">
              {tokenLooksRight
                ? "A service account token (svc_) or personal access token (pat_). Tokens only work in the environment that issued them."
                : "Pixwel tokens start with svc_ or pat_."}
            </span>
          </label>
          {test && <div className={`status-line ${test.ok ? "good" : "bad"}`}>{test.text}</div>}
          <label className={`check ${serviceUrlOf(draft) ? "" : "disabled"}`}>
            <input
              type="checkbox"
              checked={draft.aiMatching && !!serviceUrlOf(draft)}
              disabled={!serviceUrlOf(draft)}
              onChange={(e) => set("aiMatching", e.target.checked)}
            />
            <span>
              AI matching
              <span className="hint">
                {serviceUrlOf(draft)
                  ? " — ask AI about files the rules and the team's earlier renames can't place"
                  : " — needs a Pixname service address (Advanced)"}
              </span>
            </span>
          </label>
          {codeRows.length > 0 && (
            <div className="codes">
              <div className="codes-head">
                <span>{shared ? "Team vendor codes" : "Remembered vendor codes"}</span>
                {!shared && (
                  <button type="button" className="btn small ghost" onClick={() => forgetAliases()}>Forget all</button>
                )}
              </div>
              <ul>
                {codeRows.map(({ code, projectId: id, detail }) => (
                  <li key={code}>
                    <span className="code mono">{code}</span>
                    <span className="arrow">→</span>
                    {editingCode === code ? (
                      <select
                        className="field project-select"
                        autoFocus
                        value={id}
                        onChange={(e) => {
                          setAlias(code, e.target.value);
                          setEditingCode(null);
                        }}
                        onBlur={() => setEditingCode(null)}
                        onKeyDown={(e) => {
                          if (e.key !== "Escape") return;
                          e.preventDefault();
                          e.stopPropagation();
                          setEditingCode(null);
                        }}
                      >
                        {!projectOptions.some((p) => p._id === id) && <option value={id}>{projectName(id)}</option>}
                        {projectOptions.map((p) => (
                          <option key={p._id} value={p._id}>{p.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="project" title={detail}>
                        {projectName(id)}
                        {detail && <span className="faint"> · {detail}</span>}
                      </span>
                    )}
                    <button
                      type="button"
                      className="row-action"
                      title={`Change the project for ${code}`}
                      aria-label={`Edit ${code}`}
                      disabled={!projectOptions.length}
                      onClick={() => setEditingCode(editingCode === code ? null : code)}
                    >
                      ✎
                    </button>
                    <button type="button" className="row-action forget" title={`Forget ${code}`} aria-label={`Forget ${code}`} onClick={() => forgetAliases(code)}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details className="advanced" open={advancedOpen}>
            <summary>Advanced</summary>
            <div className="form">
              <div className="status-line">
                {tools.mediainfo
                  ? <>Reading media with <b>mediainfo</b>{tools.mediainfoBundled ? " (built in)" : ""}</>
                  : tools.ffprobe
                    ? <>Reading media with <b>ffprobe</b></>
                    : <span className="bad">No media reader found — names are built without codec or resolution</span>}
                {(tools.mediainfo ?? tools.ffprobe) && <div className="hint mono">{tools.mediainfo ?? tools.ffprobe}</div>}
              </div>
              <label>
                <span>Pixname service (shared codes, team memory, AI)</span>
                <input
                  className="field mono"
                  value={draft.serviceUrl}
                  placeholder={BUILT_IN_SERVICE_URL || "https://pixname.example.vercel.app"}
                  spellCheck={false}
                  onChange={(e) => set("serviceUrl", e.target.value)}
                />
                <span className="hint">
                  {!serviceUrlOf(current)
                    ? "Optional. Without it Pixname works alone with the rules on this machine."
                    : serviceState.status === "ready"
                      ? `${current.serviceUrl.trim() ? "Connected" : "Connected to the built-in service"}${serviceState.health.ai ? ` · AI: ${serviceState.health.model}` : " · AI off on the service"}`
                      : serviceState.status === "error"
                        ? `Not connected: ${serviceState.error}`
                        : serviceState.status === "loading"
                          ? "Connecting…"
                          : current.environment === "custom"
                            ? "Not used with a custom API URL"
                            : ""}
                </span>
              </label>
              <label>
                <span>Environment</span>
                <select className="field" value={draft.environment} onChange={(e) => set("environment", e.target.value as Environment)}>
                  <option value="production">Production — {ENVIRONMENT_URLS.production}</option>
                  <option value="staging">Staging — {ENVIRONMENT_URLS.staging}</option>
                  <option value="custom">Custom URL</option>
                </select>
              </label>
              {draft.environment === "custom" && (
                <label>
                  <span>API base URL</span>
                  <input className="field" value={draft.customUrl} placeholder="http://localhost:8080/api" onChange={(e) => set("customUrl", e.target.value)} />
                </label>
              )}
              <label>
                <span>ffprobe path</span>
                <input className="field mono" value={draft.ffprobePath} placeholder={tools.ffprobe ?? "Not found — e.g. /opt/homebrew/bin/ffprobe"} onChange={(e) => set("ffprobePath", e.target.value)} />
              </label>
              <label>
                <span>mediainfo path (optional, preferred when present)</span>
                <input className="field mono" value={draft.mediainfoPath} placeholder={
                  tools.mediainfoBundled ? "Built in (MediaInfo)" : tools.mediainfo ?? "Not found — ffprobe output is mapped instead"
                } onChange={(e) => set("mediainfoPath", e.target.value)} />
              </label>
            </div>
          </details>
          <div className="update-row">
            <span className="muted">Pixname {updater.version ?? ""}</span>
            <button type="button" className="btn small" disabled={updater.checking} onClick={() => updater.check(true)}>
              {updater.checking ? "Checking…" : "Check for updates"}
            </button>
            <button type="button" className="btn small ghost" onClick={() => useStore.getState().openLog(true)}>
              View log
            </button>
            {updater.update && (
              <button type="button" className="btn small primary" disabled={updater.progress !== null} onClick={updater.install}>
                {updater.progress === null ? `Update to ${updater.update.version}` : `Updating… ${updater.progress}%`}
              </button>
            )}
            {updater.message && !updater.update && <span className="status-line">{updater.message}</span>}
          </div>
        </div>
        <div className="actions">
          <button type="button" className="btn" disabled={!draft.token || testing} onClick={testConnection}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          <span className="spacer" />
          {current.token && (
            <button type="button" className="btn ghost" onClick={() => openSettings(false)}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn primary" disabled={!draft.token}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
