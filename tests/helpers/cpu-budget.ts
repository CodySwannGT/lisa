/**
 * CPU-time stopwatch for guards that mean "this code does not do too much
 * work" rather than "this code finishes by a wall-clock time".
 *
 * ## Why this exists
 *
 * A guard written as `performance.now() - startedAt < BUDGET` measures the
 * *scheduler*, not the code. CodySwannGT/lisa#2516 is the case study: an abort
 * guard with **10x headroom** — designed runtime ~500ms against a 5,000ms
 * budget — failed at **10,026ms** inside a full-suite run of 639 test files.
 * Run in isolation five consecutive times it produced 549.8 / 522.2 / 530.2 /
 * 514.0 / 537.3 ms (σ≈13ms), and those five runs were taken at **load average
 * 70.51 on 18 cores**, i.e. an already-busy box. Machine-level contention does
 * not move that path. What moves it is full-suite conditions specifically:
 * vitest's worker pool starving a 500ms timer.
 *
 * That is the whole problem with wall clock as a work instrument. Wall time is
 * `work + waiting-to-be-scheduled`, and under a saturated pool the second term
 * is unbounded and dominates. Widening the budget does not fix it — it only
 * raises the load at which the same false failure returns, while destroying the
 * guard's ability to catch the regression it was written for.
 *
 * CPU time is the honest instrument for a work guard. A descheduled process
 * burns no CPU, so starvation is invisible to it; superlinear work burns CPU in
 * exact proportion, so a regression is fully visible. Measured on this repo's
 * default vitest pool (`forks`, one worker process per file, tests sequential
 * within a file), at load ~4.6/18 cores:
 *
 * | window | wall | CPU |
 * |---|---|---|
 * | 500ms idle timer wait | 501.7ms | **0.46ms** |
 * | 20M-iteration busy loop | 17.6ms | **18.7ms** |
 *
 * A ~1,000x discrimination between waiting and working, from one syscall.
 *
 * ## What CPU time does NOT catch, and why that is acceptable
 *
 * A regression that makes the code **wait** longer without working — an added
 * sleep, a new blocking I/O round-trip, a lost `clearTimeout` — burns no CPU
 * and slips past a CPU budget. That blind spot is bounded, not open: vitest's
 * per-test `testTimeout` (10s by default here) still fails any such regression
 * that crosses it, and a lower-bound wall assertion (`elapsed >= deadline`) is
 * safe to add alongside, because starvation can only make an elapsed time
 * *larger*, never smaller. Pair the two when both properties matter.
 *
 * ## Pool assumption
 *
 * `process.cpuUsage()` is process-wide. This is sound here because the pool is
 * `forks`: each worker is its own process running one test file at a time, so
 * the delta over an awaited region is that region's CPU plus negligible
 * runtime overhead. Under a `threads` pool the figure would aggregate sibling
 * threads and this helper would need revisiting — hence this note rather than
 * silence.
 */

/** A measured window of CPU and wall time. */
export interface CpuBudgetElapsed {
  /** CPU time (user + system) consumed inside the window, in milliseconds. */
  readonly cpuMs: number;
  /** Wall-clock time spanned by the window, in milliseconds. */
  readonly wallMs: number;
}

/** A running measurement started by {@link startCpuStopwatch}. */
export interface CpuStopwatch {
  /**
   * Read the elapsed CPU and wall time since the stopwatch started.
   * @returns Both figures; assert work against `cpuMs`, and use `wallMs` only
   * for lower bounds, never upper ones.
   */
  elapsed: () => CpuBudgetElapsed;
}

/**
 * Start measuring CPU and wall time for the current test.
 *
 * Call immediately before the region under guard and read it immediately
 * after; anything else inside the window is billed to the measurement.
 * @returns A stopwatch whose `elapsed()` may be read as often as needed.
 */
export function startCpuStopwatch(): CpuStopwatch {
  const cpuAt = process.cpuUsage();
  const wallAt = performance.now();
  return {
    elapsed: () => {
      const cpu = process.cpuUsage(cpuAt);
      return {
        cpuMs: (cpu.user + cpu.system) / 1_000,
        wallMs: performance.now() - wallAt,
      };
    },
  };
}
