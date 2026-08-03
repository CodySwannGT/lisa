/**
 * Tests for the version-range comparison behind the security-floor audit.
 *
 * The network half is not tested here — it is a thin fetch wrapper, and pinning
 * live advisory content would make the suite fail whenever a real advisory
 * lands. What is worth pinning is the comparison, because a wrong answer here
 * is silent: an off-by-one boundary reports a vulnerable floor as clean, which
 * is the exact failure this script exists to prevent.
 * @module tests/unit/scripts/security-floors
 */
import { describe, expect, it } from "vitest";

import {
  lowestPermitted,
  withinRange,
} from "../../../scripts/check-security-floors.mjs";

describe("lowestPermitted", () => {
  it("reads the floor out of a >= range", () => {
    expect(lowestPermitted(">=5.0.7")).toEqual([5, 0, 7]);
  });

  it("reads the floor out of a caret range", () => {
    expect(lowestPermitted("^4.3.0")).toEqual([4, 3, 0]);
  });

  it("reads the floor out of a tilde range", () => {
    expect(lowestPermitted("~2.0.0")).toEqual([2, 0, 0]);
  });

  it("treats a bare version as its own floor", () => {
    expect(lowestPermitted("2.259.0")).toEqual([2, 259, 0]);
  });

  it("returns null for a spec carrying no version", () => {
    expect(lowestPermitted("workspace:*")).toBeNull();
  });
});

describe("withinRange", () => {
  /** The brace-expansion range that started all this. */
  const BRACE_RANGE = ">= 4.0.0, < 5.0.8";
  /** The aws-cdk-lib range, where lexical comparison gives a wrong answer. */
  const CDK_RANGE = ">= 2.0.0, < 2.260.0";

  // The real case: brace-expansion >=5.0.7 permits 5.0.7, which
  // GHSA-mh99-v99m-4gvg marks vulnerable up to (not including) 5.0.8.
  it("flags a floor that sits inside a two-sided range", () => {
    expect(withinRange([5, 0, 7], BRACE_RANGE)).toBe(true);
  });

  it("clears a floor at the patched boundary", () => {
    expect(withinRange([5, 0, 8], BRACE_RANGE)).toBe(false);
  });

  it("clears a floor below the vulnerable range", () => {
    expect(withinRange([3, 0, 0], BRACE_RANGE)).toBe(false);
  });

  it("handles an inclusive upper bound", () => {
    expect(withinRange([7, 5, 18], "<= 7.5.18")).toBe(true);
    expect(withinRange([7, 5, 19], "<= 7.5.18")).toBe(false);
  });

  it("handles a bare upper bound with no lower bound", () => {
    expect(withinRange([5, 30, 7], "< 5.30.8")).toBe(true);
  });

  it("handles an exact-version range", () => {
    expect(withinRange([4, 0, 0], "= 4.0.0")).toBe(true);
    expect(withinRange([4, 0, 1], "= 4.0.0")).toBe(false);
  });

  it("compares numerically rather than lexically", () => {
    // "2.259.0" < "2.26.0" as strings; the opposite is true as versions, and
    // getting this wrong would clear a genuinely vulnerable aws-cdk-lib pin.
    expect(withinRange([2, 259, 0], CDK_RANGE)).toBe(true);
    expect(withinRange([2, 26, 0], CDK_RANGE)).toBe(true);
    expect(withinRange([2, 260, 0], CDK_RANGE)).toBe(false);
  });

  it("treats an empty range as no constraint rather than a match", () => {
    expect(withinRange([1, 0, 0], "")).toBe(false);
  });
});
