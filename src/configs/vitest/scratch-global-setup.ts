/**
 * Vitest Configuration - Scratch namespace lifecycle (global setup)
 *
 * Runs once in the main Vitest process, on either side of the whole run.
 *
 * `setup` reclaims residue left by runs that were killed and then REFUSES TO
 * START a run whose namespace is accumulating — the accumulation being the
 * entire defect this exists to prevent, arriving one directory at a time.
 * `teardown` reclaims what this run allocated.
 *
 * The check is deliberately a hard failure. A previous version of this problem
 * was invisible for a working day because every instrument that met the
 * saturated directory returned something a caller could mistake for an answer:
 * an empty count, a dead process, a plausible duration. A guard that merely
 * printed a warning would reproduce exactly that.
 *
 * It lives in `setup` for a measured reason, not an aesthetic one. Vitest
 * SWALLOWS a throw from globalSetup teardown: it prints `error during close`
 * and the process still exits 0. The same throw from `setup` exits 1. Measured
 * both ways on vitest 4.1.9 rather than assumed —
 *
 * ```
 * teardown throws -> Test Files 1 passed ... error during close ...   exit 0
 * setup    throws -> Error: PROBE: setup refused to start the run     exit 1
 * ```
 *
 * — because the first draft of this module put the check in `teardown`, where
 * it reported a real overflow into a stream nothing gated on. A guard placed in
 * a hook the runner ignores is the exact defect this file was written to stop,
 * reproduced inside the guard itself.
 *
 * Checking at the start rather than the end costs nothing that matters: a run's
 * own residue is reclaimed by the next run's sweep, and the next run's check
 * sees whatever that sweep could not take. Accumulation is a trend, and a trend
 * is still visible one run later.
 * @see {@link module:configs/vitest/scratch} for the reclaim rules
 * @module configs/vitest/scratch-global-setup
 */
import { writeSync } from "node:fs";

import { env } from "node:process";

import {
  isProcessAlive,
  parseRunRootName,
  readNamespaceEntries,
  scratchNamespaceDir,
  sweepScratchNamespace,
} from "./scratch.js";

/**
 * Upper bound on entries the namespace may hold once a run has torn down.
 *
 * A run allocates one root per process — the main process plus one per worker —
 * and several runs share a workstation, so a healthy namespace legitimately
 * holds tens of entries while work is in flight. This ceiling is not a tuning
 * knob for that; it is the point past which the namespace is provably becoming
 * the very thing it replaced.
 */
export const MAX_NAMESPACE_ENTRIES = 512;

/** What an inspection of the namespace found. */
export interface NamespaceResidue {
  /** Entries whose owning process is gone but which were not removed */
  readonly orphaned: readonly string[];
  /** Entries that do not follow the run-root naming scheme at all */
  readonly unrecognised: readonly string[];
  /** Total entries present */
  readonly total: number;
}

/**
 * Classifies what is left in the namespace.
 *
 * `unrecognised` is the interesting bucket. The sweep identifies residue by
 * parsing the owning pid out of a directory's name, so a change to that naming
 * scheme does not break the sweep loudly — it makes the sweep silently match
 * nothing while continuing to report success. Naming that case separately turns
 * that regression into a failure instead of a slow leak.
 * @param dir - Namespace directory to inspect
 * @param alive - Liveness probe, overridable for tests
 * @returns The classified residue.
 */
export const inspectNamespace = (
  dir: string = scratchNamespaceDir(),
  alive: (pid: number) => boolean = isProcessAlive
): NamespaceResidue => {
  const entries = readNamespaceEntries(dir);

  return {
    orphaned: entries.filter(name => {
      const owner = parseRunRootName(name);
      return owner !== undefined && !alive(owner.pid);
    }),
    unrecognised: entries.filter(name => parseRunRootName(name) === undefined),
    total: entries.length,
  };
};

/**
 * Renders at most a handful of names for a failure message.
 * @param names - Offending entry names
 * @returns A comma-separated sample, elided beyond five.
 */
const sample = (names: readonly string[]): string =>
  names.slice(0, 5).join(", ") + (names.length > 5 ? ", …" : "");

/**
 * Builds the failure message for a namespace that is accumulating.
 *
 * Every branch names the directory and the offending entries, because the
 * failure this replaces was a 60-second timeout that named nothing.
 *
 * `unrecognised` is deliberately NOT a failure. It was, and it wedged: one
 * foreign directory in the namespace failed every subsequent run, forever, with
 * a message a downstream user could not act on. Those entries are reclaimed on
 * age by the sweep instead. What remains here are the two conditions that mean
 * this fix itself has stopped working — residue the sweep should have taken and
 * did not, and a namespace growing without bound.
 * @param dir - Namespace directory inspected
 * @param residue - What the inspection found
 * @returns The message, or `undefined` when the namespace is healthy.
 */
