/**
 * A declared threshold that disappears, or stops being one, has loosened
 * (CodySwannGT/lisa#4985).
 *
 * Lowering a floor to 55 is refused, so taking the floor away has to be
 * refused too: it is the same loosening carried all the way. The ways a
 * threshold can stop being held without its number going the wrong way are
 * each pinned here — the parameter, its part, its gate or the whole file is
 * removed; the part's folder or the gate is renamed; the direction is dropped
 * or turned round; the value stops being a number.
 *
 * A rename is refused on purpose. The ratchet names a threshold by its gate,
 * its part's folder and its parameter. It cannot tell a renamed folder from a
 * part that was removed while an unrelated one was added, and it cannot show
 * that a floor under a new name covers the code the old one covered.
 *
 * Imported STATICALLY and by relative path for the reason
 * `threshold-ratchet.test.ts` documents.
 * @module tests/unit/controls/threshold-ratchet-declared-removal
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

/** The floor as every case here starts with it. */
const FLOOR = { value: 60, direction: "floor" };
/** A file a hand edit left unreadable. */
const BROKEN = "{ not json";
/** What is said of a parameter that is no longer written down. */
const REMOVED = "was removed (it was 60)";

/**
 * Compare a file that declares the floor at 60 with a later version.
 * @param current - The file after the change, `null` when it was deleted
 * @returns What the ratchet reports
 */
function after(current: string | null) {
  return compareFile(LISA_CONFIG_FILE, floorAt(60), current);
}

describe("a declared threshold that is taken away", () => {
  it("fails when the parameter is removed, naming it", () => {
    const findings = after(
      configText({
        [COVERAGE_GATE]: gateOf(
          part("api", { unrelated: { value: 1, direction: "floor" } })
        ),
      })
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ key: thresholdKey(), base: 60 });
    expect(findings[0]?.type).toBe("removed");
    expect(findings[0]?.message).toContain(`"${COVERAGE_FLOOR}"`);
    expect(findings[0]?.message).toContain(REMOVED);
  });

  it("fails when the part keeps no parameters at all", () => {
    const findings = after(
      configText({ [COVERAGE_GATE]: gateOf(part("api")) })
    );

    expect(findings.map(finding => finding.type)).toEqual(["removed"]);
    expect(findings[0]?.message).toContain(REMOVED);
  });

  it("fails when the part is removed, naming the folder", () => {
    const findings = after(
      configText({ [COVERAGE_GATE]: gateOf(part("web", { other: FLOOR })) })
    );

    expect(findings.map(finding => finding.type)).toEqual(["removed"]);
    expect(findings[0]?.key).toBe(thresholdKey());
    expect(findings[0]?.message).toContain(
      'because the gate no longer has a part for the folder "api"'
    );
  });

  it("fails when the part's folder is renamed, although the floor moved with it", () => {
    const findings = after(floorAt(60, "services/api"));

    expect(findings.map(finding => finding.key)).toEqual([thresholdKey()]);
    expect(findings[0]?.message).toContain("renaming its folder");
  });

  it("fails when the gate stops declaring parts", () => {
    const findings = after(
      configText({ [COVERAGE_GATE]: { "pull-request": "required" } })
    );

    expect(findings.map(finding => finding.type)).toEqual(["removed"]);
    expect(findings[0]?.message).toContain("no longer has a part for");
  });

  it("fails when the gate is removed, naming the gate", () => {
    const findings = after(configText({}));

    expect(findings.map(finding => finding.type)).toEqual(["removed"]);
    expect(findings[0]?.message).toContain(
      `because the ${COVERAGE_GATE} gate is no longer declared`
    );
  });

  it("fails when the gate is renamed, although the floor moved with it", () => {
    const findings = after(
      configText({ "test-correctness": gateOf(part("api", { x: FLOOR })) })
    );

    expect(findings.map(finding => finding.key)).toEqual([thresholdKey()]);
    expect(findings[0]?.message).toContain("renaming a gate");
  });

  it("fails when the gates block is removed", () => {
    const findings = after('{ "tracker": "github" }');

    expect(findings.map(finding => finding.key)).toEqual([thresholdKey()]);
    expect(findings[0]?.message).toContain("is no longer declared");
  });

  it("fails when the file is deleted, naming every threshold it held", () => {
    const base = configText({
      [COVERAGE_GATE]: gateOf(
        part("api", { a: FLOOR }),
        part("web", { b: FLOOR })
      ),
    });

    const findings = compareFile(LISA_CONFIG_FILE, base, null);

    expect(findings.map(finding => finding.key)).toEqual([
      thresholdKey(COVERAGE_GATE, "api", "a"),
      thresholdKey(COVERAGE_GATE, "web", "b"),
    ]);
    expect(findings.every(finding => finding.type === "removed")).toBe(true);
    expect(findings[0]?.message).toContain(
      `because ${LISA_CONFIG_FILE} was deleted`
    );
  });

  it("fails once when the file stops being readable", () => {
    const findings = after(BROKEN);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ key: "*", type: "unparseable" });
    expect(findings[0]?.message).toContain("1 declared threshold ");
  });

  it("counts every threshold an unreadable file held", () => {
    const base = configText({
      [COVERAGE_GATE]: gateOf(part("api", { a: FLOOR, b: FLOOR })),
    });

    const [finding] = compareFile(LISA_CONFIG_FILE, base, BROKEN);

    expect(finding?.message).toContain("2 declared thresholds ");
  });
});

