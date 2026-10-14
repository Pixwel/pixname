import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/raleway/600.css";
import "@fontsource/raleway/700.css";
import "./theme.css";
import App from "./App";
import { applyTheme, getTheme } from "./theme";

// Before the first paint, so the saved theme never flashes the default.
applyTheme(getTheme());

async function start() {
  // Outside Tauri (plain `npm run dev` in a browser), fake the backend so the UI can be worked on.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    (await import("./dev/browser-mock")).installBrowserMock();
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

start();
