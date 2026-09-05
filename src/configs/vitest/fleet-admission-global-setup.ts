/**
 * Vitest `globalSetup` that holds a run back until the fleet has room for it.
 *
 * This is the executable half of {@link module:configs/vitest/fleet-admission}.
 * The decision itself is pure and lives there; this file supplies the clock, the
 * directory listing and the sleep, and is deliberately the only part with side
 * effects.
 *
 * ## Why globalSetup and not the config factory
 *
 * `resolveMaxWorkers` runs while Vitest is building its config, and that path is
 * synchronous — a wait there would have to be a busy loop. `globalSetup` is
 * async by contract and runs after the config resolves but before any worker
 * executes a test file, which is exactly the moment the demand this bounds is
 * about to be created. A run held here has one idle main process; a run not held
 * here has a whole pool.
 *
 * ## Why this cannot wedge the fleet
 *
 * Admission is by rank among live run roots ordered oldest-first, so the
 * `capacity` oldest runs always admit and the queue always drains. On top of
 * that every unknown admits and the wait is bounded — the full argument is in
 * the module docstring next door. The failure this is designed against is not
 * "too many runs", it is "a control that stops a run from ever happening".
 * @module configs/vitest/fleet-admission-global-setup
 */
import { availableParallelism } from "node:os";
import { env, stderr } from "node:process";

import { liveFleetRunRootNames, ownRunRootBasename } from "./base.js";
import {
  ADMISSION_POLL_MS,
  type AdmissionVerdict,
  admissionDeadlineMs,
  admissionEnabled,
  admissionRank,
  admissionVerdict,
  fleetCapacity,
  readFleetRunRoots,
} from "./fleet-admission.js";

/**
 * Sleep for one poll interval.
 * @param ms - Milliseconds to wait.
 * @returns A promise that settles after the interval.
 */
const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

/** Seams so a test can state a fleet and a clock instead of creating them. */
export interface AdmissionRuntime {
  /** Live run-root basenames across every namespace worth counting. */
  readonly liveNames: () => readonly string[];
  /** This run's own root basename, when it is supervised. */
  readonly selfBasename: () => string | undefined;
  /** Logical cores available. */
  readonly cores: () => number;
  /** Wall clock in milliseconds. */
  readonly now: () => number;
  /** Wait for one poll interval. */
  readonly wait: (ms: number) => Promise<void>;
  /** Where a notice goes. */
  readonly announce: (line: string) => void;
  /** Environment holding the switches. */
  readonly environment: NodeJS.ProcessEnv;
}

/**
 * The runtime a real run uses.
 * @returns Seams bound to this machine.
 */
const defaultRuntime = (): AdmissionRuntime => ({
  liveNames: () => liveFleetRunRootNames(),
  selfBasename: ownRunRootBasename,
  cores: availableParallelism,
  now: () => Date.now(),
  wait: sleep,
  announce: line => {
    stderr.write(`${line}\n`);
  },
  environment: env,
});

/**
 * Ask once whether this run may execute now.
 * @param runtime - Injected seams.
 * @param startedAt - When this run began waiting.
 * @returns The verdict for this attempt.
 */
function attempt(
  runtime: AdmissionRuntime,
  startedAt: number
): AdmissionVerdict {
  const roots = readFleetRunRoots(runtime.liveNames());
  return admissionVerdict({
    rank: admissionRank(roots, runtime.selfBasename()),
    capacity: fleetCapacity(runtime.cores()),
    liveRuns: roots.length,
    elapsedMs: runtime.now() - startedAt,
    deadlineMs: admissionDeadlineMs(runtime.environment),
    enabled: admissionEnabled(runtime.environment),
  });
}

/**
 * Poll until this run is admitted, announcing only when the news changes.
 *
 * The queue notice is printed on the FIRST wait and the over-capacity notice on
 * admission; the polling in between says nothing. An operator needs to know a
 * run is queued and needs to know if it started anyway, and a line every two
 * seconds would bury both.
 *
 * Recursive rather than looping: each call is separated by an `await`, so the
 * synchronous stack does not grow, and the shape states "one attempt, then the
 * rest" instead of carrying mutable poll state.
 * @param runtime - Injected seams.
 * @param startedAt - When this run began waiting.
 * @param announced - Whether the queue notice has already been printed.
 * @returns The verdict this run was admitted under.
 */
async function poll(
  runtime: AdmissionRuntime,
  startedAt: number,
  announced: boolean
): Promise<AdmissionVerdict> {
  const verdict = attempt(runtime, startedAt);
  if (verdict.admitted) {
    if (verdict.notice !== "") runtime.announce(verdict.notice);
    return verdict;
  }
  if (!announced) runtime.announce(verdict.notice);
  await runtime.wait(ADMISSION_POLL_MS);
  return poll(runtime, startedAt, true);
}

/**
 * Hold this run until the fleet has room, or until the deadline expires.
 *
 * Any throw admits. This executes before a single test does, so an exception
 * here would prevent a run rather than degrade one, and no load control is
 * worth that.
 * @param runtime - Injected seams; defaults to the real machine.
 * @returns The verdict this run was admitted under.
 */
export async function awaitFleetAdmission(
  runtime: AdmissionRuntime = defaultRuntime()
): Promise<AdmissionVerdict> {
  try {
    return await poll(runtime, runtime.now(), false);
  } catch {
    return { decision: "admit-unranked", admitted: true, notice: "" };
  }
}

/**
 * Vitest global setup hook.
 * @returns A promise that settles once this run is admitted.
 */
export const setup = async (): Promise<void> => {
  await awaitFleetAdmission();
};
