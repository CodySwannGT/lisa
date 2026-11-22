/**
 * Birth-bound descendant observation for a freshly spawned detached fixture.
 * Process names never confer cleanup authority; ancestry and identity do.
 * @module tests/helpers/freshness-owned-processes
 */
import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertChildCompleted,
  ioLatencyBudgetMs,
} from "./io-latency-budget.js";
import type { Latch } from "./latch.js";

const CENSUS_LABEL = "birth-bound freshness fixture process census";
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

/** Native process identity observed while under the live fixture leader. */
export interface Identity {
  readonly pid: number;
  readonly parent: number;
  readonly group: number;
  readonly birth: string;
  readonly state: string;
}

/**
 * Parse a complete census without granting authority to malformed prefixes.
 * @param output Complete native stdout.
 * @returns Native rows with the complete process birth time.
 */
function parseCensus(output: string): readonly Identity[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const fields = line.trim().split(/\s+/u);
      if (
        fields.length !== 9 ||
        fields.slice(0, 3).some(field => !/^\d+$/u.test(field))
      )
        throw new Error(`${CENSUS_LABEL}: invalid native row ${line}`);
      return {
        pid: Number(fields[0]),
        parent: Number(fields[1]),
        group: Number(fields[2]),
        birth: fields.slice(3, 8).join(" "),
        state: fields[8] ?? "",
      };
    });
}

/** Text a stream produced, and its size in bytes. */
interface Captured {
  readonly text: string;
  readonly bytes: number;
}

/**
 * Collect one census stream, refusing it whole once it passes its cap.
 * The two streams share {@link MAX_CAPTURE_BYTES} as two equal halves, so
 * together they never exceed it, and a valid prefix is never accepted.
 * @param stream - The census child's stdout or stderr
 * @returns Everything the stream carried, once it ends
 */
async function capped(stream: Readable): Promise<string> {
  const limit = MAX_CAPTURE_BYTES / 2;
  const captured = await stream.reduce(
    (sofar: Captured, chunk: Buffer): Captured => {
      if (sofar.bytes + chunk.length > limit)
        throw new Error(
          `${CENSUS_LABEL}: capture exceeded ${MAX_CAPTURE_BYTES} byte limit`
        );
      return {
        text: sofar.text + chunk.toString(),
        bytes: sofar.bytes + chunk.length,
      };
    },
    { text: "", bytes: 0 }
  );
  return captured.text;
}

/**
 * Settle with the census child's exit, or reject when it could not run.
 * @param child - The running census child
 * @returns Its exit status and signal
 */
function exited(child: ChildProcessByStdio<null, Readable, Readable>): Promise<{
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve, reject) => {
    child.once("error", error =>
      reject(new Error(`${CENSUS_LABEL}: ${error.message}`))
    );
    child.once("close", (status, signal) => resolve({ status, signal }));
  });
}

/**
 * Reject once the census has run past its budget.
 * @param child - The running census child; its close cancels the timer
 * @param timeout - Budget in milliseconds
 * @returns A promise that only ever rejects
 */