export const describeResidueFailure = (
  dir: string,
  residue: NamespaceResidue
): string | undefined => {
  if (residue.orphaned.length > 0) {
    return (
      `Test scratch namespace ${dir} still holds ${String(residue.orphaned.length)} ` +
      `root(s) whose owning process is gone, after a sweep that should have ` +
      `removed them: ${sample(residue.orphaned)}. Reclaim-on-start is not ` +
      `working, so a killed run's residue is now permanent.`
    );
  }

  if (residue.total > MAX_NAMESPACE_ENTRIES) {
    return (
      `Test scratch namespace ${dir} holds ${String(residue.total)} entries, past ` +
      `the ceiling of ${String(MAX_NAMESPACE_ENTRIES)}. Scratch space is ` +
      `accumulating rather than being reclaimed — the condition this guard ` +
      `exists to prevent.`
    );
  }

  return undefined;
};

/**
 * Sweeps the namespace and reports what survived.
 * @param dir - Namespace directory
 * @returns The residue remaining after the sweep.
 */
const sweepThenInspect = (dir: string): NamespaceResidue => {
  sweepScratchNamespace({ dir });
  return inspectNamespace(dir);
};

/**
 * Audits the namespace, tolerating a sibling run's worker exiting mid-audit.
 *
 * That worker's root becomes orphaned in the window between the sweep and the
 * inspection, through no fault of this run. Sweeping once more before treating
 * an orphan as a defect keeps a guard built to catch a permanent leak from
 * failing on a transient one.
 * @param dir - Namespace directory
 * @returns The residue to judge.
 */
const auditNamespace = (dir: string): NamespaceResidue => {
  const first = sweepThenInspect(dir);
  return first.orphaned.length > 0 ? sweepThenInspect(dir) : first;
};

/**
 * Renders the banner printed at the moment of refusal.
 *
 * A throw from `setup` exits 1, which is the half of the contract that works.
 * The other half did not: Vitest reports the throw as an unhandled error AFTER
 * the run summary, so what an operator actually saw, in order, was
 *
 * ```
 * line   5:  No test files found, exiting with code 1
 * lines 11-390: a full coverage report, every file at 0%
 * line 397:  Error: Test scratch namespace ... past the ceiling of 512
 * ```
 *
 * measured on vitest 4.1.9 over a 416-line output. The guard bit correctly and
 * was still PRESENTED as a coverage failure — "no tests" and an all-zero
 * coverage table are the first and largest things on the page, and the reason
 * is 392 lines below the verdict. Anything reading the top of the output, or
 * reading the coverage numbers, gets the wrong story; that is a silent
 * degradation inside a guard written to abolish silent degradation.
 *
 * So the reason is printed HERE, before the throw, from a hook that runs before
 * collection — which puts it above every line of that output instead of below
 * it. The throw is kept exactly as it was: this changes where the reason is
 * read, not whether the run fails.
 *
 * The banner says what the zeroes below it mean, because the operator standing
 * at this gate is not necessarily an engineer and "0% coverage" reads as a
 * verdict on the code rather than as the absence of a measurement.
 * @param failure - The residue failure being reported
 * @returns Operator-readable banner text.
 */
export const renderRefusalNotice = (failure: string): string =>
  [
    "",
    "═".repeat(78),
    "TEST RUN REFUSED TO START — this is NOT a coverage failure.",
    "",
    failure,
    "",
    "No test ran, so nothing below this line measured anything. Vitest will",
    'print "No test files found" and a coverage table reading 0% for every',
    "file; both are what a refused run looks like, not a verdict on the code.",
    "Fix the reason named above and run again.",
    "═".repeat(78),
    "",
  ].join("\n");

/** The file descriptor a refusal writes to. `2` is stderr. */
const STDERR_FD = 2;

/**
 * Renders the ONE line a refused run ends on.
 *
 * The banner {@link renderRefusalNotice} produces is read by an operator who
 * starts at the top. Nobody does that with a long transcript, and the tail was
 * measured to be a stack trace through vitest's `_initializeGlobalSetup` — no
 * line anywhere said what the run had concluded. Every other run puts its
 * verdict at the end, so the end is where a reader looks, and a refused run
 * gave them a frame in somebody else's internals instead.
 *
 * That absence has a name in this campaign: NO-RESULT, one of the three
 * distinct outcomes fourteen runs of one unchanged commit produced
 * (CodySwannGT/lisa#3032). "Every run emits a summary line" is the clause it
 * violates, and it violates it by emitting nothing at all rather than by
 * emitting the wrong thing.
 *
 * One line, deliberately. A second banner at the foot of the page would be a
 * wall a reader skips exactly as they skipped the first one.
 * @param failure - The residue failure being reported
 * @returns A single newline-terminated summary line.
 */
