/**
 * Tests for the interactive variable-id map generator.
 *
 * The map is what makes the headless probe possible, and a map that resolves
 * confidently and *wrongly* is worse than no map — the probe would then name
 * the wrong variable with no symptom. So the assertions here are mostly about
 * refusing to resolve:
 *
 * - a tie is reported ambiguous, never settled by taking the first candidate;
 * - a candidate that disagrees in either mode is eliminated outright, not
 *   merely down-ranked;
 * - single-occupancy evidence that contradicts itself across nodes abandons
 *   the attempt rather than voting on it.
 *
 * The light+dark signature is pinned because it is the signal that separates
 * variables sharing a value in one mode, which is the common collision.
 * @module tests/unit/strategies/design-variable-ids
 */
import { describe, expect, it } from "vitest";

import {
  buildIdMap,
  classifyCandidates,
  disambiguateBySingleOccupancy,
  scoreCandidates,
} from "../../../plugins/src/base/scripts/design-variable-ids.mjs";

/** Names and ids reused across cases, hoisted so the literals live in one place. */
const SURFACE_BASE = "surface/base";
const ON_ACCENT = "content/on-accent";
const SPACE_3 = "space/3";
const WHITE = "#ffffff";
const DARK = "#101014";
const ID_1 = "VariableID:1:1";
const ID_2 = "VariableID:1:2";

describe("scoreCandidates", () => {
  it("eliminates a candidate that disagrees in the dark mode", () => {
    // Both are #ffffff in light. Only the dark value tells them apart, and a
    // scorer that merely down-ranked the loser would still resolve on a tie.
    const ranked = scoreCandidates({
      slots: new Map([["fills:box", { light: WHITE, dark: DARK }]]),
      names: [SURFACE_BASE, ON_ACCENT],
      valuesLight: { [SURFACE_BASE]: WHITE, [ON_ACCENT]: WHITE },
      valuesDark: { [SURFACE_BASE]: DARK, [ON_ACCENT]: WHITE },
    });

    expect(ranked.map(entry => entry[0])).toEqual([SURFACE_BASE]);
  });

  it("ranks a both-modes match above a light-only one", () => {
    const ranked = scoreCandidates({
      slots: new Map([["fills:box", { light: WHITE, dark: DARK }]]),
      names: [SURFACE_BASE, "surface/alt"],
      valuesLight: { [SURFACE_BASE]: WHITE, "surface/alt": WHITE },
      valuesDark: { [SURFACE_BASE]: DARK },
    });

    expect(ranked[0]).toEqual([SURFACE_BASE, 10]);
    expect(ranked[1][1]).toBeLessThan(10);
  });

  it("narrows candidates by property kind before comparing values", () => {
    // A padding can only bind a spacing variable, so a radius variable of the
    // same numeric value is never a candidate at all.
    const ranked = scoreCandidates({
      slots: new Map([["paddingLeft", { light: "12" }]]),
      names: [SPACE_3, "radius/card"],
      valuesLight: { [SPACE_3]: "12", "radius/card": "12" },
      valuesDark: {},
    });

    expect(ranked.map(entry => entry[0])).toEqual([SPACE_3]);
  });
});

describe("classifyCandidates", () => {
  it("resolves a clear winner", () => {
    expect(
      classifyCandidates([
        [SPACE_3, 10],
        ["space/4", 1],
      ])
    ).toEqual({
      kind: "resolved",
      name: SPACE_3,
    });
  });

  it("reports a tie as ambiguous rather than taking the first", () => {
    expect(
      classifyCandidates([
        [SURFACE_BASE, 1],
        [ON_ACCENT, 1],
      ])
    ).toEqual({
      kind: "ambiguous",
      names: [SURFACE_BASE, ON_ACCENT],
    });
  });

  it("reports no candidates as unresolved", () => {
    expect(classifyCandidates([])).toEqual({ kind: "unresolved" });
  });
});

describe("disambiguateBySingleOccupancy", () => {
  const ambiguous = {
    [ID_1]: [SURFACE_BASE, ON_ACCENT],
    [ID_2]: [SURFACE_BASE, ON_ACCENT],
  };

  it("forces a pairing when exactly one tied id meets exactly one tied name", () => {
    const { resolved, evidence } = disambiguateBySingleOccupancy(
      ambiguous,
      new Map([["10:1", new Set([ID_1])]]),
      new Map([["10:1", new Set([SURFACE_BASE])]])
    );

    expect(resolved[ID_1]).toBe(SURFACE_BASE);
    expect(evidence[ID_1]).toEqual(["10:1"]);
  });

  it("abandons the attempt when nodes disagree, rather than voting", () => {
    // A majority among contradictory evidence is still a guess.
    const { resolved } = disambiguateBySingleOccupancy(
      ambiguous,
      new Map([
        ["10:1", new Set([ID_1])],
        ["10:2", new Set([ID_1])],
        ["10:3", new Set([ID_1])],
      ]),
      new Map([
        ["10:1", new Set([SURFACE_BASE])],
        ["10:2", new Set([SURFACE_BASE])],
        ["10:3", new Set([ON_ACCENT])],
      ])
    );

    expect(resolved).toEqual({});
  });

  it("forces nothing when both tied ids appear together", () => {
    const { resolved } = disambiguateBySingleOccupancy(
      ambiguous,
      new Map([["10:1", new Set([ID_1, ID_2])]]),
      new Map([["10:1", new Set([SURFACE_BASE, ON_ACCENT])]])
    );

    expect(resolved).toEqual({});
  });
});

describe("buildIdMap", () => {
  it("produces a map, keeping genuine ties out of it", () => {
    const map = buildIdMap({
      observed: new Map([
        [ID_1, new Map([["paddingLeft", { light: "12" }]])],
        [ID_2, new Map([["fills:box", { light: WHITE }]])],
        ["VariableID:1:3", new Map([["cornerRadius", { light: "99" }]])],
      ]),
      valuesLight: {
        [SPACE_3]: "12",
        [SURFACE_BASE]: WHITE,
        [ON_ACCENT]: WHITE,
      },
      valuesDark: {},
    });

    expect(map.byId[ID_1]).toBe(SPACE_3);
    // Two variables share #ffffff in the only mode observed, and no
    // single-occupancy evidence exists — so this stays ambiguous, and the probe
    // will fail loudly on it rather than name the wrong one.
    expect(map.ambiguous[ID_2]).toHaveLength(2);
    // No radius variable is published at that value at all.
    expect(map.unresolved).toContain("VariableID:1:3");
  });
});
