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
  readonly scope: "latest reference immediately before child dispatch";
  readonly referenceMs: number;
  readonly rejectedReferenceMs: number | null;
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
  readonly dispatchGapMs?: number;
  readonly remainingAtDispatchMs?: number;
  readonly referenceAgeAtCompletionMs?: number;
  readonly operationElapsedMs?: number;
}

/**
 * Measure inside the original reference window and admit only on the latest sample.
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
  const { sample, rejectedReferenceMs } = measureWithinReferenceWindow(
    policy,
    deadlineMs,
    operationLimitMs
  );
  return selectChildBudget(
    policy,
    started,
    sample,
    deadlineMs,
    rejectedReferenceMs
  );
}
/**
 * Select the latest reference within one fixed allowance.
 * @param policy - Clock and reference allowance policy
 * @param deadlineMs - Original containing deadline
 * @param operationLimitMs - Containing headroom when admission began
 * @returns The latest sample and any earlier sample rejected by the clamp
 */
function measureWithinReferenceWindow(
  policy: ChildBudgetPolicy,
  deadlineMs: number,
  operationLimitMs: number
) {
  const now = policy.parentWindow.now;
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
  const first = measureReference(
    now,
    referenceStarted,
    referenceTimeout,
    operationLimitMs
  );
  // A completed outlier can come from scheduling the reference itself. Check
  // once more within the original reference allowance before withholding work.
  const firstFactor = first.referenceMs / policy.quietReferenceMs;
  const recheckAt =
    Number.isFinite(firstFactor) && firstFactor > policy.maxSlowdown
      ? now()
      : null;
  const remaining =
    recheckAt === null
      ? 0
      : Math.floor(referenceStarted + referenceTimeout - recheckAt);
  const sample =
    recheckAt !== null && remaining > 0
      ? measureReference(now, recheckAt, remaining, operationLimitMs)
      : first;
  const rejectedReferenceMs = sample === first ? null : first.referenceMs;
  return { sample, rejectedReferenceMs };
}

/**
 *
 */
interface ReferenceSample {
  readonly referenceMs: number;
  readonly sampledAtMs: number;
}

/**
 * Time one finished reference and retain the actual transport refusal.
 * @param now - Clock bound to the containing test window
 * @param started - Reference start on that clock
 * @param timeout - Remaining fixed reference allowance
 * @param operationLimitMs - Original containing headroom
 * @returns Measured latency and completion time
 */
function measureReference(
  now: () => number,
  started: number,
  timeout: number,
  operationLimitMs: number
): ReferenceSample {
  const reference = spawnSync(process.execPath, ["-e", ""], {
    killSignal: "SIGKILL",
    stdio: "ignore",
    timeout,
  });
  const sampledAtMs = now();
  if (reference.error || reference.signal || reference.status !== 0) {
    throw new Error(
      `Child admission reference did not complete: status=${reference.status}, ` +
        `signal=${reference.signal}, error=${reference.error?.message ?? "none"}; ` +
        `reference bound=${timeout}ms, fixed operation window=${operationLimitMs}ms.`
    );
  }
  return { referenceMs: sampledAtMs - started, sampledAtMs };
}

/**
 * Report a discarded sample only when the recheck actually ran.
 * @param referenceMs - Earlier measured latency above the clamp
 * @returns The optional diagnostic fragment
 */
function rejectedReference(referenceMs: number | null): string {
  return referenceMs === null
    ? ""
    : `rejected first reference=${referenceMs.toFixed(2)}ms; `;
}

/**
 * Charge calibration to the fixed window before selecting the real child bound.
 * @param policy - Existing constants and containing-window snapshot
 * @param started - Operation start on the supplied clock
 * @param sample - Latest measured reference cost and completion on the same clock
 * @param deadlineMs - Original effective deadline on the same bound clock
 * @param rejectedReferenceMs - Earlier completed sample above the clamp, if rechecked
 * @returns The exact bounded dispatch observation
 */
function selectChildBudget(
  policy: ChildBudgetPolicy,
  started: number,
  sample: ReferenceSample,
  deadlineMs: number,
  rejectedReferenceMs: number | null
): ChildBudgetObservation {
  const { sampledAtMs, referenceMs } = sample;
  const rawFactor = referenceMs / policy.quietReferenceMs;
  if (
    !Number.isFinite(rawFactor) ||
    referenceMs <= 0 ||
    rawFactor > policy.maxSlowdown
  ) {
    throw new Error(
      `Child admission refused: latest reference=${referenceMs}ms, ratio=${rawFactor}, ` +
        `admissible clamp=${policy.maxSlowdown}; ${rejectedReference(rejectedReferenceMs)}no host-load cause is established.`
    );
  }
  const slowdown = Math.min(policy.maxSlowdown, Math.max(1, rawFactor));
  const now = policy.parentWindow.now;
  const selectedAtMs = now();
  const operationLimitMs = deadlineMs - started;
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
    scope: "latest reference immediately before child dispatch",
    referenceMs,
    rejectedReferenceMs,
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
    `Pre-dispatch reference=${reading.referenceMs.toFixed(2)}ms, ` +
    `factor=${reading.slowdown.toFixed(2)}x, age at selection=${reading.referenceAgeMs.toFixed(2)}ms, ` +
    `age at completion=${reading.referenceAgeAtCompletionMs?.toFixed(2) ?? "unavailable"}ms, ` +
    `base=${reading.baseMs}ms, clamp=${reading.maxSlowdown}, child bound=${reading.timeoutMs}ms; ${rejectedReference(reading.rejectedReferenceMs)}` +
    `calibration=${reading.calibrationMs.toFixed(2)}ms inside fixed operation window=${reading.operationLimitMs}ms; ` +
    `observed operation=${reading.operationElapsedMs?.toFixed(2) ?? "unavailable"}ms; ` +
    `capture-to-admission=${reading.captureToAdmissionMs.toFixed(2)}ms, original effective deadline=${reading.effectiveParentDeadlineMs}ms on ${reading.parentWindow.clockDomain}, selection remaining=${reading.remainingAtSelectionMs.toFixed(2)}ms, selection-to-dispatch=${reading.dispatchGapMs?.toFixed(2) ?? "unavailable"}ms; ` +
    `parent=${reading.parentScope}, elapsed=${reading.parentElapsedMs ?? "unavailable"}ms.`
  );
}
