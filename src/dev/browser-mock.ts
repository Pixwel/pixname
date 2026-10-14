// Dev-only: lets the UI run in a plain browser (`npm run dev`) by faking the Tauri backend
// with a few sample projects, assets and files. Never loaded inside the app.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const projects = [
  { _id: "p1", name: "Children of Blood and Bone", slug: "children-of-blood-and-bone", filePrefix: "COBAB" },
  { _id: "p2", name: "Paw Patrol: The Mighty Movie", slug: "paw-patrol", filePrefix: "PAWPATROL" },
  { _id: "p3", name: "Street Fighter", slug: "street-fighter", filePrefix: "STREETFIGHTER" },
  { _id: "p4", name: "Sin Fronteras", slug: "sin-fronteras", filePrefix: "SINFRONTERAS" },
];

const assets: Record<string, unknown[]> = {
  p1: [
    { _id: "a1", name: "Inside the World of Orisha", slug: "inside-the-world-of-orisha", type: "featurette", length: 123, mediaType: "video", project: "p1" },
    { _id: "a2", name: "Int'l Trailer A", slug: "intl-trailer-a", type: "trailer.intl", length: 167, mediaType: "video", project: "p1" },
    { _id: "a7", name: "Tug of War", slug: "tug-of-war", type: "social", length: 30, mediaType: "video", project: "p1" },
    { _id: "a3", name: "Energy Bumper Vertical 06", slug: "energy-bumper-vertical-06", type: "trailr-support", length: 6, mediaType: "video", project: "p1" },
  ],
  p3: [
    { _id: "a4", name: "Andrew vs Noah: A Brotherhood Forged", slug: "andrew-vs-noah-a-brotherhood-forged", type: "social", length: 30, mediaType: "video", project: "p3" },
    { _id: "a5", name: "Chun Li Vertical 30", slug: "chun-li-vertical-30", type: "social", length: 30, mediaType: "video", project: "p3" },
    { _id: "a6", name: "In Theater Etiquette", slug: "in-theater-etiquette", type: "in-theater", length: 30, mediaType: "video", project: "p3" },
  ],
};

const probe = {
  errors: [],
  ffprobe: {
    streams: [{ codec_type: "video", codec_name: "prores", width: 1080, height: 1920, sample_aspect_ratio: "1:1", avg_frame_rate: "24000/1001", field_order: "progressive" }],
    format: { format_name: "mov", duration: "30.0" },
  },
};

export function installBrowserMock() {
  mockWindows("main");
  const store = new Map<string, unknown>([["settings", { environment: "staging", token: "pat_dev", customUrl: "", ffprobePath: "", mediainfoPath: "", serviceUrl: "https://pixname-dev.example", aiMatching: true }]]);
  mockIPC(
    (cmd, args: any) => {
      switch (cmd) {
        case "plugin:store|load":
          return 1;
        case "plugin:store|get":
          return [store.get(args.key), store.has(args.key)];
        case "plugin:store|set":
          store.set(args.key, args.value);
          return null;
        case "plugin:store|save":
          return null;
        case "plugin:app|version":
          return "dev";
        case "has_undo":
          return false;
        // A pretend Pixname service: one shared code, team memory for "Tug of War", AI for the rest.
        case "service_request": {
          const { path, body } = args as { path: string; body: any };
          if (path === "api/health") return { ok: true, env: "staging", ai: true, model: "claude-sonnet-5-5 via Anthropic API" };
          if (path === "api/codes") return { codes: { STF: [{ projectId: "p3", votes: 4, people: 2, updatedAt: 0 }] } };
          if (path === "api/resolutions/lookup")
            return {
              matches: (body.names as string[]).map((name) =>
                /tug of war/i.test(name)
                  ? { name, projectId: "p1", assetId: "a7", similarity: 0.83, votes: 3, people: 2, example: "0080_Tug of War_Green Box.mov" }
                  : null,
              ),
            };
          if (path === "api/match")
            return {
              matches: (body.files as { name: string }[]).map((f, file) =>
                /chun/i.test(f.name)
                  ? { file, projectId: "p3", assetId: "a5", confidence: 0.82, reason: "'Chun Li vert' matches the vertical Chun Li asset (30s)." }
                  : { file, projectId: null, assetId: null, confidence: 0.2, reason: "Nothing in the lists fits this name." },
              ),
            };
          return { ok: true };
        }
        case "read_log":
          return {
            path: "/Users/you/Library/Logs/com.pixwel.pixname/pixname.log",
            text: [
              "[2026-10-13][19:40:01][pixname_lib][INFO] Pixname 0.2.6 starting on macos aarch64",
              "[2026-10-13][19:40:02][webview][INFO] Loaded 4 projects from staging",
              "[2026-10-13][19:40:09][webview][INFO] Added 3 file(s) from 1 path(s)",
              "[2026-10-13][19:40:10][webview][INFO] Matched \"0080_Tug of War_Green Box.mov\" -> Children of Blood and Bone (fuzzy 86%) / Tug of War (fuzzy 95%)",
              "[2026-10-13][19:40:10][webview][INFO] No confident project for \"FH_Promo_Final.mov\" (folders: none)",
              "[2026-10-13][19:40:11][pixname_lib][WARN] Probing \"/x/broken.mov\": mediainfo: exited with status 1",
              "[2026-10-13][19:41:30][pixname_lib][INFO] Renamed \"/x/0080_Tug of War_Green Box.mov\" -> \"/x/COBAB_SOCIAL_TUG-OF-WAR_ENG_TXTD_GREEN-BOX_PRORES_1920p2398.mov\"",
              "[2026-10-13][19:40:12][pixname_lib][WARN] GET https://api-staging.pixwel.com/api/assets -> 500 Internal Server Error: {}",
            ].join("\n"),
          };
        case "clear_log":
          return null;
        case "tool_status":
          return { ffprobe: "/opt/homebrew/bin/ffprobe", mediainfo: null };
        case "api_get":
          if (args.path === "projects") return projects;
          if (args.path === "assets") {
            const query = Object.fromEntries(args.query);
            if (query.q) return Object.values(assets).flat().filter((a: any) => a.name.toLowerCase().includes(query.q.toLowerCase()));
            return assets[query.project] ?? [];
          }
          if (args.path === "workrequests") return [];
          throw new Error("use bundled data");
        case "expand_paths":
          return (args.paths as string[]).map((path) => ({
            path,
            name: path.split("/").pop(),
            dir: "/Volumes/Deliverables/Incoming",
            size: 36_700_000,
            relDirs: [],
          }));
        case "probe_file":
          return probe;
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
  // Handy for poking at the UI from devtools: __pixnameDrop(["/x/SF_AndrewVsNoah_INTL_9x16_Prores.mov"])
  (window as any).__pixnameDrop = async (paths: string[]) => {
    const { useStore } = await import("../store");
    return useStore.getState().addPaths(paths, {});
  };
  (window as any).__pixnameStore = async () => (await import("../store")).useStore;
}
