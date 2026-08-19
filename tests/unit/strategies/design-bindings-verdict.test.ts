/**
 * Bite tests for the verdict the headless design-bindings probe reaches.
 *
 * Three properties are pinned because each is what makes the committed-map
 * design safe rather than merely convenient:
 *
 * - **staleness is self-detecting** — an unknown id fails loudly instead of
 *   resolving to the wrong variable, which is the only reason a committed map
 *   can be trusted at all;
 * - **the two failure owners stay distinct** — unbound values are design's, a
 *   stale or ambiguous map is ours, and conflating them sends the wrong person
 *   the wrong work;
 * - **an absent design source is SKIPPED, not blocked** — the requirement that
 *   outranks every other one here, because most projects have no designs and a
 *   mandatory gate on an absent integration breaks all of them.
 *
 * The payload-reading half lives in `design-bindings-probe.test.ts`.
 * @module tests/unit/strategies/design-bindings-verdict
 */
import { describe, expect, it } from "vitest";

import {
  evaluateSubtree,
  judgeProbe,
  regimeFromVariableNames,
  resolveIds,
  skipReason,
  tokenNamer,
} from "../../../plugins/src/base/scripts/design-bindings-probe.mjs";

/** Ids and names reused across cases, hoisted so the literals live in one place. */
const SURFACE_ID = "VariableID:106:15";
const RADIUS_ID = "VariableID:106:16";
const ZERO_SPACE_ID = "VariableID:106:17";
const AMBIGUOUS_ID = "VariableID:106:20";
const UNKNOWN_ID = "VariableID:999:1";
const SURFACE_NAME = "surface/raised";
const RADIUS_NAME = "radius/card";
const CARD = "Raised card";
const BRAND = { r: 0.227, g: 0.482, b: 0.835 };

/** A committed map naming colour, radius, and one spacing variable. */
const ID_MAP = {
  byId: {
    [SURFACE_ID]: SURFACE_NAME,
    [RADIUS_ID]: RADIUS_NAME,
    [ZERO_SPACE_ID]: "space/0",
  },
  ambiguous: {},
};

describe("regimeFromVariableNames", () => {
  it("types an axis the map publishes variables for and leaves the rest untyped", () => {
    // The common real-world case: a mature colour system, no spacing scale.
    const regime = regimeFromVariableNames(["surface/raised", "radius/card"]);
    expect(regime.color).toBe("typed");
    expect(regime.radius).toBe("typed");
    expect(regime.spacing).toBe("untyped");
    expect(regime.motion).toBe("untyped");
  });

  it("honours project namespace overrides rather than Lisa's vocabulary", () => {
    const regime = regimeFromVariableNames(["ds.gap.md"], {
      spacing: ["ds.gap."],
    });
    expect(regime.spacing).toBe("typed");
  });
});

describe("resolveIds — staleness is self-detecting", () => {
  it("names an id the committed map knows", () => {
    const result = resolveIds([{ id: SURFACE_ID }], ID_MAP);
    expect(result.names).toEqual([SURFACE_NAME]);
    expect(result.unknownIds).toEqual([]);
  });

  it("reports an unknown id rather than resolving it to the wrong variable", () => {
    const result = resolveIds([{ id: UNKNOWN_ID }], ID_MAP);
    expect(result.unknownIds).toEqual([UNKNOWN_ID]);
    expect(result.names).toEqual([]);
  });

  it("reports an ambiguous id separately from an unknown one", () => {
    const result = resolveIds([{ id: AMBIGUOUS_ID }], {
      byId: {},
      ambiguous: { [AMBIGUOUS_ID]: ["content/on/accent", "surface/base"] },
    });
    expect(result.ambiguousIds).toEqual({
      [AMBIGUOUS_ID]: ["content/on/accent", "surface/base"],
    });
    expect(result.unknownIds).toEqual([]);
  });
});

