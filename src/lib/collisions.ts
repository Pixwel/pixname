// When several files would get the same standard name, the words that differ between their
// original names ("Green Box" / "White Box ONLY", "NoGFX" / "WithGFX") are what tells them apart.
// Those become a suggested Extra token, the same way an editor would add one by hand.
import { vendorCode } from "./abbrev";
import { tokenize } from "./fuzzy";

/** Words that never distinguish variants: containers, codecs, and tags the name already carries. */
const SKIP = new Set([
  "mov", "mp4", "mxf", "prores", "proreshq", "pro", "res", "hq", "lt", "422", "4444", "h", "264", "265", "hevc",
  "txtd", "txtl", "txtls", "texted", "textless", "txted", "txtless", "the", "a", "an", "of", "and",
]);
const MAX_WORDS = 5;

interface Variant {
  /** Original file name. */
  name: string;
  /** Words already in the proposed name or its project/asset ("tug", "war", "patrol"). */
  known: string[];
}

interface Word {
  word: string;
  /** Which underscore section of the name it came from. */
  section: number;
}

/**
 * One Extra token per file ("GREEN-BOX-ONLY"), or undefined where nothing distinguishes it.
 * Words shared by every file are dropped, except where they sit right next to a distinguishing
 * word in the same section ("Green Box" keeps "box"); shared numbers are always dropped.
 */
export function distinguishingExtras(group: Variant[]): (string | undefined)[] {
  const wordsOf = (v: Variant): Word[] => {
    const code = vendorCode(v.name)?.toLowerCase();
    const known = new Set(v.known.flatMap(tokenize));
    const stem = v.name.replace(/\.[^.]+$/, "");
    return stem
      .split("_")
      .flatMap((part, section) => tokenize(part).map((word) => ({ word, section })))
      .filter(({ word }) => word !== code && !SKIP.has(word) && !known.has(word));
  };
  const words = group.map(wordsOf);
  const shared = words.reduce(
    (common, ws) => new Set(ws.map((w) => w.word).filter((w) => common.has(w))),
    new Set((words[0] ?? []).map((w) => w.word)),
  );

  return words.map((ws) => {
    const distinct = (w?: Word) => !!w && !shared.has(w.word);
    const kept = ws.filter((w, i) => {
      if (distinct(w)) return true;
      if (/^\d+$/.test(w.word) || w.word === "x") return false;
      const neighbours = [ws[i - 1], ws[i + 1]].filter((n) => n?.section === w.section);
      return neighbours.some(distinct);
    });
    const unique = kept.map((w) => w.word).filter((w, i, all) => all.indexOf(w) === i);
    return unique.length ? unique.slice(0, MAX_WORDS).join("-").toUpperCase() : undefined;
  });
}
