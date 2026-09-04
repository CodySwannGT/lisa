/**
 * Vitest Configuration - Per-process scratch redirection (setup file)
 *
 * Wired as a Vitest `setupFiles` entry, so it executes inside every test worker
 * before any test file runs. It points `os.tmpdir()` at a run root this process
 * owns, which relocates EVERY `mkdtemp(os.tmpdir())` call in the suite without
 * editing a single test — in Lisa's own suite, 481 call sites across 211 files.
 *
 * `os.tmpdir()` re-reads the environment on every call rather than caching it at
 * startup, which is the seam this relies on:
 *
 * ```
 * $ node -e 'const os=require("os"); console.log(os.tmpdir());
 *            process.env.TMPDIR="/tmp/probe"; console.log(os.tmpdir())'
 * /var/folders/<...>/T
 * /tmp/probe
 * ```
 *
 * A signalled exit is covered too, which is not obvious and is the whole of
 * CodySwannGT/lisa#2950: see the signal handlers in `installScratchRoot`.
 *
 * Because the assignment mutates the process environment, subprocesses the
 * tests spawn inherit the redirection too — a fixture's `git`, `npm pack` or
 * `tsc` child writes into the same bounded root, so a child that outlives its
 * test cannot leak into the shared directory either.
 *
 * The work is done once per process, not once per test file, even though Vitest
 * re-executes setup files for each file.
 *
 * A run supervised by `lisa-test-run` inherits its suite lease from the
 * environment. A direct `vitest` invocation has no lease and mints its own
 * rather than refusing — see `acquireSuiteLease` for why refusing was the wrong
 * failure mode for a module that runs during collection.
 * @see {@link module:configs/vitest/scratch} for why the root is shaped this way
 * @module configs/vitest/scratch-setup
 */
import { env } from "node:process";

import {
  SCRATCH_SUPERVISION_LEASE_ENV,
  createScratchSupervisionLease,
  createSupervisedWorkerScope,
  parseScratchSupervisionLease,
  removeSupervisedWorkerScope,
  type ScratchSupervisionLeaseV1,
  type SupervisedWorkerScope,
} from "./scratch-supervision.js";
import { assertScratchRouteProfile } from "./scratch-route-profile.js";
import {
  materializeOwnedScratchRunRoot,
  prepareOwnedScratchRunRoot,
  removeOwnedScratchRunRoot,
  type ScratchRunRootIntentV1,
} from "./scratch-run-root-intent.js";

/**
 * Signals a worker is reaped with, each of which skips `exit` by default.
 *
 * `SIGTERM` is the one measured in this repository — it is how vitest's
 * `forks` pool ends a worker. `SIGINT` and `SIGHUP` are here because they
 * reach the same process by the same route with the same default action: an
 * operator pressing ctrl-C, and a terminal closing on a run left going. A
 * handler that covered only the case that happened to be measured would leave
 * the other two producing exactly the residue this removes.
 *
 * `SIGKILL` is deliberately absent — it cannot be caught in this worker. The
 * detached `lisa-test-run` reaper owns that arm; reclaim-on-start remains the
 * compatibility fallback and is tested separately.
 */
const REAPING_SIGNALS: readonly NodeJS.Signals[] = [
  "SIGTERM",
  "SIGINT",
  "SIGHUP",
];

/** Key under which the per-process run root is memoised. */
const RUN_ROOT_KEY = "__lisaScratchRunRoot__";

/** Key holding the authority/token handle while preserving the path memo ABI. */
const RUN_ROOT_HANDLE_KEY = "__lisaScratchWorkerScopeV1__";

/**
 * Warning printed once when a run mints its own lease instead of inheriting one.
 *
 * It names the wrapper, because adopting the wrapper is the fix, and it names
 * what is actually given up — the detached reaper, and nothing else — so the
 * line cannot be read as "your scratch directories are unbounded now".
 */
