/**
 * A threshold a repository declares for one of its parts may tighten and never
 * loosen (CodySwannGT/lisa#4985).
 *
 * The ratchet already held Lisa's own threshold files. A repository on any
 * stack declares its thresholds somewhere else: as `parameters` on a part of a
 * gate, in the `gates` block of `.lisa.config.json`, each written
 * `{ value, direction }`. This suite pins which way each direction may move,
 * and what is left alone: a parameter with no direction, and anything new.
 *
 * What happens when a declared threshold disappears is in
 * `threshold-ratchet-declared-removal.test.ts`; the reviewed exception is in
 * `threshold-ratchet-declared-exception.test.ts`.
 *
 * Imported STATICALLY and by relative path for the reason
 * `threshold-ratchet.test.ts` documents: a runtime-assembled URL is invisible
 * to Vite's module graph and drops the ratchet's mutants out of the gate.
 * @module tests/unit/controls/threshold-ratchet-declared-parameters
 */
import { describe, expect, it } from "vitest";

import { compareFile } from "../../../plugins/src/base/hooks/threshold-ratchet-compare.mjs";
import {
  COVERAGE_FLOOR,
  COVERAGE_GATE,
  LISA_CONFIG_FILE,
  configText,
  coverageConfig,
  floorAt,
  gateOf,
  part,
  thresholdKey,
} from "../../helpers/declared-thresholds.js";

/** A ceiling on one part of the lint gate. */
const LINT_GATE = "code-style";
const LINT_CEILING = "max-warnings";

/**
 * A file that declares the lint ceiling for the `web` folder.
 * @param value - The ceiling
 * @returns The file content
 */
function ceilingAt(value: number): string {
  return configText({
    [LINT_GATE]: gateOf(
      part("web", { [LINT_CEILING]: { value, direction: "ceiling" } })
    ),
  });
}

/**
 * Compare two versions of `.lisa.config.json`.
 * @param base - The file before the change
 * @param current - The file after it
 * @returns What the ratchet reports
 */
function compare(base: string | null, current: string | null) {
  return compareFile(LISA_CONFIG_FILE, base, current);
}

describe("a declared floor", () => {
  it("may not be lowered", () => {
    const findings = compare(floorAt(60), floorAt(55));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: LISA_CONFIG_FILE,
      key: thresholdKey(),
      type: "weakened",
      base: 60,
      current: 55,
    });
  });

  it("may be raised", () => {
    expect(compare(floorAt(60), floorAt(65))).toEqual([]);
  });

  it("may stay where it is", () => {
    expect(compare(floorAt(60), floorAt(60))).toEqual([]);
  });

  it("may not be lowered by a fraction", () => {
    expect(compare(floorAt(60), floorAt(59.9))).toHaveLength(1);
  });

  it("is held at zero and below it", () => {
    expect(compare(floorAt(0), floorAt(-1))).toHaveLength(1);
    expect(compare(floorAt(-1), floorAt(0))).toEqual([]);
  });
});

describe("a declared ceiling", () => {
  it("may not be raised", () => {
    const findings = compare(ceilingAt(0), ceilingAt(3));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: LISA_CONFIG_FILE,
      key: thresholdKey(LINT_GATE, "web", LINT_CEILING),
      type: "weakened",
      base: 0,
      current: 3,
    });
  });

  it("may be lowered", () => {
    expect(compare(ceilingAt(5), ceilingAt(2))).toEqual([]);
  });

  it("may stay where it is", () => {
    expect(compare(ceilingAt(5), ceilingAt(5))).toEqual([]);
  });
});

describe("a parameter with no direction", () => {
  it("is not compared when its number goes down", () => {
    expect(
      compare(coverageConfig({ value: 60 }), coverageConfig({ value: 5 }))
    ).toEqual([]);
  });

  it("is not compared when its number goes up", () => {
    expect(
      compare(coverageConfig({ value: 5 }), coverageConfig({ value: 60 }))
    ).toEqual([]);
  });

  it("is not compared when it is removed", () => {
    expect(
      compare(
        coverageConfig({ value: "strict" }),
        configText({ [COVERAGE_GATE]: gateOf(part("api")) })
      )
    ).toEqual([]);
  });

  it("is not compared when its value changes kind", () => {
    expect(
      compare(coverageConfig({ value: 60 }), coverageConfig({ value: "60" }))
    ).toEqual([]);
  });

  it("may be given a direction, at any value", () => {
    expect(compare(coverageConfig({ value: 60 }), floorAt(10))).toEqual([]);
  });
});

