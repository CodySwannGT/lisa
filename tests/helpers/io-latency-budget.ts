import { vi } from "vitest";

/**
 * Per-test and per-hook budget for suites whose work has unbounded latency.
 *
 * Two mechanisms, one cause. CodySwannGT/lisa#2490 names both: a case either
 * spawns an external process synchronously (`bash`, `git`, `tsc`, `npm pack`)
 * or performs many `fsync`-paired filesystem transactions. Neither has a bound
 * under contention, and both are billed against a fixed wall-clock budget. The
 * helper is named for the latency, not the spawn, because the fsync-heavy
 * suites fail exactly the same way and a name covering only half the cause
 * would send the next person looking for the wrong thing.
 *
 * EVERY figure below cites the machine state it was measured under, and that is
 * a hard requirement rather than a courtesy. A timing number is meaningless
 * without its conditions, and this module exists because one was reported
 * without them: `check-learnings-budget` was measured at 45.8s "in isolation"
 * while ~56 sibling vitest processes were live, and that retracted number very
 * nearly shipped here as a permanent code comment. Nothing errors when this
 * happens — the command succeeds and returns a true number about the wrong
 * thing — so no guard, exit code, or reviewer catches it. Publishing the
 * conditions is the only defense: it turns an unfalsifiable figure into one the
 * next person can re-measure and contradict.
 *
 * The sharpest evidence is not a slow suite at all — it is a near miss.
 * `learnings-writer` failed at **10,259ms against the 10,000ms budget: 2.6%
 * over**, then passed 5/5 on immediate re-run *under the same conditions*, and
 * it is that unchanged-conditions re-run that carries the argument: if the box
 * did not change and the result did, the budget is not measuring the box. It is
 * **no headroom**. A 2.6% margin loses to ordinary scheduler jitter forever, so
 * "run fewer agents" is not an available answer.
 *
 * `plugin-sync-scripts`: 9.2s per case against the 10s default — measured at
 * load ~48 on 18 cores, i.e. a moderately busy box, 92% consumed.
 *
 * `check-learnings-budget`: 23.6s on a QUIET box — but that is whole-suite wall
 * time, not per-case, and a separate nine-run sample never saw it fail. It is
 * marginal under contention (2 of 12 runs at load ~115), not always slow.
 *
 * 60s is sized to clear the most expensive suite-level cost in the set with
 * ~2.5x left over, and it is the only value here proven under load: 16
 * concurrent runs of `plugin-sync-scripts`, two arms back-to-back at matched
 * load (68.51 vs 65.64), went from 15/16 processes failing at 10s to 0/16.
 *
 * The five suites wired to this helper are where the failures were observed —
 * they are NOT a closed set. A nine-run sample elsewhere caught three more
 * (`standards-proof-typescript`, `codex-edit-hooks`, and others) in its heaviest
 * runs. So "in the list ⇒ marginal budget" is a fair reading; "not in the list
 * ⇒ a real defect" is NOT. Expect the mechanism to reach further than the
 * roster, and add suites on evidence rather than trusting the roster's edges.
 */
export const IO_LATENCY_TEST_TIMEOUT_MS = 60_000;

/**
 * Widen the wall-clock budget for the current file only.
 *
 * Deliberately opt-in per file rather than a global `testTimeout` bump. A fixed
 * wall-clock budget over synchronous I/O measures the machine, not the code —
 * the same anti-pattern as the fixed retry count fixed in
 * CodySwannGT/lisa#2499, where 200 retries turned out to be 2589ms of real
 * time. But raising it everywhere would trade one bad signal for another: a
 * genuine deadlock in an ordinary suite should still surface in ten seconds,
 * and it will, because every suite that does not call this keeps the default.
 *
 * The honest cost of calling it: a real hang in one of these suites now takes
 * 60s to report instead of 10s. That is the price of trusting the rest of the
 * suite under load, and it is bounded — a wider budget, never an absent one.
 *
 * Call once at module scope, above the `describe` blocks.
 * @param timeoutMs - Budget in milliseconds. Defaults to
 * {@link IO_LATENCY_TEST_TIMEOUT_MS}. Any override needs a measured wall time
 * from a QUIET machine in the calling comment — a number measured while other
 * work was running is a property of that machine, not of the test, and #2490 is
 * in part a case study in what happens when the two are confused.
 */
export function useIoLatencyBudget(
  timeoutMs: number = IO_LATENCY_TEST_TIMEOUT_MS
): void {
  vi.setConfig({
    testTimeout: timeoutMs,
    hookTimeout: timeoutMs,
  });
}