const UNSUPERVISED_WARNING =
  "lisa scratch: no supervised lease in the environment, so this run is " +
  "self-supervised. Fixture directories are still bounded to a run root this " +
  "process owns and removed on exit; what is missing is the detached reaper " +
  "that reclaims the root after a SIGKILL, which the next run's startup sweep " +
  "recovers instead. Run through `lisa-test-run --profile <profile> " +
  "--adapter vitest -- vitest ...` for a supervised run.\n";

/** `globalThis` widened with the memo slot this module owns. */
type ScratchGlobal = typeof globalThis & {
  /** Run root allocated by the first execution of this module in the process */
  [RUN_ROOT_KEY]?: string;
  /** Authority handle paired with the source/dist-compatible path memo */
  [RUN_ROOT_HANDLE_KEY]?: SupervisedWorkerScope;
};

/**
 * Tear down this worker's scope without letting the attempt change the outcome.
 *
 * `removeSupervisedWorkerScope` validates the suite root OUTSIDE its own
 * try/catch, so a suite root that has gone missing throws straight out of it.
 * Unguarded, that throw lands in a `process.on("exit")` listener -- where node
 * turns it into an uncaught exception and rewrites the exit code, so a green
 * run reports as a failed one -- or in a reaping-signal listener, BEFORE the
 * re-raise below, so the worker never dies of the signal the pool sent and the
 * pool sees the wrong status. Cleanup is best-effort by construction: it must
 * never be the thing that decides how this process ends. The failure is still
 * reported, because a silent one is how the leak this file exists to close
 * came back the first time.
 *
 * The suite root is removed only when this process minted its own lease. Under
 * a wrapper the suite root belongs to `lisa-test-run`, which reclaims it for
 * every worker at once; a worker removing it there would pull the directory out
 * from under its siblings.
 * @param worker - This worker's supervised scope
 * @param lease - The suite lease the scope was created under
 * @param ownedSuiteRoot - Suite root this process minted, when self-supervised
 */
