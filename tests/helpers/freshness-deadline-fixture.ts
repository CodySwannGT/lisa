/**
 * Real dispatcher observations with an independently owned outer detector.
 * Supervisor children are tracked by ancestry and birth, never by name alone.
 * @module tests/helpers/freshness-deadline-fixture
 */
import { spawn } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { DeadlineFixture } from "./freshness-deadline-inputs.js";
import {
  prepareDeadline,
  deadlineEnvironment,
} from "./freshness-deadline-inputs.js";
import { ownedProcesses } from "./freshness-owned-processes.js";
import { hostState } from "./host-guard-freshness-fixtures.js";
import { ioLatencyBudgetMs, workerSpawnSlowdown } from "./io-latency-budget.js";

/** A marker-backed real-process observation, including cleanup evidence. */
export interface DeadlineObservation {
  readonly status: number | null;
  readonly output: string;
  readonly entered: boolean;
  readonly timedOut: boolean;
  readonly elapsedMs: number;
  readonly guards: readonly string[];
  readonly survivingPids: readonly number[];
  readonly stateUnchanged: boolean;
  readonly diagnosticMs: number | null;
  readonly ownedPids: readonly number[];
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

/** Event state is necessarily updated while the real fixture runs. */
interface Capture {
  output: string;
  enteredAt: number | null;
  guardAt: number | null;
  timedOut: boolean;
  observerFailure?: unknown;
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
  owned: ReturnType<typeof ownedProcesses>,
  start: number
): Promise<DeadlineObservation> {
  const survivors = await owned.active();
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
    censusIntervalMs: 100,
    helperPids,
    unobservedHelperPids: helperPids.filter(
      pid => !owned.captured().includes(pid)
    ),
    entered: readFileSync(fixture.entries, "utf8").length > 0,
    timedOut: state.timedOut,
    elapsedMs: performance.now() - start,
    guards: readFileSync(fixture.guards, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean),
    survivingPids: survivors,
    ownedPids: owned.captured(),
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
  if (survivors.length) await owned.drain();
  return result;
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
  const state: Capture = {
    output: "",
    enteredAt: null,
    guardAt: null,
    timedOut: false,
  };
  const child = spawn("/bin/bash", [fixture.driver], {
    cwd: fixture.root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: deadlineEnvironment(fixture, mode),
  });
  if (child.pid === undefined) throw new Error("dispatcher did not launch");
  const owned = ownedProcesses(child.pid);
  /** Capture real helper entry and first genuine guard execution. */
  const poll = (): void => {
    /* eslint-disable functional/immutable-data -- these event timestamps record mutable OS observations */
    if (readFileSync(fixture.entries, "utf8") && state.enteredAt === null)
      state.enteredAt = performance.now();
    if (readFileSync(fixture.guards, "utf8") && state.guardAt === null)
      state.guardAt = performance.now();
    /* eslint-enable functional/immutable-data -- all other fixture values remain immutable */
  };
  const interval = setInterval(poll, 20);
  /** Keep native census work outside the fast marker-file timing loop. */
  const observe = (): void => {
    void owned.observe().catch(error => {
      // eslint-disable-next-line functional/immutable-data -- preserve the actual observer failure instead of accepting empty evidence
      state.observerFailure = error;
      child.kill("SIGKILL");
    });
  };
  // One pending census is shared inside ownedProcesses. Shorter-lived children
  // can evade this 100ms sampling interval; empty evidence is not universal proof.
  const censusInterval = setInterval(observe, 100);
  const detector = setTimeout(() => {
    // eslint-disable-next-line functional/immutable-data -- the live outer detector records its actual expiry
    state.timedOut = true;
    poll();
    void owned.drain().catch(error => {
      // eslint-disable-next-line functional/immutable-data -- an unknown cleanup census must fail the actual observation
      state.observerFailure = error;
      child.kill("SIGKILL");
    });
  }, ioLatencyBudgetMs(5_000));
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  /* eslint-disable functional/immutable-data -- captured stream data is accumulated until the real process closes */
  child.stdout.on("data", chunk => (state.output += String(chunk)));
  child.stderr.on("data", chunk => (state.output += String(chunk)));
  /* eslint-enable functional/immutable-data -- no state writes after process completion */
  observe();
  return closed
    .finally(() => {
      clearTimeout(detector);
      clearInterval(interval);
      clearInterval(censusInterval);
    })
    .then(async status => {
      // Wait for the last pending census, then take a fresh completion snapshot.
      await owned.observe();
      if (state.observerFailure !== undefined) throw state.observerFailure;
      poll();
      return summarize(fixture, state, status, owned, start);
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
