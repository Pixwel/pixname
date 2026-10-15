import { describe, expect, it } from "vitest";
import { FALLBACK_CATALOG as catalog } from "../api";
import { expectedAsset, isExpected, parseExpectedNames, slugOf, withExpected } from "../expected";
import { rankAssets } from "../fuzzy";
import { propose } from "../propose";
import type { Asset, Project, QueueItem } from "../types";

const sf: Project = { _id: "sf", name: "Street Fighter", slug: "street-fighter", filePrefix: "STREETFIGHTER" };

// As pasted from the delivery doc.
const PASTED = `World Premiere - B-Roll
World Premiere - Callina Liang
World Premiere - Cody Rhodes
World Premiere - Curtis "50 Cent" Jackson
World Premiere - David Dastmalchian
World Premiere - Eric André
World Premiere - Jason Momoa
World Premiere - Joe Anoa'i
World Premiere - Kitao Sakurai
World Premiere - Mel Jarnson
World Premiere - Noah Centineo
World Premiere - Olivier Richters
World Premiere - Orville Peck
World Premiere - Ranya Vallandingham
World Premiere - Vidyut Jammwal
Capcom Nakayama Reel Cutdown
Capcom Nakayama Reel Cutdown Vertical
Capcom Nakayama Reel Cutdown TikTok Vertical
Capcom Nakayama Reel
Capcom Nakayama Reel Vertical
Capcom Nakayama Reel TikTok Vertical
`;

const hd1080 = {
  streams: [
    { codec_type: "video", codec_name: "prores", width: 1920, height: 1080, sample_aspect_ratio: "1:1", avg_frame_rate: "24000/1001", r_frame_rate: "24000/1001", field_order: "progressive" },
  ],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "95" },
};

const item = (name: string, overrides: QueueItem["overrides"] = {}): QueueItem => ({
  id: name,
  file: { path: `/x/${name}`, name, dir: "/x", size: 1, relDirs: [] },
  ext: "mov",
  mediaType: "video",
  probe: { ffprobe: hd1080, errors: [] },
  probing: false,
  overrides,
  selected: true,
});

describe("expected assets", () => {
  const names = parseExpectedNames(PASTED);
  const expected = names.map((n) => expectedAsset("sf", n, "special-events"));

  it("reads one name per line, like the platform would slug them", () => {
    expect(names).toHaveLength(21);
    expect(slugOf('World Premiere - Curtis "50 Cent" Jackson')).toBe("world-premiere-curtis-50-cent-jackson");
    expect(slugOf("World Premiere - Eric André")).toBe("world-premiere-eric-andre");
    expect(slugOf("World Premiere - Joe Anoa'i")).toBe("world-premiere-joe-anoai");
    expect(isExpected(expected[0]._id)).toBe(true);
  });

  it("takes the first cell of spreadsheet rows and drops bullets and repeats", () => {
    expect(parseExpectedNames('Tug of War\tSocial\t30\n- Tug of War\n2. Etiquette\n\n"Curtis ""50 Cent"" Jackson"\t\n')).toEqual([
      "Tug of War",
      "Etiquette",
      'Curtis "50 Cent" Jackson',
    ]);
  });

  it("gives way to a real asset with the same name", () => {
    const real: Asset = { _id: "r1", name: "World Premiere - B-Roll", slug: "world-premiere-b-roll", type: "special-events", project: "sf" };
    const merged = withExpected([real], expected);
    expect(merged).toHaveLength(21);
    expect(merged.find((a) => a.slug === "world-premiere-b-roll")?._id).toBe("r1");
  });

  it("matches the vendor's names to the list", () => {
    const top = (name: string) => rankAssets({ name, dirs: [] }, expected, catalog.types, catalog, sf)[0];
    const best = top("StreetFighterPremiere_CallinaLiang_prores.mov");
    expect(best.item.name).toBe("World Premiere - Callina Liang");
    expect(top("StreetFighterPremiere_Curtis50CentJackson_prores.mov").item.name).toBe('World Premiere - Curtis "50 Cent" Jackson');
    expect(top("StreetFighterPremiere_EricAndre_prores.mov").item.name).toBe("World Premiere - Eric André");
    expect(top("StreetFighterPremiere_BRoll_prores.mov").item.name).toBe("World Premiere - B-Roll");
    expect(top("SF_CapcomNakayamaReel_Cutdown_9x16_prores.mov").item.name).toBe("Capcom Nakayama Reel Cutdown Vertical");
    expect(top("SF_CapcomNakayamaReel_TikTok_9x16.mov").item.name).toBe("Capcom Nakayama Reel TikTok Vertical");
    expect(top("SF_CapcomNakayamaReel_16x9.mov").item.name).toBe("Capcom Nakayama Reel");
  });

  it("names files the way the team asked", () => {
    const asset = expected.find((a) => a.name === "World Premiere - Callina Liang")!;
    const p = propose(item("StreetFighterPremiere_CallinaLiang_prores.mov", { language: "ENG", country: "AC" }), {
      catalog, projects: [sf], project: sf, asset,
    });
    expect(p.name).toBe("STREETFIGHTER_SPECIAL-EVENTS_WORLD-PREMIERE-CALLINA-LIANG_ENG-AC_TXTD_PRORES_1080p2398.mov");
  });
});
