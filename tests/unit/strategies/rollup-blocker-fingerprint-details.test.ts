/**
 * Regression coverage for audit details in rollup deduplication fingerprints.
 * @module tests/unit/strategies/rollup-blocker-fingerprint-details
 */
import { describe, expect, it } from "vitest";

import {
  classifyRollupBlockers,
  describeRollupBlockerChange,
  rollupBlockerFingerprint,
} from "../../../plugins/src/base/scripts/rollup-blocker-classification.mjs";

const BLOCKED = "status:blocked";
const CONTAINER = { ref: "#1400", type: "Epic" };
const BLOCKER = {
  ref: "#1547",
  state: BLOCKED,
  blockedBy: [{ ref: "#1600", open: true }],
};

describe("rollup blocker fingerprint audit details", () => {
  it("changes when the same blocker moves to a different ancestor path", () => {
    const nested = classifyRollupBlockers({
      container: CONTAINER,
      children: [{ ref: "#1500", state: BLOCKED, children: [BLOCKER] }],
    });
    const direct = classifyRollupBlockers({
      container: CONTAINER,
      children: [BLOCKER],
    });

    expect(
      describeRollupBlockerChange(rollupBlockerFingerprint(nested), direct)
    ).toMatchObject({ changed: true });
  });

  it("changes when the same blocker records a different dependency signal", () => {
    const before = classifyRollupBlockers({
      container: CONTAINER,
      children: [BLOCKER],
    });
    const after = classifyRollupBlockers({
      container: CONTAINER,
      children: [{ ...BLOCKER, blockedBy: [{ ref: "#1601", open: true }] }],
    });

    expect(
      describeRollupBlockerChange(rollupBlockerFingerprint(before), after)
    ).toMatchObject({ changed: true });
  });
});