export const renderRefusalSummary = (failure: string): string =>
  `❌ NO VERDICT — the run was refused before collection, so 0 test files ` +
  `ran: nothing passed, nothing failed, and no coverage was measured. ` +
  `Reason: ${failure}\n`;

/**
 * Vitest's marker for a pool worker. Absent in the process that runs
 * `globalSetup`, present in every process that runs a test file — measured on
 * vitest 4.1.9 rather than assumed, and pinned by a test so a rename cannot
 * silently disarm {@link armRefusalSummary}.
 */
export const POOL_WORKER_ENV = "VITEST_POOL_ID";

/**
 * Whether this process is a pool worker rather than the run's main process.
 * @returns True inside a worker running a test file.
 */
const inPoolWorker = (): boolean => env[POOL_WORKER_ENV] !== undefined;

/**
 * Arms the summary line to be written when the process finally exits.
 *
 * At exit rather than inline, because inline is where the banner already is and
 * the whole point is to reach the reader who starts at the other end. Vitest
 * prints its unhandled-error report after `setup` throws, so anything written
 * before the throw lands above it; an exit hook lands below.
 *
 * `writeSync` on the descriptor, never `process.stderr.write`. On a POSIX pipe
 * Node's stderr is asynchronous, and an asynchronous write issued from an exit
 * handler can be discarded when the process tears down — which would leave this
 * fix passing its own tests while changing no transcript anywhere. The writer
 * is a parameter so a test can observe the line without redefining an ESM
 * module namespace, which is not permitted.
 *
 * ## Why a worker refuses to arm
 *
 * A process-lifetime side effect outlives the call that made it, and this
 * project has tests that invoke the real {@link setup} against a deliberately
 * overfull namespace. Armed unconditionally, each of those left a handler in
 * its worker, and the worker printed "❌ NO VERDICT" as it exited — on a run of
 * 64 files and 893 tests that had all passed. Measured, not hypothesised: ten
 * consecutive green runs each carried two false refusal lines.
 *
 * That is this issue's own defect committed by its own fix. A report that says
 * a passing run reached no verdict is the same class of lie as a killed run
 * that says FAILED, and it lands in the same transcript.
 *
 * The guard is structural rather than a rule tests must remember: only the
 * process vitest runs `globalSetup` in can refuse a run, and that process is
 * the one WITHOUT {@link POOL_WORKER_ENV}. A test calling `setup` runs in a
 * worker and therefore arms nothing, whatever it does to the namespace.
 * @param failure - The residue failure being reported
 * @param write - Where the line goes; defaults to a synchronous stderr write
 */
export const armRefusalSummary = (
  failure: string,
  write: (text: string) => void = text => {
    writeSync(STDERR_FD, text);
  }
): void => {
  if (inPoolWorker()) return;
  process.once("exit", () => {
    write(renderRefusalSummary(failure));
  });
};

/**
 * Reclaims residue from previous runs, then refuses to start into a namespace
 * that is accumulating.
 *
 * A refusal speaks twice — a banner before collection and a summary line at
 * exit — and the two are not redundant. They are the top and the bottom of a
 * transcript nobody reads in full.
 * @throws When residue is present that the sweep cannot or did not reclaim.
 */
export const setup = (): void => {
  // The namespace directory is not created here. `createRunRoot` makes it
  // recursively in whichever worker allocates first, and both the sweep and the
  // inspection treat an absent namespace as an empty one — so creating it would
  // be a side effect ahead of the audit that buys nothing.
  const dir = scratchNamespaceDir();
  const residue = auditNamespace(dir);
  const failure = describeResidueFailure(dir, residue);

  if (failure !== undefined) {
    // Written to stderr before the throw so it lands above Vitest's own
    // output — see renderRefusalNotice for the measured ordering it fixes.
    process.stderr.write(renderRefusalNotice(failure));
    // Armed before the throw, because the throw is what ends this function.
    armRefusalSummary(failure);
    throw new Error(failure);
  }
};

/**
 * Reclaims what this run allocated.
 *
 * This hook cannot fail a run — see the module header: Vitest swallows a throw
 * from here. So it does the one thing it can do reliably, which is the cleanup;
 * the judgement is made by {@link setup} on the next run, where a throw is
 * actually honoured.
 *
 * The namespace directory itself is deliberately left in place. Creating a name
 * inside a saturated shared temp root is the expensive operation this whole
 * module exists to stop paying repeatedly; keeping one directory forever means
 * the cost is paid once on a machine rather than once per run, and it is what
 * makes "one entry in the shared temp root, ever" literally true rather than
 * approximately true.
 */
export const teardown = (): void => {
  sweepScratchNamespace({ dir: scratchNamespaceDir() });
};
