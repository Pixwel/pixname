import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { service, type AssetRule, type HistoryRow, type Stats, type Suggestion } from "../lib/service";
import type { MatchSource } from "../lib/types";

type Tab = "history" | "stats" | "rules";

const SOURCE_LABELS: Record<MatchSource, string> = {
  drop: "Dropped on it",
  prefix: "Project prefix",
  learned: "Vendor code",
  rule: "Rule",
  fuzzy: "Name & folders",
  team: "Team memory",
  ai: "AI",
  manual: "By hand",
};

const when = (seconds: number) => {
  const d = new Date(seconds * 1000);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};

/** Project and asset names for ids from the service (assets load per project, on demand). */
function useNames(projectIds: string[]) {
  const projects = useStore((s) => s.projects);
  const assets = useStore((s) => s.assets);
  const ensureAssets = useStore((s) => s.ensureAssets);
  const key = [...new Set(projectIds)].sort().join(",");
  useEffect(() => {
    for (const id of key.split(",").filter(Boolean)) ensureAssets(id).catch(() => {});
  }, [key]);
  return {
    project: (id: string) => (projects.status === "ready" && projects.data.find((p) => p._id === id)?.name) || "Unknown project",
    asset: (projectId: string, id: string | null) => {
      if (!id) return "no asset";
      const list = assets[projectId];
      return (list?.status === "ready" && list.data.find((a) => a._id === id)?.name) || "…";
    },
  };
}

/** Renames, stats and the rules workbench. Admins see the whole team; everyone else their own. */
export function Activity() {
  const health = useStore((s) => (s.service.status === "ready" ? s.service.health : undefined));
  const isAdmin = !!health?.user?.isAdmin;
  const [tab, setTab] = useState<Tab>("history");

  return (
    <div className="activity">
      <div className="review-bar">
        <button className="btn" onClick={() => useStore.getState().setView("browse")}>← Projects</button>
        <div className="seg">
          <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History</button>
          <button className={tab === "stats" ? "on" : ""} onClick={() => setTab("stats")}>Stats</button>
          {isAdmin && (
            <button className={tab === "rules" ? "on" : ""} onClick={() => setTab("rules")}>Rules</button>
          )}
        </div>
        <span className="spacer" />
        <span className="muted">{isAdmin ? "Everyone's renames (admin)" : `Your renames${health?.user ? ` · ${health.user.name}` : ""}`}</span>
      </div>
      <div className="activity-body">
        {tab === "history" && <History isAdmin={isAdmin} />}
        {tab === "stats" && <StatsView isAdmin={isAdmin} />}
        {tab === "rules" && isAdmin && <Rules />}
      </div>
    </div>
  );
}

