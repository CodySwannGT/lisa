/**
 * Fixture suite executed by a child vitest to prove the margin guard is wired.
 *
 * Not named `*.test.ts` on purpose: this file must never be collected by the
 * repository's own run, because one of its two arms is designed to FAIL. The
 * parent case in `tests/unit/helpers/io-latency-budget.test.ts` points a
 * throwaway vitest config at it and asserts on the child's exit status and
 * diagnostic — the wiring is what a pure unit test of `marginFailure` cannot
 * reach, and unwired guards are the failure mode this whole family of issues
 * is about.
 *
 * The case spends `share x base x measured slowdown` milliseconds, so its
 * quiet-equivalent cost is `share x base` on EVERY machine. That is what makes
 * the arms deterministic: `share` above `MARGIN_FRACTION` must trip the guard
 * and stay under the budget, `share` well below it must pass, and neither
 * outcome depends on how fast the box happens to be.
 * @module tests/helpers/__fixtures__/margin-guard-case
 */
import { describe, expect, it } from "vitest";
import {
  useIoLatencyBudget,
  workerSpawnSlowdown,
} from "../io-latency-budget.js";

const BASE_MS = Number(process.env.LISA_MARGIN_GUARD_BASE_MS ?? "1200");
const SHARE = Number(process.env.LISA_MARGIN_GUARD_SHARE ?? "0.7");

useIoLatencyBudget(BASE_MS);

describe("margin guard fixture", () => {
  it("passes its own assertions while consuming a stated share of its budget", async () => {
    const sleepMs = BASE_MS * SHARE * workerSpawnSlowdown();
    await new Promise(resolve => {
      setTimeout(resolve, sleepMs);
    });
    expect(sleepMs).toBeGreaterThan(0);
  });
});
