import { expect } from "vitest";
import type { ChildBudgetObservation } from "./fresh-child-budget.js";
import type { TimedInvocation } from "./timed-invocation.js";

/** Value-only outcome of one real reference or target primitive call. */
export interface Stage {
  kind: "reference" | "target";
  expectedInvocation: boolean;
  boundMs: number | undefined;
  startedAtMs: number;
  endedAtMs: number;
  status: number | null;
  signal: NodeJS.Signals | null;
  errorCode: string | undefined;
  errorMessage: string | undefined;
  pid: number;
  directPidAbsent: boolean | undefined;
  stdout: string;
}

/** Stage observations and unchanged native owner values from one hook. */
export interface HookReading {
  priorWorkMs: number;
  invocation: TimedInvocation;
  beforeChild: TimedInvocation;
  completed: TimedInvocation;
  callbackElapsedMs: number;
  stages: Stage[];
  targetDispatchCount: number;
  reading: ChildBudgetObservation | undefined;
  error: string | undefined;
}

/**
 * Require one actual native hook start and deadline for all stage observations.
 * @param result - Actual hook outcome, including absent undispatched work
 * @param hookLimit - Declared hook limit
 * @returns The actual final reference observation
 */
export function assertWindow(result: HookReading, hookLimit: number): Stage {
  // Emit in the assertion case, outside the measured hook's timed window.
  const { targetDispatchCount } = result;
  const { invocation, beforeChild, completed } = result;
  const references = result.stages.filter(stage => stage.kind === "reference");
  const reference = references.at(-1);
  if (!reference) throw new Error("expected a reference observation");
  expect(references.length).toBeLessThanOrEqual(2);
  if (references.length === 2) assertRecheck(result, references[0]!, reference);
  console.log(
    `HOOK_WINDOW_JOURNAL ${JSON.stringify({ classification: "Owned Node reference and target under an observed Vitest hook deadline, with 72ms of controlled reference work", branch: targetDispatchCount ? "target-dispatched" : reference.errorCode === "ETIMEDOUT" ? "reference-timeout/no-target" : "reference-refusal/no-target", originalDeadlineMs: result.invocation.startedAtMs + result.invocation.timeoutMs, ...result })}`
  );
  expect(invocation.timeoutMs).toBeCloseTo(hookLimit, 9);
  for (const value of [invocation, beforeChild, completed]) {
    expect(Number.isFinite(value.startedAtMs)).toBe(true);
    expect(Number.isFinite(value.nowMs)).toBe(true);
    expect(value.startedAtMs).toBe(invocation.startedAtMs);
    expect(value.timeoutMs).toBeCloseTo(hookLimit, 9);
    expect(value.nowMs).toBeGreaterThanOrEqual(value.startedAtMs);
    expect(value.nowMs).toBeLessThan(invocation.startedAtMs + hookLimit);
  }
  expect(result.callbackElapsedMs).toBeLessThan(hookLimit);
  for (const stage of result.stages) {
    expect(stage.expectedInvocation).toBe(true);
    expect(Number.isFinite(stage.boundMs)).toBe(true);
    expect(stage.boundMs).toBeGreaterThan(0);
    expect(stage.boundMs).toBeLessThanOrEqual(
      invocation.startedAtMs + hookLimit - stage.startedAtMs
    );
    expect(Number.isFinite(stage.startedAtMs)).toBe(true);
    expect(stage.startedAtMs).toBeGreaterThanOrEqual(beforeChild.nowMs);
    expect(stage.endedAtMs).toBeGreaterThan(stage.startedAtMs);
    expect(stage.endedAtMs).toBeLessThan(invocation.startedAtMs + hookLimit);
    expect(Number.isFinite(stage.pid)).toBe(true);
    expect(stage.pid).toBeGreaterThanOrEqual(0);
    if (stage.pid > 0) expect(stage.directPidAbsent).toBe(true);
  }
  return reference;
}

/**
 * Retain calibration, original window and child-only2.5headroom assertions.
 * @param result - Actual hook outcome after a successful reference
 * @param reference - Final executed reference
 * @param hookLimit - Declared hook limit
 * @returns The one actual dispatched target stage
 */
