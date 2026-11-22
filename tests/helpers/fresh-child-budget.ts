import { spawnSync } from "node:child_process";

/** Original invocation deadline translated once onto a captured, bound clock. */
export interface ChildBudgetWindow {
  readonly startedAtMs: number;
  readonly deadlineMs: number;
  readonly capturedAtMs: number;
  readonly clockDomain: "performance" | "real-epoch";
  readonly now: () => number;
  /** Native adapter provenance; never subtracted from the chosen clock. */
  readonly nativeStartedAtMs: number;
  readonly nativeDeadlineMs: number;
}

/** One actual finite invocation; child-only and total margins are distinct. */
export interface ChildBudgetPolicy {
  readonly baseMs: number;
  readonly quietReferenceMs: number;
  readonly maxSlowdown: number;
  readonly referenceDeadlineMs: number;
  readonly parentBudgetMs: number;
  readonly parentElapsedMs: number;
  readonly parentShare: number;
  /** Opt-in scaled files also limit total work; flat files cap only the child. */
  readonly parentTotalMargin?: boolean;
  readonly parentScope: string;
  readonly parentWindow: ChildBudgetWindow;
}

/** Values actually used at one dispatch, never a host-load or hang diagnosis. */
export interface ChildBudgetObservation extends ChildBudgetPolicy {
  readonly scope: "single reference immediately before child dispatch";
  readonly referenceMs: number;
  readonly slowdown: number;
  readonly sampledAtMs: number;
  readonly selectedAtMs: number;
  readonly referenceAgeMs: number;
  readonly calibrationMs: number;
  readonly operationLimitMs: number;
  readonly nominalTimeoutMs: number;
  readonly timeoutMs: number;
  readonly startedAtMs: number;
  readonly captureToAdmissionMs: number;
  readonly effectiveParentDeadlineMs: number;
  readonly remainingAtSelectionMs: number;
  readonly referenceAgeAtCompletionMs?: number;
  readonly operationElapsedMs?: number;
}

/**
 * Admit once, measure once, and spend a deadline that no observation can extend.
 * @param policy - Existing child constants and containing-window snapshot
 * @returns The exact values selected for one child dispatch
 */
export function freshChildBudget(
  policy: ChildBudgetPolicy
): ChildBudgetObservation {
  const window = policy.parentWindow;
  if (
    !window ||
    typeof window.now !== "function" ||
    !Number.isFinite(window.deadlineMs) ||
    !Number.isFinite(window.startedAtMs) ||
    !Number.isFinite(policy.parentBudgetMs)
  ) {
    throw new Error(
      "Child admission refused: no finite containing headroom remains."
    );
  }
  const now = window.now;
  const deadlineMs = Math.min(
    window.deadlineMs,
    window.startedAtMs +
      policy.parentBudgetMs *
        (policy.parentTotalMargin ? policy.parentShare : 1)
  );
  const started = now();
  const operationLimitMs = deadlineMs - started;
  if (!Number.isFinite(operationLimitMs) || operationLimitMs <= 0) {
    throw new Error(
      "Child admission refused: no finite containing headroom remains."
    );
  }
  const referenceStarted = now();
  const referenceTimeout = Math.min(
    policy.referenceDeadlineMs,
    Math.floor(
      // The 2.5 relation is CHILD-only. Reserve its share while calibrating;
      // do not apply that same child fraction as a new reference-work quota.
      (deadlineMs - referenceStarted) *
        (policy.parentTotalMargin ? 1 : 1 - policy.parentShare)
    )
  );
  if (referenceTimeout <= 0) {
    throw new Error(
      "Child admission refused: no finite containing headroom remains for a reference."
    );
  }
  const reference = spawnSync(process.execPath, ["-e", ""], {
    killSignal: "SIGKILL",
    stdio: "ignore",
    timeout: referenceTimeout,
  });
  const sampledAtMs = now();
  const referenceMs = sampledAtMs - referenceStarted;
  if (reference.error || reference.signal || reference.status !== 0) {
    throw new Error(
      `Child admission reference did not complete: status=${reference.status}, ` +
        `signal=${reference.signal}, error=${reference.error?.message ?? "none"}; ` +
        `reference bound=${referenceTimeout}ms, fixed operation window=${operationLimitMs}ms.`
    );
  }
  return selectChildBudget(
    policy,
    started,
    sampledAtMs,
    referenceMs,
    operationLimitMs,
    deadlineMs,
    now
  );
}

