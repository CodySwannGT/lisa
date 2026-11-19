/**
 * Claim-time token estimates (CodySwannGT/lisa#4955): a claimed item must
 * carry an estimate before any work, and the estimate is calibrated against
 * how comparable finished items actually ran.
 * @module tests/unit/scripts/work-item-estimate-claim
 */
import { describe, expect, it } from "vitest";

import { resolveEstimateConfig } from "../../../all/copy-overwrite/scripts/lib/work-item-estimate-config.mjs";
import {
  calibrateEstimate,
  historyBodies,
  itemRatio,
} from "../../../all/copy-overwrite/scripts/lib/work-item-estimate-calibration.mjs";
import { checkEstimate } from "../../../all/copy-overwrite/scripts/lib/work-item-estimate-check.mjs";
import { upsertLisaUsageSection } from "../../../src/utils/usage-accounting.js";
import {
  ESTIMATE_ON,
  finishedItem,
  PLAIN_BODY,
  usageEntry,
} from "../../support/work-item-estimate-fixtures.js";

const OFF = resolveEstimateConfig({
  workItem: { estimate: { required: false } },
});
const CHILD_REF = "github:acme/code#43";
const doubled = (id: string): string =>
  finishedItem(1_000_000, 3_000_000, [usageEntry(id, 4_000_000)]);

describe("gate S21 at claim time", () => {
  it("fails a claimed item that has no estimate yet", () => {
    const result = checkEstimate(PLAIN_BODY, ESTIMATE_ON, "claim");
    expect(result.verdict).toBe("FAIL");
    expect(result.lines.join("\n")).toMatch(
      /Before any work, estimate it[\s\S]*Never ask a person/
    );
  });

  it("passes a claimed item that carries a well-formed estimate", () => {
    expect(
      checkEstimate(finishedItem(1000, 2000, []), ESTIMATE_ON, "claim").verdict
    ).toBe("PASS");
  });

  it("is N/A when the requirement is off", () => {
    expect(checkEstimate(PLAIN_BODY, OFF, "claim").verdict).toBe("N/A");
  });

  it("still lets an item without an estimate reach ready", () => {
    expect(checkEstimate(PLAIN_BODY, ESTIMATE_ON, "ready").verdict).toBe(
      "PASS"
    );
  });
});

describe("calibration", () => {
  it("scales a new range by the median actual-to-estimate ratio", () => {
    const result = calibrateEstimate(
      { tokensLow: 1_000_000, tokensHigh: 2_000_000 },
      [doubled("a"), doubled("b"), doubled("c")]
    );
    expect(result).toEqual({
      comparable: 3,
      ratio: 2,
      tokensLow: 2_000_000,
      tokensHigh: 4_000_000,
      basis:
        "calibrated x2 (median actual/estimate) from 3 comparable finished item(s)",
    });
  });

  it("uses the median, so one outlier does not swing the estimate", () => {
    const outlier = finishedItem(1_000_000, 3_000_000, [
      usageEntry("x", 40_000_000),
    ]);
    const exact = (id: string): string =>
      finishedItem(1_000_000, 3_000_000, [usageEntry(id, 2_000_000)]);
    expect(
      calibrateEstimate({ tokensLow: 10, tokensHigh: 20 }, [
        exact("a"),
        exact("b"),
        outlier,
      ]).ratio
    ).toBe(1);
  });

  it("reports no history honestly and leaves the range unchanged", () => {
    expect(
      calibrateEstimate({ tokensLow: 1_000_000, tokensHigh: 2_000_000 }, [])
    ).toMatchObject({
      comparable: 0,
      ratio: null,
      tokensLow: 1_000_000,
      tokensHigh: 2_000_000,
      basis: expect.stringMatching(/^no calibration history/),
    });
  });

  it("never counts unknown actuals as zero", () => {
    expect(itemRatio(finishedItem(1000, 3000, [usageEntry("u", null)]))).toBe(
      null
    );
    expect(itemRatio(finishedItem(1000, 3000, []))).toBe(null);
    expect(itemRatio(PLAIN_BODY)).toBe(null);
    // A partial sum is not an actual: one known run beside an unknown one.
    expect(
      itemRatio(
        finishedItem(1000, 3000, [usageEntry("k", 2000), usageEntry("u", null)])
      )
    ).toBe(null);
    expect(
      calibrateEstimate({ tokensLow: 5, tokensHigh: 6 }, [
        finishedItem(1000, 3000, [usageEntry("u", null)]),
      ]).comparable
    ).toBe(0);
  });

  it("skips an item whose actual is only the sum of its known runs", () => {
    // An observed 2M implement run beside a verify run with no telemetry is
    // not a 2M actual; counting it would shrink every later estimate.
    const partial = finishedItem(1_000_000, 3_000_000, [
      usageEntry("implement", 2_000_000),
      usageEntry("verify", null),
    ]);
    expect(itemRatio(partial)).toBe(null);
    expect(
      calibrateEstimate({ tokensLow: 10, tokensHigh: 20 }, [
        partial,
        doubled("a"),
      ])
    ).toMatchObject({ comparable: 1, ratio: 2 });
  });

  it("skips an item whose child work has a run with no token total", () => {
    const item = upsertLisaUsageSection(
      finishedItem(1_000_000, 3_000_000, []),
      {
        entries: [usageEntry("implement", 2_000_000)],
        childArtifacts: [
          {
            artifactRef: CHILD_REF,
            entries: [
              {
                ...usageEntry("child-known", 1_000_000),
                artifactRef: CHILD_REF,
              },
              {
                ...usageEntry("child-unavailable", null),
                artifactRef: CHILD_REF,
              },
            ],
          },
        ],
      }
    );
    expect(itemRatio(item)).toBe(null);
  });

  it("takes the mean of the middle two ratios for an even sample", () => {
    const ratioOf = (id: string, actual: number): string =>
      finishedItem(1_000_000, 3_000_000, [usageEntry(id, actual)]);
    expect(
      calibrateEstimate({ tokensLow: 10, tokensHigh: 20 }, [
        ratioOf("a", 2_000_000),
        ratioOf("b", 4_000_000),
        ratioOf("c", 8_000_000),
        ratioOf("d", 40_000_000),
      ]).ratio
    ).toBe(3);
  });

  it("refuses an inverted range at its own boundary", () => {
    expect(() =>
      calibrateEstimate({ tokensLow: 20, tokensHigh: 10 }, [doubled("a")])
    ).toThrow(/The low end \(20\) is above the high end \(10\)/);
  });

  it("reads bodies the way gh issue list --json body prints them", () => {
    expect(historyBodies([{ body: "a" }, "b", { title: "no body" }])).toEqual([
      "a",
      "b",
    ]);
    expect(() => historyBodies({ body: "a" })).toThrow(/JSON array/);
  });
});
