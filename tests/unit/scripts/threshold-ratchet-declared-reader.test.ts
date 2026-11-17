/**
 * How the threshold check reads a repository's declared thresholds out of
 * `.lisa.config.json` (CodySwannGT/lisa#4985).
 *
 * The check reads the `gates` block and does not validate it: what a valid
 * block is belongs to `validateGates`. So this suite pins two things. What
 * counts as a threshold — a number with a direction, by the same test the
 * validator uses — and what the reader does with a file a hand edit left in a
 * shape the validator would refuse: it finds no threshold there, and it never
 * throws, because a comparison that throws compares nothing.
 *
 * Imported STATICALLY and by relative path for the reason
 * `threshold-ratchet.test.ts` documents.
 * @module tests/unit/scripts/threshold-ratchet-declared-reader
 */
import { describe, expect, it } from "vitest";

import { PARAMETER_DIRECTIONS } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { compareFile } from "../../../plugins/src/base/hooks/threshold-ratchet-compare.mjs";
import {
  DECLARED_DIRECTIONS,
  declaredThresholdKey,
  extractDeclaredThresholds,
  findDeclaredParameter,
  isDeclaredDirection,
} from "../../../plugins/src/base/hooks/threshold-ratchet-families.mjs";
import {
  COVERAGE_FLOOR,
  COVERAGE_GATE,
  LISA_CONFIG_FILE,
  configText,
  floorAt,
  gateOf,
  part,
  thresholdKey,
} from "../../helpers/declared-thresholds.js";

const FLOOR = { value: 60, direction: "floor" };
const LINT_GATE = "code-style";

/**
 * Read the thresholds out of a file's text.
 * @param text - The file content
 * @returns The thresholds the check holds
 */
function read(text: string) {
  return extractDeclaredThresholds(JSON.parse(text));
}

