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
  const store = new Map<string, unknown>([["settings", { environment: "staging", token: "pat_dev", customUrl: "", ffprobePath: "", mediainfoPath: "" }]]);
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
}
