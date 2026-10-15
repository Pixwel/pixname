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

/** The pretend service's shared expected-asset lists. */
let mockExpected: { projectId: string; slug: string; name: string; type: string; addedBy: string; at: number }[] = [];

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
          if (path === "api/health")
            return { ok: true, env: "staging", ai: true, model: "claude-sonnet-5-5 via Anthropic API", user: { id: "u1", name: "Jeff Loiselle", isAdmin: true } };
          if (path.startsWith("api/expected")) {
            const { method } = args as { method: string };
            if (method === "POST") {
              const slug = (n: string) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['’]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
              let added = 0;
              for (const name of body.names as string[]) {
                if (mockExpected.some((a) => a.projectId === body.projectId && a.slug === slug(name))) continue;
                mockExpected.push({ projectId: body.projectId, slug: slug(name), name, type: body.type, addedBy: "Jeff Loiselle", at: 1792000000 });
                added++;
              }
              return { added };
            }
            if (method === "DELETE") {
              const q = new URLSearchParams(path.split("?")[1]);
              mockExpected = mockExpected.filter((a) => a.projectId !== q.get("projectId") || (q.get("slug") && a.slug !== q.get("slug")));
              return { ok: true };
            }
            return { assets: mockExpected };
          }
          if (path === "api/rules")
            return { rules: [{ id: 1, phrase: "chun li vert", words: ["chun", "li", "vert"], projectId: "p3", assetId: "a5", createdBy: "Jeff Loiselle", at: 1791900000 }] };
          if (path.startsWith("api/rules/suggestions"))
            return {
              suggestions: [
                { kind: "code", key: "FH", projectId: "p2", assetId: null, files: 6, share: 1, examples: ["FH_PawPatrol_AvaMaxCallout_9x16.mov", "FH_PawPatrol_Promo.mov"] },
                { kind: "asset", key: "tug war", projectId: "p1", assetId: "a7", files: 3, share: 1, examples: ["0080_Tug of War_Green Box.mov", "0081_Tug of War_White Box.mov"] },
              ],
            };
          if (path.startsWith("api/activity/history"))
            return {
              more: false,
              rows: [
                { id: 3, at: 1791945600, userId: "u1", userName: "Jeff Loiselle", name: "0080_Tug of War_Green Box.mov", newName: "COBAB_SOCIAL_TUG-OF-WAR_ENG_TXTD_GREEN-BOX_PRORES_1920p2398.mov", dirs: [], projectId: "p1", assetId: "a7", source: "team", guess: { projectId: "p1", assetId: "a7", source: "team", score: 0.9 }, missed: false, undoneAt: null, size: 1, durationSec: 30 },
                { id: 2, at: 1791942000, userId: "u2", userName: "Sam Rivera", name: "FH_PawPatrol_Promo.mov", newName: "PAWPATROL_SOCIAL_PROMO_ENG_TXTD_PRORES_1080p2398.mov", dirs: ["Deliveries"], projectId: "p2", assetId: null, source: "manual", guess: null, missed: true, undoneAt: 1791943000, size: 1, durationSec: 15 },
                { id: 1, at: 1791938400, userId: "u2", userName: "Sam Rivera", name: "STF_In_Theater_Ettiquette_30.mov", newName: "STREETFIGHTER_IN-THEATER_IN-THEATER-ETIQUETTE_ENG_TXTL_PRORES_2048p24.mov", dirs: [], projectId: "p3", assetId: "a6", source: "ai", guess: { projectId: "p3", assetId: "a6", source: "ai", score: 0.85 }, missed: false, size: 1, durationSec: 30 },
              ],
            };
          if (path.startsWith("api/activity/stats"))
            return {
              days: 30, scope: "team", files: 42, people: 3, missed: 7,
              perDay: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, files: (i * 7) % 9, missed: i % 4 === 0 ? 1 : 0 })),
              perUser: [{ userId: "u1", userName: "Jeff Loiselle", files: 25, missed: 3, last: 0 }, { userId: "u2", userName: "Sam Rivera", files: 17, missed: 4, last: 0 }],
              perProject: [{ projectId: "p1", files: 20, missed: 2, last: 0 }, { projectId: "p3", files: 14, missed: 1, last: 0 }, { projectId: "p2", files: 8, missed: 4, last: 0 }],
              bySource: [{ source: "fuzzy", files: 18 }, { source: "team", files: 9 }, { source: "ai", files: 6 }, { source: "manual", files: 5 }, { source: "learned", files: 4 }],
              ai: { suggested: 8, kept: 6 },
            };
          if (path === "api/activity/seen")
            return {
              matches: (body.files as { name: string }[]).map((f) =>
                /green box/i.test(f.name)
                  ? { id: 9, at: 1791900000, userId: "u2", userName: "Sam Rivera", name: f.name, newName: "COBAB_SOCIAL_TUG-OF-WAR_ENG_TXTD_GREEN-BOX_PRORES_1920p2398.mov", dirs: [], projectId: "p1", assetId: "a7", source: "team", guess: null, missed: false, size: 1, durationSec: 30 }
                  : null,
              ),
            };
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
