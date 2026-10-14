// App log (Help → Show Log). Writes to the same file as the Rust side via tauri-plugin-log,
// and to the console. Never log the API token.
import { error as logError, info as logInfo, warn as logWarn } from "@tauri-apps/plugin-log";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function write(level: "info" | "warn" | "error", message: string) {
  (level === "info" ? console.info : level === "warn" ? console.warn : console.error)(`[pixname] ${message}`);
  if (!inTauri) return;
  const send = level === "info" ? logInfo : level === "warn" ? logWarn : logError;
  // Logging must never break the app.
  send(message).catch(() => {});
}

export const log = {
  info: (message: string) => write("info", message),
  warn: (message: string) => write("warn", message),
  error: (message: string) => write("error", message),
};

export const percent = (score?: number) => (score === undefined ? "-" : `${Math.round(score * 100)}%`);
