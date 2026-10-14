import { describe, expect, it } from "vitest";
import { distinguishingExtras } from "../collisions";

const known = (proposed: string, ...names: string[]) => [proposed.replace(/\.[^.]+$/, ""), ...names];

describe("distinguishingExtras", () => {
  it("keeps the words that differ between variants", () => {
    const k = known("PAWPATROL3_TRL_TUGOFWAR_ENG_TXTL_PRORES_1080p2398.mov", "Tug of War", "PAW Patrol: The Dino Movie");
    const names = [
      "0080_Tug of War_Green Box.mov",
      "0080_Tug of War_Green Box ONLY.mov",
      "0080_Tug of War_No Box.mov",
      "0080_Tug of War_White Box.mov",
      "0080_Tug of War_White Box ONLY.mov",
    ];
    expect(distinguishingExtras(names.map((name) => ({ name, known: k })))).toEqual([
      "GREEN-BOX", "GREEN-BOX-ONLY", "NO-BOX", "WHITE-BOX", "WHITE-BOX-ONLY",
    ]);
  });

  it("splits camel case and ignores codec words", () => {
    const k = known("PAWPATROL3_SOC_AVAMAX_ENG_TXTL_PRORES_1080p2398.mov", "Ava Max Callout", "PAW Patrol");
    const extras = distinguishingExtras([
      { name: "FH_PawPatrol_AvaMaxCallout_9x16_TXTLS_NoGFX_ProRes422HQ_Splits_Narr_Dx_Mx_Fx.mov", known: k },
      { name: "FH_PawPatrol_AvaMaxCallout_9x16_TXTLS_WithGFX__ProRes422HQ.mov", known: k },
    ]);
    expect(extras).toEqual(["NO-GFX-SPLITS-NARR-DX", "WITH-GFX"]);
  });

  it("drops shared numbers and keeps words beside the difference", () => {
    const k = known("PAWPATROL3_SOC_PUPSADR_ENG_TXTD_PRORES_1080p2398.mov", "Pups ADR Session", "PAW Patrol 3");
    const extras = distinguishingExtras([
      { name: "PP3_Paw Patrol Pups ADR Session_9x16 INTL Texted ProResHQ 2398 Stereo Audio.mov", known: k },
      { name: "PP3_Paw Patrol Pups ADR Session_9x16 Textless ProResHQ 2398 Split Audio.mov", known: k },
    ]);
    expect(extras).toEqual(["INTL-STEREO-AUDIO", "SPLIT-AUDIO"]);
  });

  it("gives nothing when the names don't differ in a useful way", () => {
    const extras = distinguishingExtras([
      { name: "STF_Spot_ProRes.mov", known: [] },
      { name: "STF_Spot_ProResHQ.mov", known: [] },
    ]);
    expect(extras).toEqual([undefined, undefined]);
  });
});
