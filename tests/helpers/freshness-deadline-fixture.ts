/**
 * Real dispatcher observations with an independently owned outer detector.
 * Supervisor children are tracked by ancestry and birth, never by name alone.
 * @module tests/helpers/freshness-deadline-fixture
 */
import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { Readable } from "node:stream";
import type { DeadlineFixture } from "./freshness-deadline-inputs.js";
import {
  prepareDeadline,
  deadlineEnvironment,
} from "./freshness-deadline-inputs.js";
import {
  CENSUS_INTERVAL_MS,
  drainOwnership,
  liveOwned,
  observeOwnership,
  ownershipOf,
  trackOwnership,
} from "./freshness-owned-processes.js";
import type { Identity, Ownership } from "./freshness-owned-processes.js";
import { hostState } from "./host-guard-freshness-fixtures.js";
import { ioLatencyBudgetMs, workerSpawnSlowdown } from "./io-latency-budget.js";
import { latch } from "./latch.js";

/** Sentinel for "no observer failure", distinct from any thrown value. */
const NO_FAILURE: unique symbol = Symbol("no observer failure");

/** A marker-backed real-process observation, including cleanup evidence. */
export interface DeadlineObservation {
  readonly status: number | null;
  readonly output: string;
  readonly entered: boolean;
  readonly timedOut: boolean;
  readonly elapsedMs: number;
  readonly guards: readonly string[];
  readonly phases: readonly string[];
  readonly survivingPids: readonly number[];
  readonly stateUnchanged: boolean;
  readonly diagnosticMs: number | null;
  readonly ownedPids: readonly number[];
  readonly ownedIdentities: readonly Identity[];
  readonly foreignSentinelUnchanged: boolean;
  readonly diagnosticScratchLeaves: readonly DiagnosticLeaf[];
  readonly watchdogMs: number;
  readonly spawnSlowdown: number;
  readonly censusIntervalMs: number;
  readonly helperPids: readonly number[];
  readonly unobservedHelperPids: readonly number[];
}

/** Actual diagnostic leaves still present before fixture teardown. */
interface DiagnosticLeaf {
  readonly name: string;
  readonly device: number;
  readonly inode: number;
  readonly mode: number;
  readonly entries: readonly string[] | null;
}

/**
 * Inspect only diagnostic leaves under this fixture's owned scratch directory.
 * @param scratch Private fixture scratch parent.
 * @returns Leaf identities before broad fixture cleanup can hide a leak.
 */
function diagnosticLeaves(scratch: string): readonly DiagnosticLeaf[] {
  return readdirSync(scratch)
    .filter(name => name.startsWith("lisa-freshness."))
    .map(name => {
      const leaf = path.join(scratch, name);
      const info = lstatSync(leaf);
      return {
        name,
        device: info.dev,
        inode: info.ino,
        mode: info.mode & 0o777,
        entries: info.isDirectory() ? readdirSync(leaf) : null,
      };
    });
}

/** What the run observed, read once the dispatcher has closed. */
interface Capture {
  readonly output: string;
  readonly enteredAt: number | null;
  readonly guardAt: number | null;
  readonly timedOut: boolean;
}

/**
 * Normalize completed observation after checking still-live identities.
 * @param fixture Owned on-disk fixture.
 * @param state Actual accumulated process observations.
 * @param status Native dispatcher status.
 * @param owned Birth-bound ownership registry.
 * @param start Monotonic launch time.
 * @returns Result before any emergency cleanup of a failed control.
 */
