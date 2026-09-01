/**
 * The fleet census keeps "resolves nothing" apart from "resolves something
 * old", reports what it could not read, and never gates.
 *
 * The first suite below is the one the work item asks to prove by injection: if
 * the unguarded class is folded into the stale count, `countStale` and the
 * summary both go red here by name. A census reporting a single "N behind"
 * number would satisfy every other expectation in this file while losing the
 * finding that motivated it — the checkouts resolving no guard at all
 * (CodySwannGT/lisa#3490).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  countStale,
  isInstallBehindDeclared,
  readFleetRoster,
  resolveReference,
  runFleetCensus,
  summarizeFleetCensus,
} from "../../../src/core/enforcement-census.js";
import { renderFleetCensusReport } from "../../../src/core/enforcement-census-report.js";
import {
  ALL_GUARDS,
  buildFleet,
  type CheckoutSpec,
  type Fleet,
} from "../../helpers/enforcement-census-fixtures.js";

const REFERENCE = "4.24.2";

let fleet: Fleet | null = null;

afterEach(() => {
  fleet?.cleanup();
  fleet = null;
});

/**
 * Measure a fleet built from the given specs against a fixed reference.
 * @param specs - Checkouts to build
 * @param missing - Roster entries that name nothing on disk
 * @returns The measured fleet
 */
async function measure(
  specs: readonly CheckoutSpec[],
  missing: readonly string[] = []
) {
  fleet = buildFleet(specs, missing);
  const roster = await readFleetRoster(fleet.rosterPath);
  expect(roster).not.toBeNull();
  return runFleetCensus({
    roster: roster ?? [],
    rosterOrigin: "fixture",
    reference: REFERENCE,
    now: () => new Date("2026-08-31T00:00:00.000Z"),
  });
}

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

describe("the unguarded class is never folded into the stale count", () => {
  it("counts a fleet of checkouts that resolve nothing as unguarded, never as stale", async () => {
    const census = await measure([{ name: "a" }, { name: "b" }, { name: "c" }]);
    expect(census.summary.unguarded).toBe(3);
    expect(census.summary.behind).toBe(0);
    expect(census.summary.resolving).toBe(0);
    expect(countStale(census.checkouts)).toBe(0);
  });

  it("keeps the two findings apart in a mixed fleet", async () => {
    const census = await measure([
      STALE,
      { name: "unguarded-a" },
      { name: "unguarded-b" },
    ]);
    expect(census.summary.unguarded).toBe(2);
    expect(census.summary.behind).toBe(1);
    expect(census.summary.resolving).toBe(1);
  });

  it("gives a checkout that resolves nothing no vintage to be stale by", async () => {
    const census = await measure([UNGUARDED]);
    expect(census.checkouts[0]?.resolution).toBe("none");
    expect(census.checkouts[0]?.vintage).toBe("not-applicable");
    expect(census.checkouts[0]?.governing).toBeNull();
  });

  it("names the unguarded checkouts in their own report section", async () => {
    const census = await measure([STALE, UNGUARDED]);
    const report = renderFleetCensusReport(census);
    expect(report).toContain("NOT ENFORCING — 1 of 2 resolve no guard at all");
    expect(report).toContain("ENFORCING — 1 of 2");
  });
});

describe("a checkout resolving an old guard", () => {
  it("reports the governing copy and its vintage", async () => {
    const census = await measure([STALE]);
    const entry = census.checkouts[0];
    expect(entry?.resolution).toBe("full");
    expect(entry?.vintage).toBe("behind");
    expect(entry?.governing?.tree).toBe("host");
    expect(entry?.governing?.version).toBe("3.23.0");
    expect(renderFleetCensusReport(census)).toContain(
      "governed by scripts/lisa-hooks — lisa 3.23.0, behind 4.24.2"
    );
  });

  it("treats a copy with no manifest beside it as undateable, not current", async () => {
    const census = await measure([
      { name: "undateable", pluginGuards: ALL_GUARDS },
    ]);
    expect(census.checkouts[0]?.vintage).toBe("undateable");
    expect(census.summary.current).toBe(0);
    expect(census.summary.undateable).toBe(1);
  });

  it("lets the oldest resolved copy govern when two trees are in use", async () => {
    const census = await measure([
      {
        name: "mixed",
        hostGuards: ALL_GUARDS.slice(0, 3),
        pluginGuards: ALL_GUARDS,
        receiptVersion: REFERENCE,
        pluginVersion: "3.23.0",
      },
    ]);
    expect(census.checkouts[0]?.resolution).toBe("full");
    expect(census.checkouts[0]?.governing?.version).toBe("3.23.0");
    expect(census.checkouts[0]?.vintage).toBe("behind");
  });

  it("names the guards a partial checkout resolves nothing for", async () => {
    const census = await measure([
      {
        name: "partial",
        hostGuards: ALL_GUARDS.slice(0, 2),
        receiptVersion: REFERENCE,
      },
    ]);
    expect(census.summary.partial).toBe(1);
    expect(census.checkouts[0]?.unresolvedGuards).toHaveLength(4);
    expect(renderFleetCensusReport(census)).toContain("unresolved:");
  });
});

