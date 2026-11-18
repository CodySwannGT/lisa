/**
 * Kill a detached child's whole process group and wait, boundedly, for it to
 * close (CodySwannGT/lisa#5034).
 *
 * The Sonar hook's mid-resolve kill case attached its `close` listener only
 * after an earlier await, then waited on it with no bound. A child that closed
 * inside that window had already emitted `close`, so the case could hang until
 * vitest killed it, and the failure read `Test timed out in 114710ms`, naming
 * neither the child nor what it had done. Watching from spawn means no close
 * can be missed. The bound means a close that truly never arrives fails with
 * the child's pid, exit, signal and output, in place of an anonymous timeout.
 * @module tests/unit/hooks/support/process-group
 */
import type { ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import {
  CHILD_OUTPUT_TAIL_BYTES,
  describeChildOutput,
} from "../../../helpers/child-output-tail.js";
import { ioLatencyBudgetMs } from "../../../helpers/io-latency-budget.js";

/** How a watched child ended. */
export interface ChildClose {
  /** Exit code, or null when a signal ended it. */
  readonly code: number | null;
  /** Ending signal, or null when it exited. */
  readonly signal: NodeJS.Signals | null;
}

/** A spawned child whose exit, close and output are observed from spawn. */
export interface WatchedChild {
  readonly child: ChildProcess;
  /** Whether the child has already closed. */
  readonly isClosed: () => boolean;
  /** Resolves once the child closes, with how it ended. */
  readonly closed: Promise<ChildClose>;
  /** The child's exit so far, and the tail of what it printed. */
  readonly describe: () => string;
}

/** What the watcher has observed so far. */
interface Observed {
  stdout: Buffer;
  stderr: Buffer;
  exit: ChildClose | undefined;
  closed: boolean;
}

/**
 * Keep only the last bytes of a stream that a diagnostic would show.
 * @param kept - What has been kept so far
 * @param chunk - The newly received chunk
 * @returns The bounded concatenation
 */
function keepTail(kept: Buffer, chunk: Buffer): Buffer {
  const joined = Buffer.concat([kept, chunk]);
  const limit = CHILD_OUTPUT_TAIL_BYTES * 2;
  return joined.length > limit
    ? Buffer.from(joined.subarray(joined.length - limit))
    : joined;
}

/**
 * Render an observed exit as a parenthesised clause.
 * @param exit - The exit, when one has been observed
 * @returns e.g. `(exit code 0, signal null)`
 */
function describeExit(exit: ChildClose | undefined): string {
  return `(exit code ${String(exit?.code ?? null)}, signal ${String(exit?.signal ?? null)})`;
}

/**
 * Begin observing a spawned child. Call it right after `spawn`, before any
 * await, so no `exit` or `close` can be emitted unobserved.
 * @param child - A child spawned with `detached: true` and piped stdio
 * @returns The watched child
 */
export function watchChild(child: ChildProcess): WatchedChild {
  const observed: Observed = {
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    exit: undefined,
    closed: false,
  };
  const closed = new Promise<ChildClose>(resolve => {
    child.once("close", (code, signal) => {
      observed.closed = true;
      resolve({ code, signal });
    });
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    observed.stdout = keepTail(observed.stdout, chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    observed.stderr = keepTail(observed.stderr, chunk);
  });
  child.once("exit", (code, signal) => {
    observed.exit = { code, signal };
  });
  return {
    child,
    closed,
    isClosed: () => observed.closed,
    describe: () =>
      `${describeExit(observed.exit)}${describeChildOutput(observed.stdout, observed.stderr)}`,
  };
}

/**
 * Wait for a close, or reject naming the child once the bound expires.
 * @param watched - The watched child
 * @param boundMs - Scaled bound, in milliseconds
 * @param signal - Aborts the timer once the close wins
 * @returns Never resolves; rejects when the bound expires
 */
async function expireAfter(
  watched: WatchedChild,
  boundMs: number,
  signal: AbortSignal
): Promise<never> {
  await delay(boundMs, undefined, { signal });
  throw new Error(
    `pid ${String(watched.child.pid)} did not close within ${boundMs.toLocaleString("en-US")}ms after SIGKILL to its group ${watched.describe()}`
  );
}

/**
 * SIGKILL the child's process group, then wait a bounded time for it to close.
 *
 * A child that already closed is not signalled: its group may no longer be its
 * own. The wait is `baseMs` scaled by this worker's measured slowdown, so it
 * holds on a loaded box and still fails well before the case's own timeout.
 * @param watched - A child from {@link watchChild}
 * @param baseMs - Quiet-box bound for the close to arrive after the kill
 * @returns How the child ended
 * @throws {Error} Naming the pid, exit, signal and output when no close arrives
 */
export async function killGroupAndAwaitClose(
  watched: WatchedChild,
  baseMs: number
): Promise<ChildClose> {
  const { pid } = watched.child;
  if (watched.isClosed()) return watched.closed;
  if (pid === undefined) throw new Error("child has no PID");
  const timer = new AbortController();
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  try {
    return await Promise.race([
      watched.closed,
      expireAfter(watched, ioLatencyBudgetMs(baseMs), timer.signal),
    ]);
  } finally {
    timer.abort();
  }
}