describe("the thresholds the check reads", () => {
  it("names each one by its gate, its folder and its parameter", () => {
    expect(read(floorAt(60))).toEqual([
      {
        key: `gates.${COVERAGE_GATE}.parts[api].parameters.${COVERAGE_FLOOR}`,
        gate: COVERAGE_GATE,
        scope: "api",
        name: COVERAGE_FLOOR,
        value: 60,
        direction: "floor",
      },
    ]);
    expect(declaredThresholdKey(LINT_GATE, ".", "max-warnings")).toBe(
      "gates.code-style.parts[.].parameters.max-warnings"
    );
  });

  it("lists them in the order the file declares them", () => {
    const text = configText({
      runner: "npm run",
      [LINT_GATE]: gateOf(
        part("web", { b: { value: 0, direction: "ceiling" }, a: FLOOR })
      ),
      [COVERAGE_GATE]: gateOf(
        part("web", { c: FLOOR }),
        part("api", { d: FLOOR })
      ),
    });

    expect(read(text).map(threshold => threshold.key)).toEqual([
      thresholdKey(LINT_GATE, "web", "b"),
      thresholdKey(LINT_GATE, "web", "a"),
      thresholdKey(COVERAGE_GATE, "web", "c"),
      thresholdKey(COVERAGE_GATE, "api", "d"),
    ]);
  });

  it("leaves out a parameter with no direction, and one that is not a number", () => {
    const text = configText({
      [COVERAGE_GATE]: gateOf(
        part("api", {
          setting: { value: 3 },
          worded: { value: "high", direction: "floor" },
          flag: { value: true, direction: "ceiling" },
          sideways: { value: 3, direction: "sideways" },
          bare: 60,
        })
      ),
    });

    expect(read(text)).toEqual([]);
  });

  it("leaves out a number too large to be one, as the declaration's own check does", () => {
    const tooLarge = floorAt(60).replace("60", "1e999");

    expect(read(tooLarge)).toEqual([]);
    expect(compareFile(LISA_CONFIG_FILE, tooLarge, floorAt(5))).toEqual([]);
  });

  it("refuses a floor that is changed to a number too large to be one", () => {
    const tooLarge = floorAt(60).replace("60", "1e999");

    const [finding] = compareFile(LISA_CONFIG_FILE, floorAt(60), tooLarge);

    expect(finding?.type).toBe("weakened");
    expect(finding?.message).toContain(
      "is no longer a number (it was 60, and is now Infinity)"
    );
  });

  it("holds the two directions the declaration allows, and no others", () => {
    expect([...DECLARED_DIRECTIONS]).toEqual([...PARAMETER_DIRECTIONS]);
    expect(PARAMETER_DIRECTIONS.map(isDeclaredDirection)).toEqual([true, true]);
    expect([undefined, null, "", "Floor", 1].map(isDeclaredDirection)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("a file the declaration's own check would refuse", () => {
  it.each([
    ["nothing", "null"],
    ["a list", "[]"],
    ["text", '"gates"'],
    ["a gates block that is a list", '{ "gates": [] }'],
    ["a gates block that is text", '{ "gates": "all" }'],
    ["a gates block that is nothing", '{ "gates": null }'],
    ["a gate that is a level", `{ "gates": { "${COVERAGE_GATE}": "off" } }`],
    [
      "parts that are text",
      `{ "gates": { "${COVERAGE_GATE}": { "parts": "api" } } }`,
    ],
    [
      "a part that is a list",
      `{ "gates": { "${COVERAGE_GATE}": { "parts": [[]] } } }`,
    ],
    [
      "a part that names no folder but carries a floor",
      `{ "gates": { "${COVERAGE_GATE}": { "parts": [{ "parameters": { "minimum": { "value": 60, "direction": "floor" } } }] } } }`,
    ],
  ])("holds no threshold, and does not throw, when it is %s", (_case, text) => {
    expect(read(text)).toEqual([]);
    expect(compareFile(LISA_CONFIG_FILE, text, floorAt(1))).toEqual([]);
    expect(compareFile(LISA_CONFIG_FILE, text, null)).toEqual([]);
  });

  it("reads the first of two parts that name one folder, on both sides", () => {
    const twice = (first: number, second: number): string =>
      configText({
        [COVERAGE_GATE]: gateOf(
          part("api", {
            [COVERAGE_FLOOR]: { value: first, direction: "floor" },
          }),
          part("api", {
            [COVERAGE_FLOOR]: { value: second, direction: "floor" },
          })
        ),
      });

    expect(read(twice(60, 10)).map(threshold => threshold.value)).toEqual([60]);
    expect(compareFile(LISA_CONFIG_FILE, twice(60, 10), null)).toHaveLength(1);
    expect(compareFile(LISA_CONFIG_FILE, twice(60, 10), twice(60, 1))).toEqual(
      []
    );
    expect(
      compareFile(LISA_CONFIG_FILE, twice(60, 10), twice(55, 99))
    ).toHaveLength(1);
  });
});

describe("a name that every object already answers to", () => {
  // `__proto__` is a key JSON can carry and every object inherits. Only what
  // the file itself wrote is a gate or a parameter.
  const INHERITED = "__proto__";

  it("is a parameter only where the file wrote it", () => {
    const base = `{ "gates": { "${COVERAGE_GATE}": { "parts": [{ "scope": "api", "parameters": { "${INHERITED}": { "value": 60, "direction": "floor" } } }] } } }`;
    const current = configText({
      [COVERAGE_GATE]: gateOf(part("api", { other: FLOOR })),
    });

    expect(read(base).map(threshold => threshold.name)).toEqual([INHERITED]);
    expect(
      findDeclaredParameter(
        JSON.parse(current),
        COVERAGE_GATE,
        "api",
        INHERITED
      )
    ).toEqual({ missing: "parameter" });
    expect(compareFile(LISA_CONFIG_FILE, base, current)[0]?.type).toBe(
      "removed"
    );
  });

  it("is a gate only where the file wrote it", () => {
    const base = `{ "gates": { "${INHERITED}": { "parts": [{ "scope": "api", "parameters": { "minimum": { "value": 60, "direction": "floor" } } }] } } }`;

    expect(read(base).map(threshold => threshold.gate)).toEqual([INHERITED]);
    expect(
      findDeclaredParameter({ gates: {} }, INHERITED, "api", "minimum")
    ).toEqual({ missing: "gate" });
  });
});

describe("looking one parameter up", () => {
  const config = JSON.parse(floorAt(60));

  it("returns its value and direction as written", () => {
    expect(
      findDeclaredParameter(config, COVERAGE_GATE, "api", COVERAGE_FLOOR)
    ).toEqual({ missing: null, value: 60, direction: "floor" });
  });

  it("says which level is missing, outermost first", () => {
    expect(findDeclaredParameter(config, LINT_GATE, "api", "x")).toEqual({
      missing: "gate",
    });
    expect(findDeclaredParameter(config, COVERAGE_GATE, "web", "x")).toEqual({
      missing: "part",
    });
    expect(findDeclaredParameter(config, COVERAGE_GATE, "api", "x")).toEqual({
      missing: "parameter",
    });
  });
});
