/**
 * What an operator is told when a declared threshold loosens, and the one way
 * a deliberate loosening gets through (CodySwannGT/lisa#4985).
 *
 * The way through is the one Lisa's own threshold files already have: a
 * `thresholdRatchet.allow` entry in `.lisa.config.json`, with a reason and an
 * `until` day, honoured only once it is on the base side — so it was reviewed
 * and merged before the change it permits. A declared threshold gets that path
 * and no second one. Nothing written beside the parameter can wave its own
 * loosening through.
 *
 * Imported STATICALLY and by relative path for the reason
 * `threshold-ratchet.test.ts` documents.
 * @module tests/unit/scripts/threshold-ratchet-declared-exception
 */
import { describe, expect, it } from "vitest";

import {
  applyAllowList,
  compareFile,
  formatReport,
} from "../../../plugins/src/base/hooks/threshold-ratchet-compare.mjs";
import { extractAllowEntries } from "../../../plugins/src/base/hooks/threshold-ratchet-families.mjs";
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

/** The day the exception in these cases is live through. */
const UNTIL_DAY = "2026-06-15";
/** Inside that day, UTC. */
const WHILE_LIVE = Date.UTC(2026, 5, 15, 12, 0, 0);
/** The first instant of the next day, UTC. */
const AFTER_EXPIRY = Date.UTC(2026, 5, 16, 0, 0, 0);

const REASON = "Coverage tool being replaced; resolved when the new one lands.";

/** How every refusal says which exception entry would cover it. */
const exceptionFor = (key: string): string =>
  ` If a person decides this loosening is right, they record an exception under thresholdRatchet.allow with "file": "${LISA_CONFIG_FILE}" and "key": "${key}".`;

/**
 * An exception entry for the coverage floor of the `api` folder.
 * @param key - The entry's key
 * @returns The entry
 */
function entry(key: string = thresholdKey()) {
  return { file: LISA_CONFIG_FILE, key, reason: REASON, until: UNTIL_DAY };
}

/** The floor lowered from 60 to 55: one finding. */
function loweredFloor() {
  return compareFile(LISA_CONFIG_FILE, floorAt(60), floorAt(55));
}

