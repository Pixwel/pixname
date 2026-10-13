import { Ingest } from "@pixwel/pixwel-sdk";
import type { MediaType, Probe, Tag } from "./types";

// Mirrors slurpee3 ingestPrepare/fileType.js (plus gif, which the API also accepts as an image).
const EXTENSION_TYPES: Record<MediaType, string[]> = {
  document: ["doc", "docx", "xls", "xlsx", "txt", "pdf", "ppt", "pptx"],
  video: ["mov", "mp4", "m4v", "mpg", "mxf"],
  audio: ["mp3", "wav", "m4a"],
  image: ["jpg", "jpeg", "png", "tif", "tiff", "ai", "psd", "eps", "gif"],
  zip: ["zip"],
};

export function mediaTypeOf(ext: string): MediaType | undefined {
  const e = ext.toLowerCase();
  return (Object.keys(EXTENSION_TYPES) as MediaType[]).find((t) => EXTENSION_TYPES[t].includes(e));
}

/** Round half-to-even to 3 places, matching how mediainfo prints ratios (0.5625 -> "0.562"). */
function ratio3(value: number): string {
  const scaled = value * 1000;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let n = diff > 0.5 + 1e-9 ? floor + 1 : diff < 0.5 - 1e-9 ? floor : floor % 2 === 0 ? floor : floor + 1;
  return (n / 1000).toFixed(3);
}

function fraction(value?: string): number | undefined {
  if (!value) return undefined;
  const [n, d] = value.split("/").map(Number);
  const result = d ? n / d : n;
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

const MEDIAINFO_FORMATS: Record<string, string> = {
  h264: "AVC",
  prores: "ProRes",
  hevc: "HEVC",
  dnxhd: "VC-3",
  mpeg2video: "MPEG Video",
};

/**
 * Build a mediainfo-shaped JSON document from ffprobe output, so the SDK's own
 * `mapFromMediainfo` does the mapping when the mediainfo binary isn't installed.
 */
export function mediainfoFromFfprobe(ff: any, image?: [number, number]): any {
  const general: any = { "@type": "General" };
  if (String(ff?.format?.format_name ?? "").split(",").includes("mxf")) general.Format = "MXF";
  const tracks: any[] = [general];

  const video = (ff?.streams ?? []).find(
    (s: any) => s.codec_type === "video" && !s.disposition?.attached_pic,
  );
  if (video?.width && video?.height) {
    const sar = fraction(video.sample_aspect_ratio) ?? 1;
    const rate = fraction(video.avg_frame_rate) ?? fraction(video.r_frame_rate);
    const order = String(video.field_order ?? "");
    const track: any = {
      "@type": "Video",
      Format: MEDIAINFO_FORMATS[video.codec_name] ?? video.codec_name ?? "",
      Width: String(video.width),
      Height: String(video.height),
      DisplayAspectRatio: ratio3((video.width * sar) / video.height),
      FrameRate: rate ? rate.toFixed(3) : "",
      ScanType:
        order === "progressive" ? "Progressive" : ["tt", "bb", "tb", "bt"].includes(order) ? "Interlaced" : "",
    };
    tracks.push(track);
    // Still images come back from ffprobe as a single-frame video stream.
    tracks.push({ "@type": "Image", Width: track.Width, Height: track.Height });
  } else if (image) {
    tracks.push({ "@type": "Image", Width: String(image[0]), Height: String(image[1]) });
  }
  return { media: { track: tracks } };
}

/** Run the SDK's mediainfo mapping and return its download tags. */
export function tagsFromMediainfo(probe: Probe | undefined, mediaType: MediaType | undefined): Record<string, any> {
  if (!probe || !mediaType) return {};
  let info = probe.mediainfo;
  const hasTrack = (type: string) =>
    Array.isArray(info?.media?.track) && info.media.track.some((t: any) => t["@type"] === type);
  if (!hasTrack(mediaType === "image" ? "Image" : "Video")) {
    info = mediainfoFromFfprobe(probe.ffprobe, probe.image);
  }
  try {
    const mapped = new Ingest({ mediainfo: info, source: { mediaType } }).mapFromMediainfo();
    return mapped?.selected?.download?.tags ?? {};
  } catch {
    return {};
  }
}

/**
 * Tags whose `ffprobeRules` match any stream, grouped by tag type. This is what the
 * platform stores as `ffprobeTags` and prefers over the filename for each group.
 */
export function tagsFromFfprobe(ff: any, tags: Tag[]): Record<string, string[]> {
  const streams: any[] = ff?.streams ?? [];
  const grouped: Record<string, string[]> = {};
  for (const tag of tags) {
    if (!tag.type || !tag.ffprobeRules) continue;
    const rules = Object.entries(tag.ffprobeRules);
    if (!rules.length) continue;
    const hit = streams.some((s) =>
      rules.every(([key, expected]) => {
        const actual = s[key] === undefined ? undefined : String(s[key]);
        return Array.isArray(expected) ? expected.includes(actual as string) : expected === actual;
      }),
    );
    if (hit) (grouped[tag.type] ??= []).push(tag.name);
  }
  return grouped;
}

export function durationOf(probe?: Probe): number | undefined {
  const d = parseFloat(probe?.ffprobe?.format?.duration);
  return Number.isFinite(d) ? d : undefined;
}

export function formatDuration(seconds?: number): string {
  if (seconds === undefined) return "";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