describe("judgeProbe — owner attribution and the threshold", () => {
  const clean = {
    summary: { color: { total: 4, pct: 100 } },
    unknownIds: [],
    ambiguousIds: {},
    required: ["color"],
  };

  it("passes a fully bound axis", () => {
    expect(judgeProbe(clean)).toMatchObject({ verdict: "PASS", owner: null });
  });

  it("attributes an unbound value to design", () => {
    expect(
      judgeProbe({ ...clean, summary: { color: { total: 4, pct: 75 } } })
    ).toMatchObject({ verdict: "BLOCK", owner: "design", failing: ["color"] });
  });

  it("attributes a stale map to us, not to design", () => {
    // The values ARE bound. Sending this to a designer is the wrong person and
    // the wrong work.
    expect(judgeProbe({ ...clean, unknownIds: [UNKNOWN_ID] })).toMatchObject({
      verdict: "BLOCK",
      owner: "us",
    });
  });

  it("attributes an unnameable id to us and still refuses to pass", () => {
    expect(
      judgeProbe({ ...clean, ambiguousIds: { [AMBIGUOUS_ID]: ["a", "b"] } })
    ).toMatchObject({ verdict: "BLOCK", owner: "us" });
  });

  it("defaults the threshold to 100 — a single literal fails", () => {
    expect(
      judgeProbe({ ...clean, summary: { color: { total: 100, pct: 99 } } })
        .verdict
    ).toBe("BLOCK");
  });

  it("relaxes only on an explicit --min, never quietly", () => {
    expect(
      judgeProbe({
        ...clean,
        summary: { color: { total: 100, pct: 99 } },
        min: 95,
      }).verdict
    ).toBe("PASS");
  });

  it("says nothing about an axis with no values to judge", () => {
    expect(
      judgeProbe({ ...clean, summary: { color: { total: 0, pct: null } } })
    ).toMatchObject({ verdict: "PASS" });
  });
});

describe("skipReason — the design source is optional", () => {
  const env = { FIGMA_ACCESS_TOKEN: "tok" };

  it("skips a project with no design source configured", () => {
    // The single most important property here. Most projects have no designs,
    // and a mandatory gate on an absent integration breaks every one of them.
    const result = skipReason({}, env, ID_MAP);
    expect(result.skip).toBe(true);
    expect(result.reason).toMatch(/no design source is configured/u);
  });

  it("skips when the design source cannot be read from here", () => {
    const result = skipReason(
      { design: { tokens: { source: "file-key" } } },
      {},
      ID_MAP
    );
    expect(result.skip).toBe(true);
    expect(result.reason).toMatch(/FIGMA_ACCESS_TOKEN/u);
  });

  it("skips — and says how to fix it — when the committed map is absent", () => {
    const result = skipReason(
      { design: { tokens: { source: "file-key" } } },
      env,
      null
    );
    expect(result.skip).toBe(true);
    expect(result.reason).toMatch(/design-variable-ids\.mjs/u);
  });

  it("does not skip a fully configured project", () => {
    expect(
      skipReason({ design: { tokens: { source: "file-key" } } }, env, ID_MAP)
    ).toEqual({ skip: false });
  });
});

describe("tokenNamer", () => {
  it("is identity-ish by default rather than imposing a vocabulary", () => {
    expect(tokenNamer()("content/primary")).toBe("content-primary");
  });

  it("honours a configured override", () => {
    expect(tokenNamer({ "content/primary": "fg" })("content/primary")).toBe(
      "fg"
    );
  });
});

describe("evaluateSubtree", () => {
  it("produces a regime, findings, and a design-owned block from one subtree", () => {
    // Colour and radius are published here; spacing deliberately is not.
    const result = evaluateSubtree({
      component: CARD,
      idMap: {
        byId: { [SURFACE_ID]: SURFACE_NAME, [RADIUS_ID]: RADIUS_NAME },
        ambiguous: {},
      },
      document: {
        type: "FRAME",
        name: CARD,
        fills: [{ type: "SOLID", color: BRAND }],
        children: [
          {
            type: "FRAME",
            name: "Body",
            boundVariables: {
              rectangleCornerRadii: {
                RECTANGLE_TOP_LEFT_CORNER_RADIUS: { id: RADIUS_ID },
              },
            },
            rectangleCornerRadii: [12, 12, 12, 12],
            paddingTop: 24,
          },
        ],
      },
    });

    expect(result.verdict).toBe("BLOCK");
    expect(result.owner).toBe("design");
    // Colour is published, spacing is not — so the regime the gate receives
    // says block on the colour literal and measure the spacing one.
    expect(result.regime.color).toBe("typed");
    expect(result.regime.spacing).toBe("untyped");
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        kind: "hardcoded-in-design",
        axis: "color",
        value: "#3a7bd5",
      })
    );
    expect(result.bindList.length).toBeGreaterThan(0);
  });
});
