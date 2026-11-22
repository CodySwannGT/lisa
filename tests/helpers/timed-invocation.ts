/** Actual values from one Vitest withTimeout invocation, on its native clock. */
export interface TimedInvocation {
  readonly startedAtMs: number;
  readonly timeoutMs: number;
  readonly nowMs: number;
}

// The configured runner and Vite's test graph can instantiate this module twice.
const INVOCATION_KEY = Symbol.for("lisa.boundedChildInvocation.v1");

/**
 * Publish the configured runner's value-only reader across those module graphs.
 * @param reader - Current async invocation; never starts or extends a deadline
 */
export function publishTimedInvocation(
  reader: () => TimedInvocation | undefined
): void {
  Object.defineProperty(globalThis, INVOCATION_KEY, {
    configurable: true,
    value: reader,
  });
}

/**
 * Read an actual finite invocation, without guessing a hook age or default.
 * @returns The runner's current invocation, or undefined during test collection
 */
export function activeTimedInvocation(): TimedInvocation | undefined {
  const reader = (globalThis as unknown as Record<symbol, unknown>)[
    INVOCATION_KEY
  ];
  if (typeof reader !== "function") throw missingTimingOwner();
  const value: TimedInvocation | undefined = reader();
  if (value === undefined) return value;
  if (
    !Number.isFinite(value.startedAtMs) ||
    !Number.isFinite(value.nowMs) ||
    !Number.isFinite(value.timeoutMs) ||
    value.timeoutMs <= 0
  ) {
    throw missingTimingOwner();
  }
  return value;
}

/**
 * Report that the expected native timer could not be read.
 * @returns An error for the caller or its test harness
 */
function missingTimingOwner(): Error {
  return new Error(
    "Child admission refused: actual finite Vitest invocation unavailable; use the configured child-budget runner."
  );
}

/**
 * Require native timing when a caller is asserting the timed contract itself.
 * @returns The active native invocation
 */
export function currentTimedInvocation(): TimedInvocation {
  const active = activeTimedInvocation();
  if (active === undefined) throw missingTimingOwner();
  return active;
}
