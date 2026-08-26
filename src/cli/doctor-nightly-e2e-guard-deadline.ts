/**
 * @file doctor-nightly-e2e-guard-deadline.ts
 * @description One monotonic deadline shared by guard discovery and proof
 * @module cli/doctor-nightly-e2e-guard-deadline
 */
import { performance } from "node:perf_hooks";

import { NIGHTLY_GUARD_OPERATION_TIMEOUT_MS } from "./doctor-nightly-e2e-guard-contract.js";

/** Explicit error used to convert every deadline exhaustion into one finding. */
export class NightlyGuardDeadlineError extends Error {
  /** Distinguishes a bounded refusal from arbitrary IO failures. */
  readonly code = "NIGHTLY_GUARD_DEADLINE";

  /**
   * Create the stable operator-facing deadline refusal.
   * @param reason - Budget whose expiration caused the refusal
   */
  constructor(reason = "15 seconds whole-operation deadline exhausted") {
    super(reason);
    this.name = "NightlyGuardDeadlineError";
  }
}

/** Absolute operation budget shared across leaf modules. */
export interface NightlyGuardDeadline {
  /** Absolute time from the injected monotonic clock. */
  readonly expiresAt: number;
  /** Monotonic clock used by every budget check. */
  readonly now: () => number;
  /** Exact budget represented by this absolute expiration. */
  readonly reason: string;
}

/**
 * Start the deadline before discovery so an expensive scan consumes proof time.
 * @param now - Injected monotonic clock
 * @param timeoutMs - Whole-operation budget
 * @param reason - Exact budget named on expiry
 * @returns Shared absolute deadline
 */
export function createNightlyGuardDeadline(
  now: () => number = () => performance.now(),
  timeoutMs = NIGHTLY_GUARD_OPERATION_TIMEOUT_MS,
  reason = "15 seconds whole-operation deadline exhausted"
): NightlyGuardDeadline {
  return { expiresAt: now() + timeoutMs, now, reason };
}

/**
 * Return the non-negative time left in the shared budget.
 * @param deadline - Shared absolute deadline
 * @returns Remaining milliseconds, clamped at zero
 */
export const nightlyGuardRemaining = (deadline: NightlyGuardDeadline): number =>
  Math.max(0, deadline.expiresAt - deadline.now());

/**
 * Describe the exact target ceiling without hard-coding the default budget.
 * @param timeoutMs - Target-specific ceiling in milliseconds
 * @returns Stable operator-facing deadline reason
 */
export function nightlyGuardTargetDeadlineReason(timeoutMs: number): string {
  const seconds = timeoutMs / 1000;
  const duration = Number.isInteger(seconds)
    ? `${seconds} ${seconds === 1 ? "second" : "seconds"}`
    : `${timeoutMs} milliseconds`;
  return `${duration} target proof deadline exhausted`;
}

/**
 * Refuse work immediately once the shared deadline has elapsed.
 * @param deadline - Shared absolute deadline
 */
export function assertNightlyGuardDeadline(
  deadline: NightlyGuardDeadline
): void {
  if (nightlyGuardRemaining(deadline) <= 0) {
    throw new NightlyGuardDeadlineError(deadline.reason);
  }
}

/**
 * Enforce the remaining wall-clock budget even when an injected collaborator
 * never resolves. The abandoned operation is read-only and cannot alter the
 * inspected project after the refusal is returned.
 * @param deadline - Shared operation deadline
 * @param operation - Lazy read-only asynchronous work
 * @returns The operation result before expiry
 */
export async function withinNightlyGuardDeadline<T>(
  deadline: NightlyGuardDeadline,
  operation: () => Promise<T>
): Promise<T> {
  const remaining = nightlyGuardRemaining(deadline);
  if (remaining <= 0) throw new NightlyGuardDeadlineError(deadline.reason);
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new NightlyGuardDeadlineError(deadline.reason)),
      remaining
    );
    operation().then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Give one target a smaller ceiling without extending the outer deadline.
 * @param outer - Whole-operation deadline
 * @param timeoutMs - Target-specific ceiling
 * @returns Deadline ending at the earlier ceiling
 */
export function limitNightlyGuardDeadline(
  outer: NightlyGuardDeadline,
  timeoutMs: number
): NightlyGuardDeadline {
  const targetExpiresAt = outer.now() + timeoutMs;
  return {
    expiresAt: Math.min(outer.expiresAt, targetExpiresAt),
    now: outer.now,
    reason:
      targetExpiresAt < outer.expiresAt
        ? nightlyGuardTargetDeadlineReason(timeoutMs)
        : outer.reason,
  };
}
