import { useState } from "react";
import { useStore } from "../store";
import { apiGet } from "../lib/api";
import { ENVIRONMENT_URLS, type Environment, type Settings } from "../lib/settings";
import { useUpdater } from "../updater";

export function SettingsDialog() {
  const current = useStore((s) => s.settings);
  const tools = useStore((s) => s.tools);
  const updateSettings = useStore((s) => s.updateSettings);
  const openSettings = useStore((s) => s.openSettings);
  const [draft, setDraft] = useState<Settings>(current);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const updater = useUpdater();

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setTest(null);
  };

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
            <span>API token</span>
            <input
              className="field mono"
              type="password"
              value={draft.token}
              placeholder="svc_… or pat_…"
              autoFocus={!current.token}
              onChange={(e) => set("token", e.target.value)}
            />
            <span className="hint">
              {tokenLooksRight
                ? "A service account token (svc_) or personal access token (pat_). Tokens only work in the environment that issued them."
                : "Pixwel tokens start with svc_ or pat_."}
            </span>
          </label>
          <label>
            <span>ffprobe path</span>
            <input className="field mono" value={draft.ffprobePath} placeholder={tools.ffprobe ?? "Not found — e.g. /opt/homebrew/bin/ffprobe"} onChange={(e) => set("ffprobePath", e.target.value)} />
          </label>
          <label>
            <span>mediainfo path (optional, preferred when present)</span>
            <input className="field mono" value={draft.mediainfoPath} placeholder={tools.mediainfo ?? "Not found — ffprobe output is mapped instead"} onChange={(e) => set("mediainfoPath", e.target.value)} />
          </label>
          {test && <div className={`status-line ${test.ok ? "good" : "bad"}`}>{test.text}</div>}
          <div className="update-row">
            <span className="muted">Pixname {updater.version ?? ""}</span>
            <button type="button" className="btn small" disabled={updater.checking} onClick={() => updater.check(true)}>
              {updater.checking ? "Checking…" : "Check for updates"}
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