const teardownWorkerScope = (
  worker: SupervisedWorkerScope,
  lease: ScratchSupervisionLeaseV1,
  ownedSuiteRoot?: ScratchRunRootIntentV1
): void => {
  try {
    removeSupervisedWorkerScope(worker, lease);
  } catch (error) {
    process.stderr.write(
      `lisa scratch worker teardown failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
  if (ownedSuiteRoot === undefined) return;
  try {
    removeOwnedScratchRunRoot(ownedSuiteRoot);
  } catch (error) {
    process.stderr.write(
      `lisa scratch suite teardown failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
};

/** A usable suite lease, plus the suite root this process must reclaim itself. */
export interface AcquiredSuiteLease {
  readonly lease: ScratchSupervisionLeaseV1;
  /** Set only when this process minted the lease and therefore owns the root. */
  readonly ownedSuiteRoot?: ScratchRunRootIntentV1;
}

/**
 * Obtain the suite lease, minting one when the environment carries none.
 *
 * An inherited lease is the supervised case and is preferred whenever it is
 * present. Its absence means someone ran `vitest` directly, which is an
 * ordinary thing to do — from an editor, a watch mode, a CI step that predates
 * the wrapper — and it used to throw out of a `setupFiles` module. A throw
 * there fails collection, so the suite reports zero tests and a gate goes red
 * having evaluated nothing. That is a worse outcome than an unsupervised run:
 * it looks like a verdict and is not one.
 *
 * So the unsupervised caller gets the same lifecycle, self-supervised. The
 * minted lease is a real lease over a real owned root, which keeps the rest of
 * this file — and the leak guard in `scratch-leak-setup`, which requires a
 * `worker-` scope — on exactly one code path. The single capability the wrapper
 * adds is the detached reaper covering `SIGKILL`; without it, reclaim-on-start
 * recovers the residue at the next run, which is the documented fallback.
 *
 * Exported for its own unit case. `installScratchRoot()` cannot stand in for
 * it: that function registers `exit` and signal handlers on the process it is
 * called from, so a case that drove the unsupervised branch through it would
 * leave a handler behind pointing at a root the case had already cleaned up,
 * and every later suite in the same worker would inherit the noise.
 * @returns The lease to run under, and the suite root to reclaim if self-owned.
 */
export const acquireSuiteLease = (): AcquiredSuiteLease => {
  const rawLease = env[SCRATCH_SUPERVISION_LEASE_ENV];
  if (rawLease !== undefined && rawLease !== "") {
    return { lease: parseScratchSupervisionLease(rawLease) };
  }

  const intent = prepareOwnedScratchRunRoot();
  const lease = (() => {
    process.stderr.write(UNSUPERVISED_WARNING);
    materializeOwnedScratchRunRoot(intent);
    return createScratchSupervisionLease(intent, {
      suiteLabel: intent.suiteLabel,
      registeredPrefixes: intent.registeredPrefixes,
    });
  })();
  return { lease, ownedSuiteRoot: intent };
};

/**
 * Points this process's temp directory at a run root it owns, creating the root
 * on first call and reusing it afterwards.
 *
 * All three of `TMPDIR`, `TMP` and `TEMP` are set: Node reads `TMPDIR` on POSIX
 * and `TEMP`/`TMP` on Windows, and non-Node tools spawned by fixtures read
 * whichever their platform prefers. Setting one would leave the others pointing
 * at the shared directory for exactly the callers hardest to see.
 * @returns Absolute path of this process's run root.
 */
export const installScratchRoot = (): string => {
  const scope = globalThis as ScratchGlobal;
  const existing = scope[RUN_ROOT_KEY];
  if (existing !== undefined && scope[RUN_ROOT_HANDLE_KEY] !== undefined) {
    return existing;
  }

  const { lease, ownedSuiteRoot } = acquireSuiteLease();
  const worker = (() => {
    // Only an INHERITED lease is worth asserting against. The check exists to
    // catch a Vitest environment that disagrees with the profile the wrapper
    // froze before collection — two independent sources that must agree. A
    // self-minted lease is derived from that same environment one line earlier,
    // so the comparison is vacuous, and it does not merely pass vacuously: the
    // assertion demands `LISA_TEST_SCRATCH_SUITE` be set, which is the
    // wrapper's job, so an unsupervised run fails it every time. Running it
    // here would trade one collection-time throw for another.
    if (ownedSuiteRoot === undefined) assertScratchRouteProfile(lease);
    return createSupervisedWorkerScope(lease);
  })();
  const root = worker.path;

  scope[RUN_ROOT_KEY] = root;
  scope[RUN_ROOT_HANDLE_KEY] = worker;
  env["TMPDIR"] = root;
  env["TMP"] = root;
  env["TEMP"] = root;

  // Covers an ordinary exit, including one where tests failed.
  process.once("exit", () => {
    teardownWorkerScope(worker, lease, ownedSuiteRoot);
  });

  // And covers the exit this suite ACTUALLY takes, which is not an ordinary
  // one. Measured on vitest 4.1.9, `forks` pool, by recording every lifecycle
  // event a worker reaches: the pool ends a worker with SIGTERM, and node's
  // default action for SIGTERM terminates the process WITHOUT running `exit`
  // handlers. So the handler above — the only mechanism that removes a run's
  // own root — never ran for any worker, and a completely green run left its
  // root behind every time (CodySwannGT/lisa#2950).
  //
  // That was invisible for the usual reason: the next run's sweep reclaims a
  // root whose pid is dead, so the residue disappeared before anyone looked
  // for it, and the namespace never grew. The behaviour was reported as
  // present because its effect was eventually produced by something else.
  //
  // The same probe shows a worker DOES reach `exit` once a listener for the
  // signal exists, because installing one displaces node's default action.
  // Removing the listener and re-raising restores it, so the process still
  // dies of the signal it was sent, with the status the pool expects — this
  // buys the cleanup, not a different lifecycle.
  for (const signal of REAPING_SIGNALS) {
    process.once(signal, () => {
      teardownWorkerScope(worker, lease, ownedSuiteRoot);
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    });
  }

  return root;
};

installScratchRoot();
