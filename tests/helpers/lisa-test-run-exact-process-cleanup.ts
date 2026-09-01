/** Bounded teardown that only signals previously published authority. */
import * as fs from "node:fs";
import { performance } from "node:perf_hooks";

import {
  exactProcessObservation,
  processAbsent,
  type ExactCleanupAuthority,
  type ExactCleanupRun,
  type ExactProcessIdentity,
} from "./lisa-test-run-exact-process-state.js";

export type {
  ExactCleanupAuthority,
  ExactCleanupRun,
  ExactCleanupRunIncrement,
  ExactProcessCapture,
  ExactProcessIdentity,
  ExactScratchRootIdentity,
} from "./lisa-test-run-exact-process-state.js";
export {
  captureExactCleanupAuthority,
  captureExactProcessIdentities,
  exactProcessIsAlive,
  exactProcessObservation,
  publishExactCleanupIncrement,
} from "./lisa-test-run-exact-process-state.js";

/** Result of one birth-checked just-in-time signal attempt. */
export interface SignalResult {
  readonly sent: boolean;
  readonly error?: unknown;
}

/**
 * Wait until one root and all exact process identities are absent.
 * @param root - Exact published root, when materialized
 * @param identities - Original PID/birth identities
 * @param deadline - Absolute monotonic cleanup deadline
 * @returns Monotonic instant when cleanup became complete
 */
export async function waitForExactProcessCleanup(
  root: string | undefined,
  identities: readonly ExactProcessIdentity[],
  deadline: number
): Promise<number> {
  while (
    ((root !== undefined && fs.existsSync(root)) ||
      identities.some(identity =>
        ["alive", "ambiguous"].includes(exactProcessObservation(identity))
      )) &&
    performance.now() < deadline
  ) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const observedAt = performance.now();
  if (
    (root !== undefined && fs.existsSync(root)) ||
    identities.some(identity =>
      ["alive", "ambiguous"].includes(exactProcessObservation(identity))
    )
  ) {
    throw new Error("Exact test-run cleanup exceeded its absolute deadline");
  }
  return observedAt;
}

/**
 * Signal only the original process whose current birth still matches.
 * @param identity - Previously captured PID and birth
 * @param signal - Signal to deliver after the just-in-time identity check
 * @returns Whether the exact process was signalled, plus non-ESRCH failures
 */
export function signalExactProcess(
  identity: ExactProcessIdentity,
  signal: NodeJS.Signals
): SignalResult {
  const observation = exactProcessObservation(identity);
  if (observation === "ambiguous") {
    return {
      sent: false,
      error: new Error(
        `Process birth authority is unavailable for PID ${String(identity.pid)}`
      ),
    };
  }
  if (observation !== "alive") return { sent: false };
  try {
    process.kill(identity.pid, signal);
    return { sent: true };
  } catch (error) {
    const after = exactProcessObservation(identity);
    return processAbsent(error) || after === "absent" || after === "reused"
      ? { sent: false }
      : { sent: false, error };
  }
}

/**
 * Capture one async failure without dropping later cleanup work.
 * @param operation - Cleanup operation whose error must be retained
 * @returns The captured failure, or undefined after success
 */
async function captureFailure(
  operation: () => Promise<unknown>
): Promise<unknown | undefined> {
  try {
    await operation();
    return undefined;
  } catch (error) {
    return error;
  }
}

/**
 * Wait for the already-authorized wrapper handle to become terminal.
 * @param run - Published invocation containing the original child handle
 * @param deadline - Absolute monotonic deadline
 * @returns When the exact child has reached a terminal state
 */
async function waitForChildTerminal(
  run: ExactCleanupRun,
  deadline: number
): Promise<void> {
  while (
    run.child.exitCode === null &&
    run.child.signalCode === null &&
    performance.now() < deadline
  ) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (run.child.exitCode === null && run.child.signalCode === null) {
    throw new Error(
      `PID ${String(run.child.pid)} did not reach terminal state`
    );
  }
}

/**
 * Settle one run using only its originally captured identities.
 * @param authority - Immutable wrapper/root/reaper/process authority
 * @returns After production recovery and exact absence are proven
 */
async function settleExactTestRun(
  authority: ExactCleanupAuthority
): Promise<void> {
  const { run } = authority;
  const captured = authority.capture ?? {
    identities: [],
    failures: [new Error("Exact cleanup authority was not captured")],
  };
  const child = run.wrapper;
  const deadline = performance.now() + 45_000;
  const resume =
    run.reaper === undefined
      ? { sent: false }
      : signalExactProcess(run.reaper, "SIGCONT");
  const term =
    child === undefined
      ? { sent: false }
      : signalExactProcess(child, "SIGTERM");
  const graceful = await captureFailure(() =>
    waitForExactProcessCleanup(
      run.root,
      captured.identities,
      Math.min(deadline, performance.now() + 5_000)
    )
  );
  const reaperPid = run.reaper?.pid;
  const fallbackOrder = [
    ...captured.identities.filter(identity => identity.pid !== reaperPid),
    ...captured.identities.filter(identity => identity.pid === reaperPid),
  ];
  const kills =
    graceful === undefined
      ? []
      : fallbackOrder.map(identity => signalExactProcess(identity, "SIGKILL"));
  const terminal = await captureFailure(() =>
    waitForChildTerminal(run, deadline)
  );
  const absent = await captureFailure(() =>
    waitForExactProcessCleanup(run.root, captured.identities, deadline)
  );
  const failures = [
    ...captured.failures,
    ...(resume.error === undefined ? [] : [resume.error]),
    ...(term.error === undefined ? [] : [term.error]),
    ...(graceful === undefined ? [] : [graceful]),
    ...kills.flatMap(result =>
      result.error === undefined ? [] : [result.error]
    ),
    ...(terminal === undefined ? [] : [terminal]),
    ...(absent === undefined ? [] : [absent]),
  ];
  if (failures.length > 0) {
    throw new AggregateError(failures, "Exact test-run cleanup failed");
  }
}

/**
 * Settle all published runs and require the shared namespace to become empty.
 * @param authorities - Immutable authority snapshots, possibly not yet published
 * @param primary - Original assertion/readiness failure to preserve
 * @param namespace - Test-owned shared namespace that must become empty
 */
export async function settleExactTestRuns(
  authorities: readonly (ExactCleanupAuthority | undefined)[],
  primary?: unknown,
  namespace?: string
): Promise<void> {
  const cleanup = (
    await Promise.all(
      authorities
        .filter(
          (authority): authority is ExactCleanupAuthority =>
            authority !== undefined
        )
        .map(authority => captureFailure(() => settleExactTestRun(authority)))
    )
  ).filter(failure => failure !== undefined);
  const namespaceFailure =
    namespace === undefined
      ? undefined
      : await captureFailure(async () => {
          const deadline = performance.now() + 45_000;
          while (
            fs.existsSync(namespace) &&
            fs.readdirSync(namespace).length > 0 &&
            performance.now() < deadline
          ) {
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          if (
            fs.existsSync(namespace) &&
            fs.readdirSync(namespace).length > 0
          ) {
            throw new Error(
              "Shared scratch namespace retained an unknown root"
            );
          }
        });
  const failures = [
    ...cleanup,
    ...(namespaceFailure === undefined ? [] : [namespaceFailure]),
  ];
  if (primary !== undefined && failures.length > 0) {
    throw new AggregateError(
      [primary, ...failures],
      "Foreground-SIGKILL proof and teardown both failed",
      { cause: primary }
    );
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Waiting test-run teardown failed");
  }
  if (primary !== undefined) throw primary;
}
