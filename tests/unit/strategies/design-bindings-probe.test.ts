/**
 * Bite tests for how the headless design-bindings probe READS a design payload.
 *
 * Both suites here guard measured API traps, and both fail the same way — by
 * **silently under-reporting**, which is worse than an error because the run
 * goes green:
 *
 * 1. `rectangleCornerRadii` binds as an object keyed by corner constants, not
 *    an array and not itself a ref. A reader that handles only the scalar and
 *    array shapes reports **zero bound radii on a fully bound file**.
 * 2. Figma omits zero-valued properties from the REST payload. Boundness read
 *    from the resolved value rather than from `boundVariables` loses every
 *    value bound to a zero variable — reading it correctly moved one measured
 *    frame from 55% to 82%.
 *
 * The verdict half — regime, id resolution, owner attribution, the optional
 * design source, and the threshold — lives in `design-bindings-verdict.test.ts`.
 * @module tests/unit/strategies/design-bindings-probe
 */
import { describe, expect, it } from "vitest";

import {
  collectValues,
  refsOf,
} from "../../../plugins/src/base/scripts/design-bindings-probe.mjs";

/** Ids and values reused across cases, hoisted so the literals live in one place. */
const SURFACE_ID = "VariableID:106:15";
const RADIUS_ID = "VariableID:106:16";
const ZERO_SPACE_ID = "VariableID:106:17";
const CARD = "Raised card";
const BRAND = { r: 0.227, g: 0.482, b: 0.835 };

describe("refsOf — the three boundVariables shapes", () => {
  it("reads a scalar reference", () => {
    expect(
      refsOf({ type: "VARIABLE_ALIAS", id: "VariableID:1:1" })
    ).toHaveLength(1);
  });

  it("reads an array of references", () => {
    expect(
      refsOf([
        { type: "VARIABLE_ALIAS", id: "VariableID:1:1" },
        { type: "VARIABLE_ALIAS", id: "VariableID:1:2" },
      ])
    ).toHaveLength(2);
  });

  it("reads the corner-keyed object shape that is neither scalar nor array", () => {
    // The trap. A reader handling only the first two shapes returns [] here and
    // reports zero bound radii on a file whose radii are fully bound.
    expect(
      refsOf({
        RECTANGLE_TOP_LEFT_CORNER_RADIUS: {
          type: "VARIABLE_ALIAS",
          id: RADIUS_ID,
        },
        RECTANGLE_TOP_RIGHT_CORNER_RADIUS: {
          type: "VARIABLE_ALIAS",
          id: RADIUS_ID,
        },
      })
    ).toHaveLength(2);
  });

  it("returns nothing for a non-reference", () => {
    expect(refsOf(null)).toEqual([]);
    expect(refsOf(12)).toEqual([]);
    expect(refsOf({})).toEqual([]);
  });
});

describe("collectValues", () => {
  it("counts corner-keyed radius bindings as bound", () => {
    const { bound } = collectValues({
      type: "FRAME",
      name: CARD,
      boundVariables: {
        rectangleCornerRadii: {
          RECTANGLE_TOP_LEFT_CORNER_RADIUS: { id: RADIUS_ID },
          RECTANGLE_TOP_RIGHT_CORNER_RADIUS: { id: RADIUS_ID },
        },
      },
      rectangleCornerRadii: [12, 12, 12, 12],
    });

    expect(bound.filter(entry => entry.axis === "radius")).toHaveLength(2);
  });

  it("counts a value bound to a zero variable, which the payload omits entirely", () => {
    // `paddingLeft` is bound to `space/0`, so Figma omits the resolved property.
    // Inferring boundness from the resolved value loses this binding silently.
    const { bound, literal } = collectValues({
      type: "FRAME",
      name: CARD,
      boundVariables: { paddingLeft: { id: ZERO_SPACE_ID } },
    });

    expect(bound).toHaveLength(1);
    expect(bound[0]).toMatchObject({
      axis: "spacing",
      property: "paddingLeft",
    });
    expect(literal).toHaveLength(0);
  });

  it("records a literal paint that carries no binding", () => {
    const { bound, literal } = collectValues({
      type: "FRAME",
      name: CARD,
      fills: [{ type: "SOLID", color: BRAND }],
    });

    expect(bound).toHaveLength(0);
    expect(literal).toHaveLength(1);
    expect(literal[0]).toMatchObject({ axis: "color", value: "#3a7bd5" });
  });

  it("records a bound paint as bound and never as a literal", () => {
    const { bound, literal } = collectValues({
      type: "FRAME",
      name: CARD,
      boundVariables: { fills: [{ id: SURFACE_ID }] },
      fills: [{ type: "SOLID", color: BRAND }],
    });

    expect(bound).toHaveLength(1);
    expect(literal).toHaveLength(0);
  });

  it("walks the whole subtree, not just the root", () => {
    const { literal } = collectValues({
      type: "FRAME",
      name: CARD,
      children: [
        { type: "TEXT", name: "Title", paddingTop: 24 },
        {
          type: "FRAME",
          name: "Body",
          children: [{ type: "RECTANGLE", cornerRadius: 12 }],
        },
      ],
    });

    expect(
      literal.map(entry => entry.value).sort((a, b) => a.localeCompare(b))
    ).toEqual(["12px", "24px"]);
  });

  it("ignores a zero literal, which is the absence of a value rather than a decision", () => {
    const { literal } = collectValues({
      type: "FRAME",
      name: CARD,
      paddingTop: 0,
    });
    expect(literal).toHaveLength(0);
  });
});