async function summarize(
  fixture: DeadlineFixture,
  state: Capture,
  status: number | null,
  owned: Ownership,
  start: number
): Promise<DeadlineObservation> {
  const survivors = (await liveOwned(owned)).map(item => item.pid);
  const captured = [...owned.owned.keys()];
  const helperPids = readFileSync(fixture.entries, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(Number);
  const result = {
    status,
    output: state.output,
    diagnosticScratchLeaves: diagnosticLeaves(fixture.scratch),
    watchdogMs: ioLatencyBudgetMs(5_000),
    spawnSlowdown: workerSpawnSlowdown(),
    censusIntervalMs: CENSUS_INTERVAL_MS,
    helperPids,
    unobservedHelperPids: helperPids.filter(pid => !captured.includes(pid)),
    entered: readFileSync(fixture.entries, "utf8").length > 0,
    timedOut: state.timedOut,
    elapsedMs: performance.now() - start,
    guards: readFileSync(fixture.guards, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean),
    phases: readFileSync(fixture.phases, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean),
    survivingPids: survivors,
    ownedPids: captured,
    ownedIdentities: [...owned.owned.values()],
    foreignSentinelUnchanged:
      readFileSync(path.join(fixture.scratch, "foreign-sentinel"), "utf8") ===
      "preserve unrelated fixture state\n",
    stateUnchanged:
      JSON.stringify(fixture.before) ===
      JSON.stringify(hostState(fixture.root)),
    diagnosticMs:
      state.enteredAt === null || state.guardAt === null
        ? null
        : state.guardAt - state.enteredAt,
  };
  if (survivors.length) await drainOwnership(owned);
  return result;
}

/**
 * Everything a child writes to stdout and stderr, in arrival order.
 * Both streams feed one pipe, which ends once the child has closed and so
 * has flushed both.
 * @param child - Running child with piped stdout and stderr
 * @returns The interleaved output, once the child has closed
 */
async function interleavedOutput(
  child: ChildProcessByStdio<null, Readable, Readable>
): Promise<string> {
  const merged = new PassThrough();
  child.stdout.pipe(merged, { end: false });
  child.stderr.pipe(merged, { end: false });
  child.once("close", () => merged.end());
  return (await merged.toArray()).map(String).join("");
}

/**
 * Capture the actual process with a calibrated five-second base completion
 * watchdog. The diagnostic boundary retains its unscaled three-second assertion.
 * @param fixture Prepared real-guard inputs.
 * @param mode Optional diagnostic injection.
 * @returns Native result with positively owned process observations.
 */
async function captureDeadline(
  fixture: DeadlineFixture,
  mode: string
): Promise<DeadlineObservation> {
  const start = performance.now();
  const entered = latch<number | null>();
  const guarded = latch<number | null>();
  const timedOut = latch<boolean>();
  const child = spawn("/bin/bash", [fixture.driver], {
    cwd: fixture.root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: deadlineEnvironment(fixture, mode),
  });
  if (child.pid === undefined) throw new Error("dispatcher did not launch");
  const output = interleavedOutput(child);
  /** Capture real helper entry and first genuine guard execution. */
  const poll = (): void => {
    if (readFileSync(fixture.entries, "utf8")) entered.set(performance.now());
    if (readFileSync(fixture.guards, "utf8")) guarded.set(performance.now());
  };
  const interval = setInterval(poll, 20);
  const detector = setTimeout(() => {
    timedOut.set(true);
    poll();
  }, ioLatencyBudgetMs(5_000));
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  // A census failure stops the dispatcher it was watching and is reported
  // once it has closed; settling it here keeps the rejection handled.
  const tracked = trackOwnership(ownershipOf(child.pid), {
    closed,
    timedOut,
  }).then(
    ownership => ({ ownership, failure: NO_FAILURE }) as const,
    (failure: unknown) => {
      child.kill("SIGKILL");
      return { ownership: undefined, failure } as const;
    }
  );
  return closed
    .finally(() => {
      clearTimeout(detector);
      clearInterval(interval);
    })
    .then(async status => {
      const { ownership, failure } = await tracked;
      if (ownership === undefined) throw failure;
      // A fresh completion snapshot after the dispatcher has closed.
      const final = await observeOwnership(ownership);
      poll();
      const capture: Capture = {
        output: await output,
        enteredAt: await entered.read(null),
        guardAt: await guarded.read(null),
        timedOut: await timedOut.read(false),
      };
      return summarize(fixture, capture, status, final, start);
    });
}

/**
 * Drive file-backed hook JSON and report the optional boundary's real effects.
 * @param mode Fault confined to the optional diagnostic command.
 * @param allowed Use a genuine permitted payload rather than the real refusal.
 * @returns Complete captured observation after positively owned cleanup.
 */
export async function observeDeadline(
  mode = "stall",
  allowed = false
): Promise<DeadlineObservation> {
  const result = await captureDeadline(prepareDeadline(mode, allowed), mode);
  // The ordinary wrapper may suppress successful console.log output. Write
  // the actual observation to its captured stream so passing proof survives.
  process.stdout.write(
    `DEADLINE_OBSERVATION ${JSON.stringify({ mode, allowed, ...result })}\n`
  );
  return result;
}