describe("what the operator is told", () => {
  it("names the gate, the folder, the parameter, both values and what to do", () => {
    expect(loweredFloor()[0]?.message).toBe(
      `${LISA_CONFIG_FILE}: the floor "${COVERAGE_FLOOR}" of the ${COVERAGE_GATE} gate, for the folder "api", was lowered from 60 to 55. A floor may go up and never down: set it back to 60 or higher, and fix the code so it meets the floor.${exceptionFor(thresholdKey())}`
    );
  });

  it("says the same for a ceiling, the other way round", () => {
    const ceiling = (value: number): string =>
      configText({
        "code-style": gateOf(
          part(".", { "max-warnings": { value, direction: "ceiling" } })
        ),
      });

    expect(
      compareFile(LISA_CONFIG_FILE, ceiling(0), ceiling(3))[0]?.message
    ).toBe(
      `${LISA_CONFIG_FILE}: the ceiling "max-warnings" of the code-style gate, for the whole repository, was raised from 0 to 3. A ceiling may go down and never up: set it back to 0 or lower, and fix the code so it stays within the ceiling.${exceptionFor(thresholdKey("code-style", ".", "max-warnings"))}`
    );
  });

  it("calls a part that covers everything the whole repository", () => {
    const [finding] = compareFile(
      LISA_CONFIG_FILE,
      floorAt(60, "."),
      floorAt(55, ".")
    );

    expect(finding?.message).toContain(", for the whole repository, ");
    expect(finding?.message).not.toContain("the folder");
  });

  it("says what to do about each way a threshold can stop being held", () => {
    const told = (current: string | null): string =>
      compareFile(LISA_CONFIG_FILE, floorAt(60), current)[0]?.message ?? "";

    const named = `${LISA_CONFIG_FILE}: the floor "${COVERAGE_FLOOR}" of the ${COVERAGE_GATE} gate, for the folder "api", `;

    expect(
      told(configText({ [COVERAGE_GATE]: gateOf(part("api")) }))
    ).toContain(
      `${named}was removed (it was 60). Removing a floor loosens it all the way: put it back.`
    );
    expect(told(floorAt(60, "web"))).toContain(
      `${named}is gone (it was 60), because the gate no longer has a part for the folder "api". Removing a part, or renaming its folder, drops every threshold it held: put the part back under the same folder.`
    );
    expect(told(configText({}))).toContain(
      `${named}is gone (it was 60), because the ${COVERAGE_GATE} gate is no longer declared. Removing or renaming a gate drops every threshold it held: put the gate back under the same name.`
    );
    expect(told(null)).toContain(
      `${named}is gone (it was 60), because ${LISA_CONFIG_FILE} was deleted. Deleting the file drops every threshold declared in it: put the file back.`
    );
    expect(told(coverageConfig({ value: 60, direction: "ceiling" }))).toContain(
      "(it was 60, and is now 60). That turns the limit the other way round, so it cannot be shown to be as strict as it was: make it a floor again."
    );
    expect(told(coverageConfig({ value: 55 }))).toContain(
      '(it was 60, and is now 55). A value with no direction is held by nothing: put "direction": "floor" back.'
    );
    expect(told(coverageConfig({ value: "55", direction: "floor" }))).toContain(
      "Only a number can be held: set it back to a number, 60 or higher."
    );
    expect(told("{ not json")).toBe(
      `${LISA_CONFIG_FILE} is no longer valid JSON, so the 1 declared threshold in its gates block cannot be read and nothing holds it. Repair the file.`
    );
  });

  it("counts the thresholds a file that cannot be read any more was holding", () => {
    const two = configText({
      [COVERAGE_GATE]: gateOf(
        part("api", { [COVERAGE_FLOOR]: { value: 60, direction: "floor" } }),
        part("web", { [COVERAGE_FLOOR]: { value: 60, direction: "floor" } })
      ),
    });

    expect(compareFile(LISA_CONFIG_FILE, two, "{ not json")[0]?.message).toBe(
      `${LISA_CONFIG_FILE} is no longer valid JSON, so the 2 declared thresholds in its gates block cannot be read and nothing holds them. Repair the file.`
    );
  });

  it("records what the value became only where there is still a value", () => {
    const after = (current: string | null) =>
      compareFile(LISA_CONFIG_FILE, floorAt(60), current)[0];

    expect(after(floorAt(55))).toHaveProperty("current", 55);
    expect(
      after(coverageConfig({ value: "55", direction: "floor" }))
    ).toHaveProperty("current", '"55"');
    expect(after(coverageConfig({ direction: "floor" }))).toHaveProperty(
      "current",
      "nothing"
    );
    expect(after(floorAt(60, "web"))).not.toHaveProperty("current");
    expect(after(null)).not.toHaveProperty("current");
  });

  it("gives every refusal the exception entry that would cover it", () => {
    const refusals = [
      floorAt(55),
      floorAt(60, "web"),
      configText({}),
      null,
      coverageConfig({ value: 60, direction: "ceiling" }),
      coverageConfig({ value: 60 }),
      coverageConfig({ value: "60", direction: "floor" }),
    ].flatMap(current => compareFile(LISA_CONFIG_FILE, floorAt(60), current));

    expect(refusals).toHaveLength(7);
    for (const finding of refusals) {
      expect(finding.message.endsWith(exceptionFor(finding.key))).toBe(true);
    }
  });

  it("is printed under the ratchet's own heading, with the way to an exception", () => {
    const report = formatReport(loweredFloor());

    expect(report).toContain("blocked by the threshold ratchet");
    expect(report).toContain(`  • ${loweredFloor()[0]?.message}`);
    expect(report).toContain("thresholdRatchet.allow");
    expect(report).toContain("separate human-approved change");
  });
});