describe("a direction on a value that is not a number", () => {
  it("was never a threshold, so there is nothing to compare", () => {
    // The declaration's own validation refuses this pair. The ratchet does not
    // repeat that check; it only declines to order two things that have none.
    expect(
      compare(
        coverageConfig({ value: "high", direction: "floor" }),
        coverageConfig({ value: "low", direction: "floor" })
      )
    ).toEqual([]);
  });

  it("is not a threshold under a direction nobody defined either", () => {
    expect(
      compare(
        coverageConfig({ value: 60, direction: "sideways" }),
        coverageConfig({ value: 5, direction: "sideways" })
      )
    ).toEqual([]);
  });
});

describe("something new", () => {
  it("a new parameter on a part is allowed", () => {
    const current = configText({
      [COVERAGE_GATE]: gateOf(
        part("api", {
          [COVERAGE_FLOOR]: { value: 60, direction: "floor" },
          "minimum-branches": { value: 1, direction: "floor" },
        })
      ),
    });

    expect(compare(floorAt(60), current)).toEqual([]);
  });

  it("a new part is allowed", () => {
    const current = configText({
      [COVERAGE_GATE]: gateOf(
        part("api", { [COVERAGE_FLOOR]: { value: 60, direction: "floor" } }),
        part("web", { [COVERAGE_FLOOR]: { value: 1, direction: "floor" } })
      ),
    });

    expect(compare(floorAt(60), current)).toEqual([]);
  });

  it("a new gate is allowed", () => {
    const current = configText({
      [COVERAGE_GATE]: gateOf(
        part("api", { [COVERAGE_FLOOR]: { value: 60, direction: "floor" } })
      ),
      [LINT_GATE]: gateOf(
        part("api", { [LINT_CEILING]: { value: 900, direction: "ceiling" } })
      ),
    });

    expect(compare(floorAt(60), current)).toEqual([]);
  });
});

describe("the first time a repository declares thresholds", () => {
  it("passes when the file is new", () => {
    expect(compare(null, floorAt(1))).toEqual([]);
  });

  it("passes when the file had no gates block", () => {
    expect(compare('{ "tracker": "github" }', floorAt(1))).toEqual([]);
  });

  it("passes when the gate had no parts", () => {
    const base = configText({
      [COVERAGE_GATE]: { "pull-request": "required" },
    });

    expect(compare(base, floorAt(1))).toEqual([]);
  });

  it("passes when the part had no parameters", () => {
    const base = configText({ [COVERAGE_GATE]: gateOf(part("api")) });

    expect(compare(base, floorAt(1))).toEqual([]);
  });

  it("passes when the file could not be read before", () => {
    // Nothing readable was declared, so nothing can be shown to have loosened;
    // and the change that repairs the file has to be able to land.
    expect(compare("{ not json", floorAt(1))).toEqual([]);
  });
});

describe("several declared thresholds", () => {
  const twoParts = (api: number, web: number): string =>
    configText({
      [COVERAGE_GATE]: gateOf(
        part("api", { [COVERAGE_FLOOR]: { value: api, direction: "floor" } }),
        part("web", { [COVERAGE_FLOOR]: { value: web, direction: "floor" } })
      ),
    });

  it("reports only the one that loosened", () => {
    const findings = compare(twoParts(60, 80), twoParts(65, 70));

    expect(findings.map(finding => finding.key)).toEqual([
      thresholdKey(COVERAGE_GATE, "web"),
    ]);
  });

  it("reports each one that loosened, in the order they are declared", () => {
    const findings = compare(twoParts(60, 80), twoParts(50, 70));

    expect(findings.map(finding => finding.key)).toEqual([
      thresholdKey(COVERAGE_GATE, "api"),
      thresholdKey(COVERAGE_GATE, "web"),
    ]);
  });

  it("does not let a higher floor in one folder pay for a lower one in another", () => {
    expect(compare(twoParts(60, 80), twoParts(90, 79))).toHaveLength(1);
  });

  it("holds the same parameter name separately in two gates", () => {
    const both = (coverage: number, mutation: number): string =>
      configText({
        [COVERAGE_GATE]: gateOf(
          part(".", { minimum: { value: coverage, direction: "floor" } })
        ),
        "test-meaningfulness": gateOf(
          part(".", { minimum: { value: mutation, direction: "floor" } })
        ),
      });

    const findings = compare(both(60, 40), both(60, 30));

    expect(findings.map(finding => finding.key)).toEqual([
      thresholdKey("test-meaningfulness", ".", "minimum"),
    ]);
  });
});