export function assertSelectedChild(
  result: HookReading,
  reference: Stage,
  hookLimit: number
): Stage {
  const reading = result.reading!;
  const target = result.stages.at(-1)!;
  expect(reference.kind).toBe("reference");
  expect(reference.status).toBe(0);
  expect(reference.signal).toBeNull();
  expect(reference.errorCode).toBeUndefined();
  expect(reference.errorMessage).toBeUndefined();
  expect(result.stages.filter(stage => stage.kind === "target")).toHaveLength(
    1
  );
  expect(result.targetDispatchCount).toBe(1);
  expect(result.stages.at(-2)).toBe(reference);
  expect(reading).toBeDefined();
  expect(reading.parentBudgetMs).toBeCloseTo(hookLimit, 9);
  expect(reading.parentWindow.nativeStartedAtMs).toBe(
    result.invocation.startedAtMs
  );
  expect(reading.parentWindow.nativeDeadlineMs).toBe(
    result.invocation.startedAtMs + hookLimit
  );
  expect(reading.parentWindow.clockDomain).toBe("performance");
  expect(reading.calibrationMs + reading.timeoutMs * 2.5).toBeLessThanOrEqual(
    hookLimit - reading.parentElapsedMs
  );
  expect(reading.operationElapsedMs).toBeLessThan(
    hookLimit - reading.parentElapsedMs
  );
  expect(target.kind).toBe("target");
  expect(target.boundMs).toBe(reading.timeoutMs);
  expect(target.pid).toBeGreaterThan(0);
  expect(target.directPidAbsent).toBe(true);
  return target;
}

/**
 * Require a completed, measured over-limit first sample before a recheck.
 * @param result - Values recorded by the hook
 * @param first - Completed initial sample
 * @param next - The final sample
 */
function assertRecheck(result: HookReading, first: Stage, next: Stage): void {
  const fromError = result.error?.match(
    /rejected first reference=(\d+(?:\.\d+)?)ms/u
  )?.[1];
  const firstCost = result.reading?.rejectedReferenceMs ?? Number(fromError);
  expect(first.status).toBe(0);
  expect(first.signal).toBeNull();
  expect(first.errorCode).toBeUndefined();
  expect(next.startedAtMs).toBeGreaterThanOrEqual(first.endedAtMs);
  expect(next.boundMs).toBeLessThan(first.boundMs ?? 0);
  expect(firstCost).toBeGreaterThan(18 * 8);
}

/**
 * Attribute an undispatched target to the actual final reference outcome.
 * @param result - Values recorded by the hook
 * @param reference - The last executed reference
 * @param hookLimit - Declared hook limit
 */
export function assertReferenceRefusal(
  result: HookReading,
  reference: Stage,
  hookLimit: number
): void {
  const details = result.error?.match(
    /reference bound=(\d+)ms, fixed operation window=(\d+(?:\.\d+)?)ms\./u
  );
  const operationWindow = Number(details?.[2]);
  expect(reference.kind).toBe("reference");
  expect(result.stages.at(-1)).toBe(reference);
  expect(result.stages.some(stage => stage.kind === "target")).toBe(false);
  expect(result.targetDispatchCount).toBe(0);
  expect(result.reading).toBeUndefined();

  if (reference.errorCode === "ETIMEDOUT") {
    expect(reference.signal).toBe("SIGKILL");
    expect(reference.status).toBeNull();
    expect(reference.errorMessage).toBeDefined();
    const prefix = `Child admission reference did not complete: status=null, signal=SIGKILL, error=${
      reference.errorMessage
    }; reference bound=${reference.boundMs}ms`;
    expect(result.error?.startsWith(prefix)).toBe(true);
  } else {
    expect(reference.status).toBe(0);
    expect(reference.signal).toBeNull();
    expect(reference.errorCode).toBeUndefined();
    const elapsed = result.error?.match(
      /^Child admission reference completed after its bound: elapsed=(\d+(?:\.\d+)?)ms/u
    )?.[1];
    expect(Number(elapsed)).toBeGreaterThan(reference.boundMs ?? Infinity);
  }
  expect(details).toBeDefined();
  expect(operationWindow).toBeGreaterThan(0);
  expect(operationWindow).toBeLessThanOrEqual(
    result.invocation.startedAtMs + hookLimit - result.beforeChild.nowMs
  );
  expect(reference.boundMs).toBe(Number(details?.[1]));
  expect(reference.boundMs).toBeLessThanOrEqual(operationWindow);
}
