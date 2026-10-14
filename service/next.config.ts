import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  // libSQL ships native bindings; let Node load it rather than bundling it.
  serverExternalPackages: ["@libsql/client"],
  // This app lives in service/ inside the Pixname repo; don't treat the repo root as the workspace.
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
};

export default config;
