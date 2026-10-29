// Match short vendor codes ("SF", "STF", "PP3") to project names ("Street Fighter", "Paw Patrol 3")
// the way editor "go to file" pickers do: the code's letters must appear in order, and letters
// that start a word count most.
import { tokenize } from "./fuzzy";
import type { Project } from "./types";

const STOP = new Set(["the", "a", "an", "of", "and", "movie", "film"]);
const ROMAN: Record<string, string> = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };

/**
 * The leading code of a file name, if it looks like one: an all-caps/digit chunk of 2–6
 * characters before the first separator ("STF_In_Theater…", "PP3_Paw Patrol…", "0080_Tug…").
 */
export function vendorCode(fileName: string): string | undefined {
  const first = fileName.split(/[_\s.]/)[0] ?? "";
  if (first.length < 2 || first.length > 6) return undefined;
  if (!/^[A-Z0-9]+$/.test(first)) return undefined;
  return first;
}

/**
 * Best in-order placement of `letters` within `words`, starting at the first word's first letter.
 * A letter that starts a word scores 1, one right after the previous match in the same word 0.6,
 * anything else 0.2. Returns the average per letter and how many words were "started".
 */
function bestAlignment(letters: string, words: string[]): { score: number; starts: number } {
  const chars = words.flatMap((w, word) => [...w].map((c, i) => ({ c, start: i === 0, word })));
  const memo = new Map<string, { total: number; starts: number } | null>();

  const best = (li: number, prev: number): { total: number; starts: number } | null => {
    if (li === letters.length) return { total: 0, starts: 0 };
    const key = `${li}:${prev}`;
    if (memo.has(key)) return memo.get(key)!;
    let result: { total: number; starts: number } | null = null;
    for (let p = prev + 1; p < chars.length; p++) {
      if (chars[p].c !== letters[li]) continue;
      if (li === 0 && p !== 0) break;
      const contiguous = prev >= 0 && p === prev + 1 && chars[p].word === chars[prev].word;
      const weight = chars[p].start ? 1 : contiguous ? 0.6 : 0.2;
      const rest = best(li + 1, p);
      if (!rest) continue;
      const candidate = { total: weight + rest.total, starts: (chars[p].start ? 1 : 0) + rest.starts };
      if (!result || candidate.total > result.total) result = candidate;
    }
    memo.set(key, result);
    return result;
  };

  const found = best(0, -1);
  return found ? { score: found.total / letters.length, starts: found.starts } : { score: 0, starts: 0 };
}

/**
 * The remembered code a file name starts with: its vendor code, or else the longest known code
 * that begins its first chunk, so "FFSS26" also covers "FFSS261574XH.mov".
 */
export function knownCode(fileName: string, known: Iterable<string>): string | undefined {
  const codes = new Set(known);
  const code = vendorCode(fileName);
  if (code && codes.has(code)) return code;
  const first = fileName.split(/[_\s.]/)[0] ?? "";
  return [...codes].filter((c) => c.length >= 3 && first.startsWith(c)).sort((a, b) => b.length - a.length)[0];
}

const STUDIO_STOP = new Set(["the", "studio", "studios", "pictures", "films", "entertainment", "inc", "llc"]);

/** "Focus Features" -> "FF". One-word studios ("Paramount") have no usable initials. */
export function studioInitials(name: string): string | undefined {
  const words = tokenize(name).filter((w) => !STUDIO_STOP.has(w) && !/^\d+$/.test(w));
  return words.length >= 2 ? words.map((w) => w[0]).join("").toUpperCase() : undefined;
}

/**
 * How well a studio-style code fits a project: studio initials, title initials and a two-digit
 * year, e.g. "FFSS26" = Focus Features' Sense and Sensibility (2026). The code may run on into a
 * spot number ("FFSS261574XH"). 0 when the name doesn't start with the project's studio initials.
 */
export function studioCodeScore(fileName: string, project: Project, studioName: string | undefined): number {
  const initials = studioName && studioInitials(studioName);
  if (!initials) return 0;
  const m = (fileName.split(/[_\s.]/)[0] ?? "").match(/^([A-Z]{4,12})\d{2}/);
  if (!m || !m[1].startsWith(initials)) return 0;
  const title = m[1].slice(initials.length);
  return title.length >= 2 ? abbrevScore(title, project) : 0;
}

/** How well a vendor code abbreviates a project's name or file prefix, 0..1. */
export function abbrevScore(code: string, project: Project): number {
  const letters = code.toLowerCase().replace(/[0-9]/g, "");
  const digits = code.replace(/[^0-9]/g, "");
  if (letters.length < 2) return 0;

  const all = tokenize(project.name).map((w) => ROMAN[w] ?? w);
  const words = all.filter((w) => !STOP.has(w) && !/^\d+$/.test(w));
  if (!words.length) return 0;

  // The first letter must start the first significant word: "SF" is Street Fighter, not "aSFalt".
  const { score, starts } = bestAlignment(letters, words);
  if (!score) return 0;
  // Reward covering every significant word with a letter ("SF" covers both words of Street Fighter).
  const coverage = Math.min(1, starts / words.length);
  let result = 0.7 * score + 0.3 * coverage;

  // Sequel numbers: "PP3" fits "Paw Patrol 3" and argues against a title with a different number.
  // The file prefix often carries the sequel number the title spells out ("PAWPATROL3").
  const prefixNumbers = (project.filePrefix ?? "").match(/\d+/g) ?? [];
  const titleNumbers = [...all.filter((w) => /^\d+$/.test(w)), ...prefixNumbers];
  if (digits) {
    if (titleNumbers.includes(digits)) result += 0.15;
    else if (titleNumbers.length) result -= 0.25;
  }

  // The file prefix is often a squashed name ("STREETFIGHTER"): the code being its start helps.
  const prefix = (project.filePrefix ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (prefix.startsWith(letters)) result = Math.max(result, 0.9);

  return Math.max(0, Math.min(1, result));
}
