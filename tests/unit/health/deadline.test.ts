import { performance as monotonicClock } from "node:perf_hooks";

import { describe, expect, it, vi } from "vitest";

import { HealthDeadline } from "../../../src/health/deadline.js";
import { startCpuStopwatch } from "../../helpers/cpu-budget.js";

/** Deadline the cancellation-cost case waits out, in real milliseconds. */
const CANCEL_DEADLINE_MS = 500;
/**
 * CPU a correct cancellation may spend while waiting out {@link CANCEL_DEADLINE_MS}.
 *
 * Both sides of this number were measured, and both carry their conditions.
 *
 * | arm | condition | CPU |
 * |---|---|---|
 * | event-driven (correct) | quiet box, load 4.6 | **0.46ms** |
 * | event-driven (correct) | inside a full 643-file suite, load 64 | **1.49ms** |
 * | polling (regression) | isolated | **114ms** |
 * | polling (regression) | 5 runs at load 54–63, 154 vitest processes | **92–140ms** |
 *
 * 20ms is ~13x above the worst honest cost ever observed and ~4.6x below the
 * weakest regression. Note the correct arm barely moves with load — an idle
 * wait burns nothing whoever else is running — which is what makes a tight
 * bound safe here.
 *
 * It is deliberately not looser. A 250ms first draft of the sibling budget in
 * `agentic.test.ts` let a real 114ms regression through and returned a clean
 * zero, so "leave generous headroom" is not free: on a CPU budget the headroom
 * is exactly the size of the regression that escapes.
 *
 * Wall clock cannot express this bound at all. A polling cancellation and an
 * event-driven one finish at the *same* wall time — ~500ms either way, and the
 * measurements above confirm it — so the elapsed-time guard this repo used
 * before CodySwannGT/lisa#2516 was structurally blind to it, as was
 * CodySwannGT/lisa#2521's replacement. Only CPU separates waiting from spinning.
 */
const CANCELLATION_CPU_GUARD_MS = 20;
/** Real milliseconds burned to prove the unfaked clock still ages a deadline. */
const REAL_CLOCK_LEAK_MS = 20;

describe("HealthDeadline cancellation cost", () => {
  /**
   * This case is starvation-proof by construction, which is why it lives here
   * rather than in `agentic.test.ts`.
   *
   * `runHealth` reaches its evaluator only after real filesystem collection, so
   * a short deadline there races that setup: under load the budget expired
   * first and the evaluator was never invoked at all (CodySwannGT/lisa#2516,
   * reproduced 8 of 8 at load 54 with 144 vitest processes). The integration
   * case solves that with a virtual clock — but a virtual clock cannot see CPU
   * burned per unit of *real* waiting, because it no longer really waits.
   *
   * Here there is nothing to race. `run` is handed a collaborator that never
   * settles, on a deadline that starts at the same instant, so contention can
   * only stretch the wall time — which is asserted as a floor, never a ceiling
   * — while the CPU figure stays true. The two cases are complementary: one
   * pins *when* cancellation fires, this one pins what it *costs*.
   */
  it("waits out a hanging collaborator without spending CPU on it", async () => {
    const deadline = new HealthDeadline(CANCEL_DEADLINE_MS);
    const stopwatch = startCpuStopwatch();
    try {
      const result = await deadline.run(
        async () => new Promise<string>(() => {}),
        "cancelled"
      );
      const elapsed = stopwatch.elapsed();

      expect(result).toBe("cancelled");
      expect(elapsed.wallMs).toBeGreaterThanOrEqual(CANCEL_DEADLINE_MS - 1);
      expect(elapsed.cpuMs).toBeLessThan(CANCELLATION_CPU_GUARD_MS);
    } finally {
      deadline.close();
    }
  });

  /**
   * Faking vitest's timers does NOT stop this deadline from ageing, and a fix
   * that assumes otherwise leaves the original defect in place.
   *
   * `HealthDeadline` reads two clocks. `setTimeout` drives expiry and vitest
   * fakes it; `remainingMs()` reads `node:perf_hooks` `performance.now()`,
   * which vitest does **not** fake, because that export is a different object
   * from `globalThis.performance`. Measured directly: after
   * `advanceTimersByTimeAsync(500)`, `globalThis.performance.now()` moved 500ms
   * and the `node:perf_hooks` clock moved 0.29ms.
   *
   * The consequence is the sharp end. `run()` short-circuits on
   * `remainingMs() === 0` *before* starting work, so real elapsed time — which
   * is exactly what worker starvation inflates — still expires the budget and
   * still skips the collaborator, fake timers or not. In `runHealth` that means
   * the evaluator is never invoked, which is the failure this suite's abort case
   * actually hit (CodySwannGT/lisa#2516, reproduced 8 of 8 at load 54).
   *
   * This case pins that behaviour so the hazard is stated rather than
   * rediscovered: the production deadline is *supposed* to track real time, so
   * a test that needs a virtual deadline must redirect this clock too, not just
   * call `useFakeTimers()`.
   */
  it("keeps expiring on the real clock when only vitest timers are faked", async () => {
    vi.useFakeTimers();
    try {
      const deadline = new HealthDeadline(REAL_CLOCK_LEAK_MS);
      const expiresAt = monotonicClock.now() + REAL_CLOCK_LEAK_MS * 2;
      while (monotonicClock.now() < expiresAt) {
        // Burn real time. Virtual time is frozen; this deadline ages anyway.
      }
      let started = false;
      const result = await deadline.run(async () => {
        started = true;
        return "work";
      }, "cancelled");
      deadline.close();

      expect(deadline.remainingMs()).toBe(0);
      expect(result).toBe("cancelled");
      expect(started).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the fallback without starting work once the deadline has passed", async () => {
    const deadline = new HealthDeadline(1);
    await new Promise(resolve => {
      setTimeout(resolve, 20);
    });
    let started = false;
    const result = await deadline.run(async () => {
      started = true;
      return "work";
    }, "cancelled");
    deadline.close();

    expect(result).toBe("cancelled");
    expect(started).toBe(false);
  });
});
