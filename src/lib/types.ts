// Shapes of the Pixwel API resources this app reads. Only the fields we use are typed.

export interface Project {
  _id: string;
  name: string;
  slug: string;
  filePrefix?: string;
  studio?: string | { _id?: string; name?: string; slug?: string };
  archived?: boolean;
  /** Unix seconds. */
  created?: number;
}

export interface Asset {
  _id: string;
  name: string;
  slug: string;
  type: string;
  length?: number;
  mediaType?: string;
  project: string | { _id: string };
  /** Unix seconds. */
  created?: number;
}

export interface AssetType {
  name: string; // the type id, e.g. "tv-spot.us"
  file?: string; // the "Filename Part" token
  category?: string; // av | print | digital | documents
  group?: string;
}

export interface Tag {
  name: string;
  type?: string;
  display?: string;
  aliases?: string[];
  set?: string[];
  file?: string;
  extension?: string;
  ffprobeRules?: Record<string, string | string[]>;
}

export interface Language {
  _id?: string;
  name: string;
  code: string;
  dcpCode?: string;
  isoCode?: string;
}

export interface Territory {
  _id?: string;
  name: string;
  code?: string;
  countries?: { name: string; code: string }[];
  languages?: { name: string; code: string }[];
}

export interface WorkRequest {
  _id: string;
  name?: string;
  status?: string;
  language?: string | { code?: string };
  territory?: string | { code?: string };
  dng?: string | { dialogue?: string[]; graphics?: string[]; narration?: string[] };
  tags?: { name: string; description?: string }[];
  rejections?: { tag?: string; revision?: number }[];
  asset?: string | { _id: string };
  project?: string | { _id: string };
}

export interface Catalog {
  tags: Tag[];
  types: AssetType[];
  territories: Territory[];
  languages: Language[];
}

export type MediaType = "video" | "image" | "audio" | "document" | "zip";

/** Download tags as the SDK's `renderFilename` expects them. */
export interface DownloadTags {
  Usage?: string | null;
  Aspect?: string | null;
  Standard?: string | null;
  SubDub: { sub?: boolean | null; dub?: boolean | null };
  Resolution?: string | null;
  "Frame Mode"?: string | null;
  Framerate?: string | null;
  Text?: string | null;
  Codec?: string | null;
  Extra: string[];
  [type: string]: unknown;
}

export interface Probe {
  ffprobe?: any;
  mediainfo?: any;
  image?: [number, number];
  errors: string[];
}

export interface FileEntry {
  path: string;
  name: string;
  dir: string;
  size: number;
  /** Folders from the dropped folder down to this file, outermost first. */
  relDirs: string[];
}

export type MatchSource = "drop" | "prefix" | "learned" | "fuzzy" | "manual";

export interface Match {
  id: string;
  source: MatchSource;
  score: number; // 0..1
}

/** What the user has explicitly set on a row; these win over everything detected. */
export interface Overrides {
  language?: string;
  country?: string;
  text?: string; // Text tag name, "" to clear
  sub?: boolean;
  dub?: boolean;
  extra?: string[];
  version?: string;
  codec?: string;
  frameMode?: string;
  workRequestId?: string | null;
  workRequestTag?: string | null;
}

export interface QueueItem {
  id: string;
  file: FileEntry;
  ext: string;
  mediaType?: MediaType;
  probe?: Probe;
  probing: boolean;
  project?: Match;
  asset?: Match;
  overrides: Overrides;
  selected: boolean;
}