function History({ isAdmin }: { isAdmin: boolean }) {
  const settings = useStore((s) => s.settings);
  const projects = useStore((s) => s.projects);
  const [q, setQ] = useState("");
  const [userId, setUserId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [missedOnly, setMissedOnly] = useState(false);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | string>("loading");
  const [people, setPeople] = useState<{ userId: string; userName: string }[]>([]);
  const names = useNames(rows.map((r) => r.projectId));

  useEffect(() => {
    if (isAdmin) service.stats(settings, 365).then((s) => setPeople(s.perUser)).catch(() => {});
  }, [isAdmin]);

  const load = async (before?: number) => {
    setState("loading");
    try {
      const page = await service.history(settings, { q, userId: userId || undefined, projectId: projectId || undefined, missedOnly: missedOnly || undefined, before, limit: 50 });
      setRows((current) => (before ? [...current, ...page.rows] : page.rows));
      setMore(page.more);
      setState("ready");
    } catch (e) {
      setState(String(e));
    }
  };

  // Search as you type, a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => load(), 250);
    return () => clearTimeout(t);
  }, [q, userId, projectId, missedOnly]);

  const projectList = projects.status === "ready" ? projects.data : [];
  return (
    <>
      <div className="activity-filters">
        <input className="field search-field" placeholder="Search old or new file names" value={q} onChange={(e) => setQ(e.target.value)} />
        {isAdmin && (
          <select className="field" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.userId} value={p.userId}>{p.userName}</option>
            ))}
          </select>
        )}
        <select className="field" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {projectList.map((p) => (
            <option key={p._id} value={p._id}>{p.name}</option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={missedOnly} onChange={(e) => setMissedOnly(e.target.checked)} />
          <span>Only files Pixname got wrong or couldn't place</span>
        </label>
      </div>
      {state !== "loading" && state !== "ready" && <div className="msg err">Couldn't load history: {state}</div>}
      {state === "ready" && !rows.length && <div className="empty-note muted">No renames{q || userId || projectId || missedOnly ? " match" : " yet"}.</div>}
      <div className="history">
        {rows.map((r) => (
          <div key={r.id} className={`history-row ${r.undoneAt ? "is-undone" : ""}`}>
            <div className="history-when muted">
              {when(r.at)}
              {isAdmin && <div className="history-who">{r.userName}</div>}
            </div>
            <div className="history-names">
              <div className="mono from" title={r.name}>{r.name}</div>
              <div className="mono to" title={r.newName ?? ""}>{r.newName ? `→ ${r.newName}` : "→ (new name not recorded)"}</div>
            </div>
            <div className="history-ctx">
              <div>{names.project(r.projectId)}</div>
              <div className="muted">{names.asset(r.projectId, r.assetId)}</div>
            </div>
            <div className="history-source">
              <span className={`conf ${r.source === "ai" ? "ai" : r.source === "team" ? "team" : r.source === "rule" ? "rule" : "code"}`}>
                {SOURCE_LABELS[r.source] ?? r.source}
              </span>
              {r.undoneAt && (
                <div className="undone" title={`Undone ${when(r.undoneAt)}; it no longer counts in stats or team memory`}>Undone</div>
              )}
              {!r.undoneAt && r.missed && r.source !== "drop" && (
                <div className="miss" title={r.guess ? `Pixname guessed ${names.project(r.guess.projectId)} / ${names.asset(r.guess.projectId, r.guess.assetId)} (${SOURCE_LABELS[r.guess.source] ?? r.guess.source})` : "Pixname had no guess"}>
                  {r.guess ? "Guess corrected" : "No guess"}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {more && (
        <div className="load-more">
          <button className="btn" disabled={state === "loading"} onClick={() => load(rows[rows.length - 1]?.id)}>
            {state === "loading" ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}

function StatsView({ isAdmin }: { isAdmin: boolean }) {
  const settings = useStore((s) => s.settings);
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string>();
  const names = useNames(stats?.perProject.map((p) => p.projectId) ?? []);

  useEffect(() => {
    setError(undefined);
    service.stats(settings, days).then(setStats).catch((e) => setError(String(e)));
  }, [days]);

  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");
  const maxDay = Math.max(1, ...(stats?.perDay.map((d) => d.files) ?? []));
  const automatic = stats ? stats.files - stats.missed : 0;

  return (
    <>
      <div className="activity-filters">
        <div className="seg">
          {[7, 30, 90, 365].map((d) => (
            <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>
              {d === 365 ? "Year" : `${d} days`}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="msg err">Couldn't load stats: {error}</div>}
      {stats && (
        <div className="stats">
          <div className="stat-cards">
            <div className="stat-card"><b>{stats.files}</b><span>files renamed</span></div>
            {isAdmin && <div className="stat-card"><b>{stats.people}</b><span>people</span></div>}
            <div className="stat-card"><b>{pct(automatic, stats.files)}</b><span>placed right by Pixname</span></div>
            <div className="stat-card">
              <b>{pct(stats.ai.kept, stats.ai.suggested)}</b>
              <span>AI suggestions kept ({stats.ai.suggested})</span>
            </div>
          </div>

          <h3>
            Per day <span className="legend"><i className="swatch-files" /> renamed <i className="swatch-missed" /> fixed by hand</span>
          </h3>
          <div className="day-bars">
            {stats.perDay.map((d) => (
              <div key={d.day} className="day-bar" title={`${d.day}: ${d.files} files, ${d.missed} needed fixing`}>
                <div className="bar" style={{ height: `${(d.files / maxDay) * 100}%` }}>
                  <div className="bar-missed" style={{ height: `${d.files ? (d.missed / d.files) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
            {!stats.perDay.length && <span className="muted">No renames in this period.</span>}
          </div>

          <div className="stat-tables">
            <div>
              <h3>How files were matched</h3>
              {stats.bySource.map((s) => (
                <div key={s.source} className="hbar-row">
                  <span>{SOURCE_LABELS[s.source] ?? s.source}</span>
                  <div className="hbar"><div style={{ width: pct(s.files, stats.files) }} /></div>
                  <span className="muted">{s.files}</span>
                </div>
              ))}
            </div>
            {isAdmin && (
              <div>
                <h3>By person</h3>
                <table className="stat-table">
                  <tbody>
                    {stats.perUser.map((u) => (
                      <tr key={u.userId}>
                        <td>{u.userName}</td>
                        <td className="num">{u.files}</td>
                        <td className="num muted" title="Needed fixing by hand">{pct(u.missed, u.files)} fixed</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div>
              <h3>By project</h3>
              <table className="stat-table">
                <tbody>
                  {stats.perProject.map((p) => (
                    <tr key={p.projectId}>
                      <td>{names.project(p.projectId)}</td>
                      <td className="num">{p.files}</td>
                      <td className="num muted" title="Needed fixing by hand">{pct(p.missed, p.files)} fixed</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Admins: turn repeated misses into rules, and manage asset rules. */
function Rules() {
  const settings = useStore((s) => s.settings);
  const assetRules = useStore((s) => s.assetRules);
  const reloadRules = useStore((s) => s.reloadRules);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const ids = useMemo(() => [...(suggestions ?? []).map((s) => s.projectId), ...assetRules.map((r) => r.projectId)], [suggestions, assetRules]);
  const names = useNames(ids);

  const load = () => service.suggestions(settings).then(setSuggestions).catch((e) => setError(String(e)));
  useEffect(() => {
    load();
  }, []);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(undefined);
    try {
      await fn();
      await reloadRules();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(undefined);
    }
  };

  const create = (s: Suggestion) =>
    act(`${s.kind}:${s.key}`, () =>
      s.kind === "code" ? service.editCode(settings, s.key, s.projectId) : service.addRule(settings, { phrase: s.key, projectId: s.projectId, assetId: s.assetId! }),
    );

  return (
    <div className="rules">
      {error && <div className="msg err">{error}</div>}
      <h3>Suggested rules</h3>
      <p className="muted">
        Files Pixname couldn't place, or placed wrong, that keep ending up in the same place. A rule makes Pixname place them
        for everyone, without AI.
      </p>
      {suggestions === null ? (
        <div className="muted">Looking at recent misses…</div>
      ) : !suggestions.length ? (
        <div className="empty-note muted">No patterns yet. They appear once the same kind of miss happens a couple of times.</div>
      ) : (
        suggestions.map((s) => (
          <div key={`${s.kind}:${s.key}`} className="suggestion">
            <div className="suggestion-main">
              <div>
                {s.kind === "code" ? (
                  <>
                    Vendor code <span className="code mono">{s.key}</span> means <b>{names.project(s.projectId)}</b>
                  </>
                ) : (
                  <>
                    Names with <span className="code mono">{s.key}</span> are <b>{names.asset(s.projectId, s.assetId)}</b>
                    <span className="muted"> in {names.project(s.projectId)}</span>
                  </>
                )}
              </div>
              <div className="muted examples">
                {s.files} file{s.files === 1 ? "" : "s"}
                {s.share < 1 ? ` (${Math.round(s.share * 100)}% of misses with this code)` : ""} · e.g.{" "}
                {s.examples.map((e) => (
                  <span key={e} className="mono">{e} </span>
                ))}
              </div>
            </div>
            <button className="btn small primary" disabled={!!busy} onClick={() => create(s)}>
              {busy === `${s.kind}:${s.key}` ? "Creating…" : "Create rule"}
            </button>
          </div>
        ))
      )}

      <h3>Asset rules</h3>
      {!assetRules.length ? (
        <div className="empty-note muted">None yet. Vendor codes are in Settings.</div>
      ) : (
        assetRules.map((r: AssetRule) => (
          <div key={r.id} className="suggestion">
            <div className="suggestion-main">
              <div>
                Names with <span className="code mono">{r.phrase}</span> are <b>{names.asset(r.projectId, r.assetId)}</b>
                <span className="muted"> in {names.project(r.projectId)}</span>
              </div>
              <div className="muted examples">
                Added by {r.createdBy}, {new Date(r.at * 1000).toLocaleDateString()}
              </div>
            </div>
            <button className="btn small" disabled={!!busy} onClick={() => act(`rule:${r.id}`, () => service.deleteRule(settings, r.id))}>
              Remove
            </button>
          </div>
        ))
      )}
    </div>
  );
}