describe("a current checkout", () => {
  it("is reported as covered when it resolves a current copy with a receipt", async () => {
    const census = await measure([COVERED]);
    expect(census.summary.covered).toBe(1);
    expect(census.summary.current).toBe(1);
    expect(census.checkouts[0]?.receipt.present).toBe(true);
  });

  it("is not covered when the receipt is missing", async () => {
    const census = await measure([
      {
        name: "no-receipt",
        pluginGuards: ALL_GUARDS,
        pluginVersion: REFERENCE,
      },
    ]);
    expect(census.summary.current).toBe(1);
    expect(census.summary.covered).toBe(0);
    expect(census.summary.withoutReceipt).toBe(1);
  });
});

describe("unavailability is not coverage", () => {
  it("reports a checkout it could not read, and does not count it as covered", async () => {
    const census = await measure([COVERED], ["/nonexistent/checkout-x"]);
    expect(census.summary.unreadable).toBe(1);
    expect(census.summary.covered).toBe(1);
    expect(census.summary.unguarded).toBe(0);
    const missing = census.checkouts.find(
      entry => entry.resolution === "unreadable"
    );
    expect(missing?.unreadableReason).toBe("path does not exist");
    expect(renderFleetCensusReport(census)).toContain(
      "COULD NOT LOOK — 1 of 2"
    );
  });

  it("never lets an unreadable checkout look like an unguarded one", async () => {
    const census = await measure([], ["/nonexistent/checkout-y"]);
    expect(census.summary.unreadable).toBe(1);
    expect(census.summary.unguarded).toBe(0);
    expect(census.summary.resolving).toBe(0);
  });
});

describe("the classes partition the roster", () => {
  it("sums the four resolution classes to the roster size", async () => {
    const census = await measure(
      [
        STALE,
        UNGUARDED,
        COVERED,
        { name: "partial", hostGuards: ALL_GUARDS.slice(0, 1) },
      ],
      ["/nonexistent/checkout-z"]
    );
    const { summary } = census;
    expect(
      summary.unreadable + summary.unguarded + summary.partial + summary.full
    ).toBe(summary.total);
    expect(summary.behind + summary.undateable + summary.current).toBe(
      summary.resolving
    );
  });

  it("keeps the summary derived from the records rather than stored", async () => {
    const census = await measure([STALE, UNGUARDED, COVERED]);
    expect(summarizeFleetCensus(census.checkouts)).toEqual(census.summary);
  });
});

describe("installed versus declared", () => {
  it("reports a checkout whose installed Lisa is behind its own manifest", async () => {
    const census = await measure([
      {
        name: "drifted",
        hostGuards: ALL_GUARDS,
        receiptVersion: REFERENCE,
        declared: "^4.23.20",
        installed: "3.23.0",
      },
    ]);
    expect(census.summary.installBehindDeclared).toBe(1);
    expect(renderFleetCensusReport(census)).toContain(
      "INSTALLED BEHIND DECLARED — 1 of 1"
    );
  });

  it("claims no drift when the range cannot be read", async () => {
    const census = await measure([
      { name: "wildcard", declared: "*", installed: "3.23.0" },
    ]);
    expect(census.summary.installBehindDeclared).toBe(0);
    expect(isInstallBehindDeclared(census.checkouts[0]!)).toBe(false);
  });
});

describe("the reference version", () => {
  it("is a maximum over evidence found on the same disk", async () => {
    fleet = buildFleet([
      { name: "old", hostGuards: ALL_GUARDS, receiptVersion: "3.23.0" },
      { name: "new", hostGuards: ALL_GUARDS, receiptVersion: "4.30.0" },
    ]);
    const roster = await readFleetRoster(fleet.rosterPath);
    const census = await runFleetCensus({
      roster: roster ?? [],
      rosterOrigin: "fixture",
      seedVersion: "4.0.0",
      now: () => new Date("2026-08-31T00:00:00.000Z"),
    });
    expect(census.reference).toBe("4.30.0");
    expect(census.summary.behind).toBe(1);
    expect(census.summary.current).toBe(1);
  });

  it("claims no staleness when nothing on the disk dates anything", () => {
    expect(resolveReference([], null)).toEqual({
      version: null,
      source: "no Lisa version could be found on this disk",
    });
  });
});