function expiry(
  child: ChildProcessByStdio<null, Readable, Readable>,
  timeout: number
): Promise<never> {
  return new Promise((_resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${CENSUS_LABEL}: timeout after ${timeout}ms`)),
      timeout
    );
    child.once("close", () => clearTimeout(timer));
  });
}

/**
 * Read the bounded native census without blocking marker timers.
 * @returns Complete identities; timeout, truncation and native errors reject.
 */
export async function census(): Promise<readonly Identity[]> {
  const timeout = ioLatencyBudgetMs(1_000);
  const child = spawn("/bin/ps", ["-axo", "pid=,ppid=,pgid=,lstart=,stat="], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    killSignal: "SIGKILL",
  });
  const completed = Promise.all([
    capped(child.stdout),
    capped(child.stderr),
    exited(child),
  ]).then(([output, stderr, { status, signal }]) => {
    assertChildCompleted({ signal }, CENSUS_LABEL);
    if (status !== 0)
      throw new Error(`${CENSUS_LABEL}: exit ${status}: ${stderr}`);
    return parseCensus(output);
  });
  try {
    return await Promise.race([completed, expiry(child, timeout)]);
  } catch (error) {
    // Incomplete evidence: cancel only this live child handle.
    child.kill("SIGKILL");
    child.stdout.destroy();
    child.stderr.destroy();
    throw error;
  }
}

/** Every process proven to descend from one fresh detached leader. */
export interface Ownership {
  readonly leader: number;
  readonly owned: ReadonlyMap<number, Identity>;
}

/**
 * Ownership of a leader before anything has been observed.
 * @param leader - Detached process launched by this exact fixture
 * @returns Empty ownership of that leader
 */
export function ownershipOf(leader: number): Ownership {
  return { leader, owned: new Map() };
}

/**
 * Walk the observed tree outward from the owned parents. Each step adds at
 * least one new pid or stops, so it is bounded by the census size.
 * @param processes - One complete census
 * @param known - Pids already proven owned
 * @param found - Descendant identities discovered so far
 * @returns Every descendant reachable from the owned parents
 */
function descendants(
  processes: readonly Identity[],
  known: ReadonlySet<number>,
  found: readonly Identity[]
): readonly Identity[] {
  const newlyOwned = processes.filter(
    item => known.has(item.parent) && !known.has(item.pid)
  );
  return newlyOwned.length === 0
    ? found
    : descendants(
        processes,
        new Set([...known, ...newlyOwned.map(item => item.pid)]),
        [...found, ...newlyOwned]
      );
}

/**
 * Extend ownership only through matching observed parent identities.
 * @param ownership - What was proven owned before this census
 * @param processes - One complete census
 * @returns Ownership extended by this census
 */
function extendOwnership(
  ownership: Ownership,
  processes: readonly Identity[]
): Ownership {
  const { leader } = ownership;
  const root = processes.find(item => item.pid === leader);
  if (
    !ownership.owned.has(leader) &&
    (!root || root.group !== leader || root.parent !== process.pid)
  )
    throw new Error(
      `${CENSUS_LABEL}: fresh detached leader identity unavailable`
    );
  const known: ReadonlyMap<number, Identity> =
    ownership.owned.has(leader) || root === undefined
      ? ownership.owned
      : new Map([...ownership.owned, [root.pid, root]]);
  const parents = new Set(
    processes
      .filter(
        item =>
          known.get(item.pid)?.birth === item.birth &&
          known.get(item.pid)?.group === item.group
      )
      .map(item => item.pid)
  );
  return {
    leader,
    owned: new Map([
      ...known,
      ...descendants(processes, parents, []).map(
        item => [item.pid, item] as const
      ),
    ]),
  };
}

/**
 * Take a census and extend ownership with it.
 * @param ownership - What was proven owned before
 * @returns Ownership extended by a fresh census
 */
export async function observeOwnership(
  ownership: Ownership
): Promise<Ownership> {
  return extendOwnership(ownership, await census());
}

/**
 * A remembered PID proves life only when birth and group still match.
 * @param ownership - What was proven owned
 * @returns Still-live matching identities, excluding terminated zombies.
 */
export async function liveOwned(
  ownership: Ownership
): Promise<readonly Identity[]> {
  return (await census()).filter(item => {
    const prior = ownership.owned.get(item.pid);
    return (
      prior?.birth === item.birth &&
      prior.group === item.group &&
      !item.state.startsWith("Z")
    );
  });
}

/**
 * Kill every still-live owned process group, rechecking each group with a
 * fresh census just before signalling it.
 * @param ownership - What was proven owned
 */
export async function drainOwnership(ownership: Ownership): Promise<void> {
  for (const group of new Set(
    (await liveOwned(ownership)).map(item => item.group)
  )) {
    // Re-read just before signaling, and require a live matching member.
    if (!(await liveOwned(ownership)).some(item => item.group === group))
      continue;
    try {
      process.kill(-group, "SIGKILL");
    } catch {
      /* terminal race */
    }
  }
}

/** Census sampling interval while a tracked dispatcher runs, start to start. */
export const CENSUS_INTERVAL_MS = 100;

/** What {@link trackOwnership} watches, and the seams its tests replace. */
export interface TrackOptions {
  /** Settles when the dispatcher closes. */
  readonly closed: Promise<unknown>;
  /** Set once the outer watchdog fires. */
  readonly timedOut: Latch<boolean>;
  /** Take one census and extend ownership; the real census by default. */
  readonly observe?: (ownership: Ownership) => Promise<Ownership>;
  /** Kill the owned tree; the real drain by default. */
  readonly drain?: (ownership: Ownership) => Promise<void>;
  /** Monotonic clock in milliseconds; `performance.now` by default. */
  readonly now?: () => number;
  /** Wait this many milliseconds; a real timer by default. */
  readonly wait?: (ms: number) => Promise<unknown>;
}

/**
 * Census the dispatcher's process tree on a fixed
 * {@link CENSUS_INTERVAL_MS} cadence until it closes, draining the tree once
 * after the watchdog has fired.
 *
 * Censuses start a fixed interval apart, measured start to start, so a slow
 * census never stretches the gap that a short-lived helper could slip
 * through. A census that outlasts the interval is followed by the next one
 * at once, never by a second one alongside it. Each census's ownership is
 * handed to the next, so the tree's record is a value this returns. A census
 * failure rejects, and the caller stops the dispatcher: observation fails
 * closed. Shorter-lived children can still evade sampling; empty evidence is
 * not universal proof.
 * @param ownership - What earlier censuses proved owned
 * @param options - What to watch, and replaceable seams
 * @returns Ownership as of the last census before the dispatcher closed
 */
export function trackOwnership(
  ownership: Ownership,
  options: TrackOptions
): Promise<Ownership> {
  const now = options.now ?? (() => performance.now());
  return trackFrom(ownership, options, now(), false);
}

/**
 * One census tick of {@link trackOwnership}.
 * @param ownership - What earlier censuses proved owned
 * @param options - What to watch, and replaceable seams
 * @param startedAt - When this tick's census started
 * @param drained - Whether the watchdog drain already ran
 * @returns Ownership as of the last census before the dispatcher closed
 */
async function trackFrom(
  ownership: Ownership,
  options: TrackOptions,
  startedAt: number,
  drained: boolean
): Promise<Ownership> {
  const now = options.now ?? (() => performance.now());
  const next = await (options.observe ?? observeOwnership)(ownership);
  const drainNow = !drained && (await options.timedOut.read(false));
  if (drainNow) await (options.drain ?? drainOwnership)(next);
  const finished = await Promise.race([
    options.closed.then(
      () => true,
      () => true
    ),
    (options.wait ?? delay)(
      Math.max(0, startedAt + CENSUS_INTERVAL_MS - now())
    ).then(() => false),
  ]);
  return finished
    ? next
    : trackFrom(
        next,
        options,
        Math.max(startedAt + CENSUS_INTERVAL_MS, now()),
        drained || drainNow
      );
}
