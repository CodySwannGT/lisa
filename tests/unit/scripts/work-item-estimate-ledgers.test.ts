/**
 * How the done tally counts runs across an item's usage ledgers
 * (CodySwannGT/lisa#4956): each run once by its identity, child work by its
 * ledger aggregate, and an unknown total only when a run behind it is unknown
 * or the ledgers' child work cannot be told apart.
 * @module tests/unit/scripts/work-item-estimate-ledgers
 */
import { describe, expect, it } from "vitest";

import { itemRatio } from "../../../all/copy-overwrite/scripts/lib/work-item-estimate-calibration.mjs";
import {
  ledgerActual,
  tallyEstimate,
} from "../../../all/copy-overwrite/scripts/lib/work-item-estimate-tally.mjs";
import {
  type LisaUsageEntry,
  upsertLisaUsageSection,
} from "../../../src/utils/usage-accounting.js";
import {
  finishedItem,
  usageEntry,
} from "../../support/work-item-estimate-fixtures.js";

const CHILD_REF = "github:acme/code#43";

/**
 * A usage entry recorded on the child item.
 * @param id - Stable entry id.
 * @param totalTokens - Token total, or null when unknown.
 * @param cost - Cost in dollars, or null when unpriced.
 * @returns The child's entry.
 */
const childRun = (
  id: string,
  totalTokens: number | null,
  cost: number | null
): LisaUsageEntry => ({
  ...usageEntry(id, totalTokens, cost),
  artifactRef: CHILD_REF,
  // A run can be measured but unpriced: keep the tokens' own source.
  source: totalTokens === null ? "unavailable" : "observed",
});

/**
 * A body ledger with one direct run plus the given child runs.
 * @param children - The child item's runs.
 * @returns Item body.
 */
const withChildren = (children: readonly LisaUsageEntry[]): string =>
  upsertLisaUsageSection(finishedItem(1000, 2000, []), {
    entries: [usageEntry("implement", 4_000, 3)],
    childArtifacts: [{ artifactRef: CHILD_REF, entries: children }],
  });

const comment = (entries: readonly LisaUsageEntry[]): string =>
  upsertLisaUsageSection("", { entries });

describe("runs across ledgers", () => {
  it("counts a comment that repeats the body's runs plus its own Verify run", () => {
    const body = finishedItem(1000, 2000, [usageEntry("implement", 4_000, 3)]);
    const evidence = comment([
      usageEntry("implement", 4_000, 3),
      usageEntry("verify", 1_000, 1),
    ]);
    expect(ledgerActual([body, evidence])).toMatchObject({
      tokens: 5_000,
      cost: 4,
      entries: 2,
    });
  });

  it("keeps the total unknown when two ledgers share only some child runs", () => {
    const body = withChildren([
      childRun("child-a", 100, 1),
      childRun("child-b", 100, 1),
    ]);
    const other = upsertLisaUsageSection("", {
      entries: [usageEntry("verify", 1_000, 1)],
      childArtifacts: [
        {
          artifactRef: CHILD_REF,
          entries: [childRun("child-b", 100, 1), childRun("child-c", 100, 1)],
        },
      ],
    });
    expect(ledgerActual([body, other])).toMatchObject({
      tokens: null,
      cost: null,
    });
  });

  it("counts child work once when a comment repeats all of it", () => {
    const body = withChildren([childRun("child-a", 100, 1)]);
    const copy = body.slice(body.indexOf("## Lisa Usage"));
    expect(ledgerActual([body, copy])).toEqual(ledgerActual([body]));
    expect(ledgerActual([body])).toMatchObject({ tokens: 4_100, cost: 4 });
  });
});

describe("child runs", () => {
  it("keeps the tokens unknown when a child run has no token total", () => {
    const actual = ledgerActual([
      withChildren([
        childRun("child-a", 100, 1),
        childRun("child-b", null, null),
      ]),
    ]);
    expect(actual).toMatchObject({ tokens: null, cost: null });
  });

  it("keeps the cost unknown when one child run is priced and another is not", () => {
    const actual = ledgerActual([
      withChildren([
        childRun("child-a", 100, 1),
        childRun("child-b", 100, null),
      ]),
    ]);
    expect(actual).toMatchObject({ tokens: 4_200, cost: null });
  });

  it("adds fully known child runs to the direct runs", () => {
    expect(
      ledgerActual([
        withChildren([
          childRun("child-a", 100, 0.5),
          childRun("child-b", 200, 0.25),
        ]),
      ])
    ).toMatchObject({ tokens: 4_300, cost: 3.75, currency: "USD" });
  });
});

describe("calibration reads the recorded tally", () => {
  it("counts the comment's Verify run the tally recorded", () => {
    // Estimate midpoint 1500; Implement 1500 in the body, Verify 1500 in a
    // comment. The body ledger alone would say 1x; the tally says 2x.
    const body = finishedItem(1000, 2000, [usageEntry("implement", 1_500, 1)]);
    const evidence = comment([usageEntry("verify", 1_500, 1)]);
    const tallied = tallyEstimate(body, [body, evidence]);
    expect(itemRatio(tallied)).toBe(2);
    expect(itemRatio(body)).toBe(1);
  });

  it("skips an item whose recorded tally is unknown", () => {
    const body = finishedItem(1000, 2000, [usageEntry("implement", 1_500, 1)]);
    const evidence = comment([usageEntry("verify", null)]);
    expect(itemRatio(tallyEstimate(body, [body, evidence]))).toBe(null);
  });
});