describe("a deliberate, reviewed loosening", () => {
  it("passes on an exception that is already on the base side and still live", () => {
    const { blocked, allowed, expired } = applyAllowList(
      loweredFloor(),
      [entry()],
      WHILE_LIVE
    );

    expect(blocked).toEqual([]);
    expect(expired).toEqual([]);
    expect(allowed).toHaveLength(1);
    expect(allowed[0]?.message).toContain(
      `allowed by thresholdRatchet.allow entry ${LISA_CONFIG_FILE} → ${thresholdKey()} (key-scoped)`
    );
  });

  it("covers a threshold that was removed, the same way", () => {
    const removed = compareFile(
      LISA_CONFIG_FILE,
      floorAt(60),
      floorAt(60, "services/api")
    );

    expect(applyAllowList(removed, [entry()], WHILE_LIVE).blocked).toEqual([]);
  });

  it("is refused again once the exception's day has passed", () => {
    const { blocked, allowed, expired } = applyAllowList(
      loweredFloor(),
      [entry()],
      AFTER_EXPIRY
    );

    expect(allowed).toEqual([]);
    expect(blocked).toHaveLength(1);
    expect(expired[0]?.message).toContain(`expired after ${UNTIL_DAY}`);
  });

  it("is not covered by an exception for another parameter, folder or gate", () => {
    const others = [
      thresholdKey(COVERAGE_GATE, "api", "minimum-branches"),
      thresholdKey(COVERAGE_GATE, "web"),
      thresholdKey("code-style"),
    ].map(key => entry(key));

    expect(
      applyAllowList(loweredFloor(), others, WHILE_LIVE).blocked
    ).toHaveLength(1);
  });

  it("is not covered by an exception written for a different file", () => {
    const elsewhere = { ...entry(), file: "vitest.thresholds.json" };

    expect(
      applyAllowList(loweredFloor(), [elsewhere], WHILE_LIVE).blocked
    ).toHaveLength(1);
  });
});

describe("a change that tries to approve itself", () => {
  const selfApproving = configText(
    {
      [COVERAGE_GATE]: gateOf(
        part("api", { [COVERAGE_FLOOR]: { value: 55, direction: "floor" } })
      ),
    },
    { thresholdRatchet: { allow: [entry()] } }
  );

  it("is refused for the lowered floor and for the exception it added", () => {
    const findings = compareFile(LISA_CONFIG_FILE, floorAt(60), selfApproving);

    expect(findings.map(finding => finding.type)).toEqual([
      "allow-added",
      "weakened",
    ]);
    const baseSide = extractAllowEntries(JSON.parse(floorAt(60)));
    expect(applyAllowList(findings, baseSide, WHILE_LIVE).blocked).toHaveLength(
      2
    );
  });

  it("is still refused for adding the exception if its own list were honoured", () => {
    const findings = compareFile(LISA_CONFIG_FILE, floorAt(60), selfApproving);
    const changeSide = extractAllowEntries(JSON.parse(selfApproving));

    expect(
      applyAllowList(findings, changeSide, WHILE_LIVE).blocked.map(
        finding => finding.type
      )
    ).toEqual(["allow-added"]);
  });

  it.each([
    ["a key on the parameter", { value: 55, direction: "floor", allow: true }],
    [
      "a project's own key on the parameter",
      { value: 55, direction: "floor", "x-reviewed": "yes" },
    ],
    [
      "a reason and a day on the parameter",
      { value: 55, direction: "floor", reason: REASON, until: "2999-01-01" },
    ],
  ])("cannot wave the loosening through with %s", (_case, parameter) => {
    const findings = compareFile(
      LISA_CONFIG_FILE,
      floorAt(60),
      coverageConfig(parameter)
    );

    expect(findings.map(finding => finding.type)).toEqual(["weakened"]);
    expect(applyAllowList(findings, [], WHILE_LIVE).blocked).toHaveLength(1);
  });
});