/**
 * Charge calibration to the fixed window before selecting the real child bound.
 * @param policy - Existing constants and containing-window snapshot
 * @param started - Operation start on the supplied clock
 * @param sampledAtMs - Reference completion on that clock
 * @param referenceMs - Actual observed reference cost
 * @param operationLimitMs - Fixed containing headroom at admission
 * @param deadlineMs - Original effective deadline on the same bound clock
 * @param now - The same operation clock primitive
 * @returns The exact bounded dispatch observation
 */
function selectChildBudget(
  policy: ChildBudgetPolicy,
  started: number,
  sampledAtMs: number,
  referenceMs: number,
  operationLimitMs: number,
  deadlineMs: number,
  now: () => number
): ChildBudgetObservation {
  const rawFactor = referenceMs / policy.quietReferenceMs;
  if (
    !Number.isFinite(rawFactor) ||
    referenceMs <= 0 ||
    rawFactor > policy.maxSlowdown
  ) {
    throw new Error(
      `Child admission refused: single reference=${referenceMs}ms, ratio=${rawFactor}, ` +
        `admissible clamp=${policy.maxSlowdown}; no host-load cause is established.`
    );
  }
  const slowdown = Math.min(policy.maxSlowdown, Math.max(1, rawFactor));
  const selectedAtMs = now();
  const calibrationMs = selectedAtMs - started;
  const remainingAtSelectionMs = deadlineMs - selectedAtMs;
  const nominalTimeoutMs = Math.round(policy.baseMs * slowdown);
  const timeoutMs = Math.floor(
    Math.min(
      nominalTimeoutMs,
      policy.parentBudgetMs * policy.parentShare,
      // Flat child-only headroom applies to the time actually left, too.
      // Scaled files already reserve half the actual parent outside their
      // distinct total passing-case window. Never buy a one-ms parent gap.
      remainingAtSelectionMs *
        (policy.parentTotalMargin ? 1 : policy.parentShare)
    )
  );
  if (timeoutMs <= 0) {
    throw new Error(
      `Child admission refused: calibration used ${calibrationMs}ms of the ` +
        `fixed ${operationLimitMs}ms operation window; no child was dispatched.`
    );
  }
  return {
    ...policy,
    scope: "single reference immediately before child dispatch",
    referenceMs,
    slowdown,
    sampledAtMs,
    selectedAtMs,
    referenceAgeMs: selectedAtMs - sampledAtMs,
    calibrationMs,
    operationLimitMs,
    nominalTimeoutMs,
    timeoutMs,
    startedAtMs: started,
    captureToAdmissionMs: started - policy.parentWindow.capturedAtMs,
    effectiveParentDeadlineMs: deadlineMs,
    remainingAtSelectionMs,
  };
}

/**
 * Record completion on the same clock used for admission.
 * @param reading - The unchanged dispatch decision
 * @param now - The same clock primitive used for that decision
 * @returns Completion age and total observed operation cost
 */
export function completedChildBudget(
  reading: ChildBudgetObservation,
  now: () => number
): ChildBudgetObservation {
  const completedAt = now();
  return {
    ...reading,
    referenceAgeAtCompletionMs: completedAt - reading.sampledAtMs,
    operationElapsedMs: completedAt - reading.startedAtMs,
  };
}

/**
 * Render the actual decision facts without inferring a physical cause.
 * @param reading - The values used by the actual dispatch
 * @returns A value-only diagnostic
 */
export function describeChildBudget(reading: ChildBudgetObservation): string {
  return (
    `Single pre-dispatch reference=${reading.referenceMs.toFixed(2)}ms, ` +
    `factor=${reading.slowdown.toFixed(2)}x, age at selection=${reading.referenceAgeMs.toFixed(2)}ms, ` +
    `age at completion=${reading.referenceAgeAtCompletionMs?.toFixed(2) ?? "unavailable"}ms, ` +
    `base=${reading.baseMs}ms, clamp=${reading.maxSlowdown}, child bound=${reading.timeoutMs}ms; ` +
    `calibration=${reading.calibrationMs.toFixed(2)}ms inside fixed operation window=${reading.operationLimitMs}ms; ` +
    `observed operation=${reading.operationElapsedMs?.toFixed(2) ?? "unavailable"}ms; ` +
    `capture-to-admission=${reading.captureToAdmissionMs.toFixed(2)}ms, original effective deadline=${reading.effectiveParentDeadlineMs}ms on ${reading.parentWindow.clockDomain}, selection remaining=${reading.remainingAtSelectionMs.toFixed(2)}ms; ` +
    `parent=${reading.parentScope}, elapsed=${reading.parentElapsedMs ?? "unavailable"}ms.`
  );
}
