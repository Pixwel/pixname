import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useStore } from "../store";

interface LogTail {
  path: string;
  text: string;
}

const isMac = navigator.userAgent.includes("Mac");

// tauri-plugin-log lines: [2026-10-13][19:40:01][target][LEVEL] message
const LINE = /^\[(\d{4}-\d{2}-\d{2})\]\[([\d:.]+)\]\[([^\]]+)\]\[(\w+)\]\s?(.*)$/;

// Pieces of a message worth picking out: URLs, "quoted" file names and paths, arrows, percentages, HTTP errors.
const TOKENS = /(https?:\/\/[^\s]+)|("[^"]+")|(->)|(\b\d{1,3}%)|(\b[45]\d\d\b(?= |$))/g;

function Message({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKENS)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const [whole, url, file, arrow, pct, status] = m;
    const key = m.index;
    if (url) parts.push(<span key={key} className="t-url">{whole}</span>);
    else if (file) parts.push(<span key={key} className="t-file">{whole}</span>);
    else if (arrow) parts.push(<span key={key} className="t-arrow">→</span>);
    else if (pct) {
      const n = parseInt(pct, 10);
      parts.push(<span key={key} className={n >= 80 ? "t-high" : n >= 50 ? "t-mid" : "t-low"}>{whole}</span>);
    } else if (status) parts.push(<span key={key} className="t-low">{whole}</span>);
    last = m.index + whole.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function LogLine({ line }: { line: string }) {
  const m = LINE.exec(line);
  if (!m) return <span className="l-msg">{line}</span>;
  const [, date, time, target, level, message] = m;
  // "ui" is the window (matching, loading); "core" is the Rust side (files, probing, API requests).
  const source = target === "webview" ? "ui" : target === "pixname_lib" ? "core" : target;
  return (
    <>
      <span className="l-time" title={date}>{time.slice(0, 8)}</span>
      <span className={`l-level ${level.toLowerCase()}`}>{level}</span>
      <span className="l-source">{source}</span>
      <span className="l-msg">
        <Message text={message} />
      </span>
    </>
  );
}

/** Recent log lines (Help → Show Log, or Settings → View log), newest at the bottom. */
export function LogViewer() {
  const openLog = useStore((s) => s.openLog);
  const [log, setLog] = useState<LogTail | null>(null);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState("");
  const pre = useRef<HTMLPreElement>(null);

  const load = async () => {
    try {
      setLog(await invoke<LogTail>("read_log", { maxLines: 2000 }));
      setError(undefined);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Start at the newest lines.
  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [log?.text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      openLog(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const lines = (log?.text ?? "").split("\n").filter((l) => l && (!filter || l.toLowerCase().includes(filter.toLowerCase())));

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && openLog(false)}>
      <div className="dialog log-dialog">
        <div className="log-head">
          <h2>Log</h2>
          <input className="field" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="hint mono log-path">{log?.path ?? ""}</div>
        <pre className="log-text mono" ref={pre}>
          {error
            ? `Couldn't read the log: ${error}`
            : lines.length
              ? lines.map((line, i) => (
                  <div key={i} className={`l-row ${/\[ERROR\]/.test(line) ? "is-error" : /\[WARN\]/.test(line) ? "is-warn" : ""}`}>
                    <LogLine line={line} />
                  </div>
                ))
              : filter
                ? "No lines match."
                : "Nothing logged yet."}
        </pre>
        <div className="actions">
          <button type="button" className="btn" onClick={load}>Refresh</button>
          <button
            type="button"
            className="btn"
            disabled={!log?.text}
            onClick={async () => {
              await navigator.clipboard.writeText(lines.join("\n"));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : filter ? "Copy matching lines" : "Copy"}
          </button>
          <button type="button" className="btn" disabled={!log?.path} onClick={() => log && revealItemInDir(log.path)}>
            {isMac ? "Show in Finder" : "Show in Explorer"}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={!log?.text}
            onClick={async () => {
              await invoke("clear_log");
              await load();
            }}
          >
            Clear
          </button>
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={() => openLog(false)}>Done</button>
        </div>
      </div>
    </div>
  );
}