describe("a file with no declared threshold", () => {
  it("may still be deleted", () => {
    expect(compareFile(LISA_CONFIG_FILE, "{}", null)).toEqual([]);
  });

  it("may still stop being readable, as before", () => {
    expect(compareFile(LISA_CONFIG_FILE, "{}", BROKEN)).toEqual([]);
  });

  it("is not held for a parameter that had no direction", () => {
    expect(
      compareFile(LISA_CONFIG_FILE, coverageConfig({ value: 60 }), null)
    ).toEqual([]);
  });
});

describe("a declared threshold that stops being one", () => {
  it("fails when a floor becomes a ceiling at the same value", () => {
    const findings = after(coverageConfig({ value: 60, direction: "ceiling" }));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      key: thresholdKey(),
      type: "weakened",
      base: 60,
      current: 60,
    });
    expect(findings[0]?.message).toContain(
      "was changed from a floor to a ceiling"
    );
  });

  it("fails when a ceiling becomes a floor, even at a stricter-looking value", () => {
    const findings = compareFile(
      LISA_CONFIG_FILE,
      coverageConfig({ value: 10, direction: "ceiling" }),
      coverageConfig({ value: 5, direction: "floor" })
    );

    expect(findings.map(finding => finding.type)).toEqual(["weakened"]);
    expect(findings[0]?.message).toContain(
      "was changed from a ceiling to a floor"
    );
  });

  it("fails when the direction is dropped, even with the value raised", () => {
    const findings = after(coverageConfig({ value: 99 }));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: "weakened",
      base: 60,
      current: 99,
    });
    expect(findings[0]?.message).toContain("is no longer marked as a floor");
  });

  it("fails when the direction becomes one nobody defined", () => {
    const findings = after(
      coverageConfig({ value: 60, direction: "sideways" })
    );

    expect(findings[0]?.message).toContain("is no longer marked as a floor");
  });

  it("fails when the value becomes text", () => {
    const findings = after(coverageConfig({ value: "60", direction: "floor" }));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: "weakened", base: 60 });
    expect(findings[0]?.message).toContain(
      'is no longer a number (it was 60, and is now "60")'
    );
  });

  it("fails when the value becomes true or false", () => {
    const findings = after(coverageConfig({ value: true, direction: "floor" }));

    expect(findings[0]?.message).toContain("and is now true)");
  });

  it("fails when the value is left out", () => {
    const findings = after(coverageConfig({ direction: "floor" }));

    expect(findings[0]?.message).toContain("and is now nothing)");
  });
});

describe("a later version the ratchet can read but not make sense of", () => {
  it.each([
    ["the file holds a list", "[]"],
    ["the file holds nothing", "null"],
    ["gates is a list", '{ "gates": [] }'],
    ["gates is text", '{ "gates": "all" }'],
    ["the gate is text", `{ "gates": { "${COVERAGE_GATE}": "required" } }`],
    ["the gate is nothing", `{ "gates": { "${COVERAGE_GATE}": null } }`],
  ])("reports the gate as no longer declared when %s", (_case, current) => {
    const findings = after(current);

    expect(findings.map(finding => finding.key)).toEqual([thresholdKey()]);
    expect(findings[0]?.message).toContain("is no longer declared");
  });

  it.each([
    ["parts is an object", { parts: { api: {} } }],
    ["a part is text", { parts: ["api"] }],
    ["a part is nothing", { parts: [null] }],
    ["a part has no folder", { parts: [{ parameters: {} }] }],
  ])("reports the part as gone when %s", (_case, gate) => {
    const findings = after(configText({ [COVERAGE_GATE]: gate }));

    expect(findings.map(finding => finding.key)).toEqual([thresholdKey()]);
    expect(findings[0]?.message).toContain("no longer has a part for");
  });

  it.each([
    ["parameters is a list", []],
    ["parameters is text", "none"],
    ["the parameter is a bare number", { [COVERAGE_FLOOR]: 60 }],
    ["the parameter is nothing", { [COVERAGE_FLOOR]: null }],
    ["the parameter is a list", { [COVERAGE_FLOOR]: [60, "floor"] }],
  ])("reports the parameter as removed when %s", (_case, parameters) => {
    const findings = after(
      configText({
        [COVERAGE_GATE]: gateOf({ scope: "api", command: ["x"], parameters }),
      })
    );

    expect(findings.map(finding => finding.type)).toEqual(["removed"]);
    expect(findings[0]?.message).toContain(REMOVED);
  });
});
