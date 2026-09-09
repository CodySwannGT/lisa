/**
 * The closure reason must survive the trip from GitHub into the classifier.
 *
 * The classifier being right is only half a repair. `lifecycle-label-trust.mjs`
 * is driven as a subprocess by `lisa-repair-intake`, which pipes a REST issue
 * payload into it and parses the verdict off stdout. A reason that entrypoint
 * drops leaves the abandoned direction correct and unreachable — which, at the
 * tracker, is indistinguishable from never having written it. So these cases
 * drive the shipped file the way the skill does rather than calling the
 * exported function directly.
 * @module tests/unit/strategies/lifecycle-closure-reason-wiring
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import { READY } from "./support/lifecycle-label-trust.js";

const SCRIPT = "plugins/src/base/scripts/lifecycle-label-trust.mjs";
const ABANDONED = "open-label-abandoned-state";
const CLOSED = "open-label-closed-state";

/**
 * Drive the shipped classifier the way the repair skill drives it.
 * @param issue - The REST issue payload to classify
 * @returns The parsed verdict
 */
function classify(issue: object): { drifts: { direction: string }[] } {
  const result = boundedSpawnSync({
    label: "lifecycle-label-trust.mjs closure reason",
    command: process.execPath,
    args: [path.resolve(SCRIPT)],
    input: JSON.stringify({ issue }),
  });
  return JSON.parse(result.stdout);
}

describe("the entrypoint carries the closure reason through (#3479)", () => {
  it("routes a REST not-planned closure to the retire-only direction", () => {
    // REST spells it `state_reason`, and the repair skill reads REST.
    expect(
      classify({
        labels: [{ name: READY }],
        state: "closed",
        state_reason: "not_planned",
      }).drifts
    ).toEqual([{ direction: ABANDONED, label: READY }]);
  });

  it("routes a REST completed closure to the terminal-advancing direction", () => {
    // The negative control: a wiring that sent every closure down the
    // retire-only path would satisfy the case above and repair nothing.
    expect(
      classify({
        labels: [{ name: READY }],
        state: "closed",
        state_reason: "completed",
      }).drifts
    ).toEqual([{ direction: CLOSED, label: READY }]);
  });

  it("accepts the CLI spelling of the same field", () => {
    // `gh issue view --json` says `stateReason`; a caller that used it must not
    // silently fall through to the writing direction.
    expect(
      classify({
        labels: [{ name: READY }],
        state: "closed",
        stateReason: "NOT_PLANNED",
      }).drifts
    ).toEqual([{ direction: ABANDONED, label: READY }]);
  });
});
