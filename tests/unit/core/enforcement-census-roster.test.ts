/**
 * The roster the census measures, and the redaction that makes its findings
 * safe to quote.
 *
 * A hand-maintained roster can go stale exactly the way the frozen comment did:
 * a checkout nobody added is a checkout nobody measures, and an unmeasured
 * checkout is not a covered one. Discovery and deduplication are what keep the
 * denominator honest. Redaction is what lets the numerator be discussed in
 * public without naming a real checkout (CodySwannGT/lisa#3490).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  dedupeRoster,
  readFleetRoster,
  redactedLabel,
  runFleetCensus,
  scanForCheckouts,
} from "../../../src/core/enforcement-census.js";
import {
  redactCensus,
  renderFleetCensusReport,
} from "../../../src/core/enforcement-census-report.js";
import {
  ALL_GUARDS,
  buildFleet,
  type CheckoutSpec,
  type Fleet,
} from "../../helpers/enforcement-census-fixtures.js";

const REFERENCE = "4.24.2";
/** One path, named once, so the label test asserts stability rather than text. */
const SAMPLE_PATH = "/some/path";

let fleet: Fleet | null = null;

afterEach(() => {
  fleet?.cleanup();
  fleet = null;
});

/** A checkout with every guard, dated behind the reference. */
const STALE: CheckoutSpec = {
  name: "stale",
  hostGuards: ALL_GUARDS,
  receiptVersion: "3.23.0",
};

/** A checkout with no enforcement at all. */
const UNGUARDED: CheckoutSpec = { name: "unguarded" };

/** A checkout with every guard, current, receipted. */
const COVERED: CheckoutSpec = {
  name: "covered",
  hostGuards: ALL_GUARDS,
  receiptVersion: REFERENCE,
};

/**
 * Measure a fleet built from the given specs against a fixed reference.
 * @param specs - Checkouts to build
 * @returns The measured fleet
 */
async function measure(specs: readonly CheckoutSpec[]) {
  fleet = buildFleet(specs);
  const roster = await readFleetRoster(fleet.rosterPath);
  return runFleetCensus({
    roster: roster ?? [],
    rosterOrigin: "fixture",
    reference: REFERENCE,
    now: () => new Date("2026-08-31T00:00:00.000Z"),
  });
}

describe("the roster", () => {
  it("reads the path-to-branch object the fleet already maintains", async () => {
    fleet = buildFleet([UNGUARDED]);
    const roster = await readFleetRoster(fleet.rosterPath);
    expect(roster).toHaveLength(1);
    expect(roster?.[0]?.source).toBe("roster");
  });

  it("returns null for a roster it cannot read", async () => {
    expect(await readFleetRoster("/nonexistent/roster.json")).toBeNull();
  });

  it("discovers checkouts without a roster", async () => {
    fleet = buildFleet([UNGUARDED, COVERED]);
    const { mkdirSync } = await import("node:fs");
    for (const name of ["unguarded", "covered"]) {
      mkdirSync(`${fleet.checkoutPath(name)}/.git`, { recursive: true });
    }
    const found = await scanForCheckouts(fleet.root, 2);
    expect(found).toHaveLength(2);
    expect(found.every(entry => entry.source === "scan")).toBe(true);
  });

  it("counts a checkout named twice only once", async () => {
    fleet = buildFleet([UNGUARDED]);
    const target = fleet.checkoutPath("unguarded");
    const deduped = await dedupeRoster([
      { label: "a", checkoutPath: target, source: "roster" },
      { label: "b", checkoutPath: target, source: "scan" },
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.label).toBe("a");
  });
});

describe("redaction", () => {
  it("removes every real path while keeping the counts", async () => {
    const census = await measure([STALE, UNGUARDED]);
    const redacted = redactCensus(census);
    const report = renderFleetCensusReport(redacted);
    expect(report).not.toContain(census.checkouts[0]!.checkoutPath);
    expect(report).toContain("checkout-");
    expect(redacted.summary).toEqual(census.summary);
  });

  it("labels the same checkout the same way between runs", () => {
    expect(redactedLabel(SAMPLE_PATH)).toBe(redactedLabel(SAMPLE_PATH));
    expect(redactedLabel(SAMPLE_PATH)).not.toBe(redactedLabel("/other/path"));
  });
});

describe("the report", () => {
  it("says plainly that it gates nothing", async () => {
    const census = await measure([STALE]);
    expect(renderFleetCensusReport(census)).toContain(
      "This census reports and never gates"
    );
  });

  it("says that an unlisted checkout was not measured rather than covered", async () => {
    const census = await measure([COVERED]);
    expect(renderFleetCensusReport(census)).toContain(
      "A checkout not on the roster was not measured, which is not the same as covered."
    );
  });
});
