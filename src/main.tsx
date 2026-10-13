import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

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
