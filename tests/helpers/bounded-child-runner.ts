import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { TestRunner, vi } from "vitest";
import { activeTimedInvocation } from "./timed-invocation.js";
import {
  completedChildBudget,
  freshChildBudget,
} from "./fresh-child-budget.js";
import type {
  ChildBudgetObservation,
  ChildBudgetPolicy,
} from "./fresh-child-budget.js";
// Type-only imports introduce no runtime helper cycle.
import type {
  BoundedSpawn,
  ChildOutcome,
  PipeErrorTolerance,
} from "./io-latency-budget.js";

/**
 * Read the one actual timed invocation, including hook overrides and elapsed work.
 * @param scaled - Whether the file opted into the existing scaled margin
 * @param flatShare - Existing flat child/case headroom share
 * @param scaledShare - Existing scaled passing-case margin
 * @returns A fixed containing-window snapshot, when Vitest is timing this call
 */
export function containingChildWindow(
  scaled: boolean,
  flatShare: number,
  scaledShare: number
) {
  const fakeTimers = vi.isFakeTimers();
  const now = fakeTimers
    ? vi.getRealSystemTime.bind(vi)
    : performance.now.bind(performance);
  const capturedAtMs = now();
  const task = TestRunner.getCurrentTest();
  const window = activeTimedInvocation();
  if (window === undefined) return undefined;
  const elapsedMs = Math.max(0, window.nowMs - window.startedAtMs);
  const hookRunning = Object.values(task?.result?.hooks ?? {}).includes("run");
  const inBody = task?.result?.state === "run" && !hookRunning;
  return {
    parentBudgetMs: window.timeoutMs,
    parentElapsedMs: elapsedMs,
    // Translate a duration, never raw timestamps from incompatible clocks.
    // Capture before the native read so transfer cost cannot grant extra time.
    parentWindow: Object.freeze({
      startedAtMs: capturedAtMs - elapsedMs,
      deadlineMs: capturedAtMs + window.timeoutMs - elapsedMs,
      capturedAtMs,
      clockDomain: fakeTimers
        ? ("real-epoch" as const)
        : ("performance" as const),
      now,
      nativeStartedAtMs: window.startedAtMs,
      nativeDeadlineMs: window.startedAtMs + window.timeoutMs,
    }),
    parentShare: scaled ? scaledShare : flatShare,
    parentTotalMargin: scaled,
    parentScope: inBody
      ? "actual Vitest timed case invocation"
      : "actual Vitest timed hook invocation",
  };
}

/**
 * Choose one measured admission or the existing finite library-collection cap.
 * @param policy - Timed admission facts or the precomputed collection cap
 * @returns Values to use for this dispatch
 */
function dispatchBudget(policy: ChildBudgetPolicy | number) {
  if (typeof policy === "number") {
    return { budget: undefined, now: Date.now, timeoutMs: policy };
  }
  const budget = freshChildBudget(policy);
  return { budget, now: policy.parentWindow.now, timeoutMs: budget.timeoutMs };
}

/**
 * Run once under a fixed budget and preserve the owning helper's error rules.
 * @param spec - Child transport and declared input relationship
 * @param policy - Timed window or the existing cap for collection-time work
 * @param complete - Actual helper completion/error assertion
 * @returns The real child result, including ordinary nonzero status and streams
 */
export function runBoundedChild(
  spec: BoundedSpawn,
  policy: ChildBudgetPolicy | number,
  complete: (
    outcome: ChildOutcome,
    label: string,
    tolerance: PipeErrorTolerance,
    timing: { timeoutMs: number; elapsedMs: number },
    budget?: ChildBudgetObservation
  ) => void
): SpawnSyncReturns<string> {
  const { budget, now, timeoutMs } = dispatchBudget(policy);
  const spawn = spec.spawn ?? spawnSync;
  try {
    const dispatchStarted = now();
    const outcome = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      encoding: "utf-8",
      env: spec.env,
      input: spec.input,
      killSignal: "SIGKILL",
      maxBuffer: spec.maxBuffer,
      stdio: spec.stdio,
      timeout: timeoutMs,
    });
    complete(
      outcome,
      spec.label,
      spec.childMayExitBeforeReading === true
        ? "child-may-exit-before-reading"
        : "child-must-consume-input",
      {
        timeoutMs,
        elapsedMs: now() - dispatchStarted,
      },
      budget && completedChildBudget(budget, now)
    );
    return outcome;
  } finally {
    // This optional test seam expects a nonthrowing observer. A throwing callback
    // replaces any pending child error and can interrupt outer exec status
    // conversion; generalized fallible-sink/error-priority handling is deferred.
    if (budget) spec.observeBudget?.(completedChildBudget(budget, now));
  }
}
