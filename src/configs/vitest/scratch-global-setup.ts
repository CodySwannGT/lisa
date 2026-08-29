/**
 * Vitest Configuration - Scratch namespace lifecycle (global setup)
 *
 * Runs once in the main Vitest process, on either side of the whole run.
 *
 * `setup` reclaims residue only when a valid owner marker proves the exact root
 * belongs to a dead process. It REFUSES TO START when a root cannot be removed
 * with that authority or when proven-dead residue survives the sweep. That
 * fail-closed distinction prevents a cleanup guard from deleting a live
 * sibling's work. `teardown` reclaims what this run allocated.
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
 * Checking at the start rather than the end costs nothing that matters: the
 * next run reclaims roots whose exact dead ownership it can prove, preserves
 * uncertain paths, and refuses before collection if anything unsafe remains.
 * Accumulation is a trend, and a trend is still visible one run later.
 * @see {@link module:configs/vitest/scratch} for the reclaim rules
 * @module configs/vitest/scratch-global-setup
 */
import { lstatSync, realpathSync, writeSync } from "node:fs";
import * as path from "node:path";

import { env } from "node:process";

import {
  isProcessAlive,
  readNamespaceEntries,
  scratchNamespaceDir,
  sweepScratchNamespace,
} from "./scratch.js";
import {
  classifyScratchOwner,
  processBirthFingerprint,
  processBirthFingerprintSnapshot,
  readScratchOwnerRecord,
  type ScratchOwnerRecordV1,
} from "./scratch-owner.js";

/**
 * Upper bound on entries the namespace may hold that **nobody owns**.
 *
 * A run allocates one root per process — the main process plus one per worker —
 * and several runs share a workstation, so a healthy namespace legitimately
 * holds entries while work is in flight. This ceiling is not a tuning knob for
 * that; it is the point past which the namespace is provably becoming the very
 * thing it replaced.
 *
 * ## Why it counts unowned entries rather than all of them
 *
 * It compared against the total, and a total is a sum over every concurrent run
 * on the box. Measured (CodySwannGT/lisa#3032), six snapshots of the shared
 * namespace between 519 and 3,730 entries: in five of them EVERY root had a
 * live owner that started before it. 24.3% of sampled instants sat above this
 * ceiling, in stretches up to 127 seconds, and a run starting inside one was
 * refused for its siblings' work under a message reading "accumulating rather
 * than being reclaimed" — about a namespace in which nothing was accumulating.
 * Ten full-suite runs at one commit produced 2 PASS and 8 REFUSED that way.
 *
 * Live-owned entries cannot accumulate: they are released when their owner
 * exits, measured as 3,729 becoming reclaimable within 22 seconds when a run's
 * workers ended together. Orphaned and unrecognised entries are the only ones
 * that persist without bound, and they are exactly what the corrected
 * arithmetic still counts — so no leak detection is lost.
 *
 * The number itself is unchanged and is deliberately not re-tuned here. It is a
 * leak detector, not a performance backstop: the directory cost this campaign
 * began with was measured at hundreds of thousands of entries, three orders of
 * magnitude above this line, so a second absolute cap would need calibrating
 * against measured harm and belongs in its own ticket.
 */
export const MAX_NAMESPACE_ENTRIES = 512;

/** What an inspection of the namespace found. */
export interface NamespaceResidue {
  /** Entries whose owning process is gone but which were not removed */
  readonly orphaned: readonly string[];
  /** Entries whose exact dead ownership cannot be established */
  readonly unrecognised: readonly string[];
  /** Total entries present */
  readonly total: number;
}

/** Namespace-inspection disposition for one direct child. */
type NamespaceEntryDisposition = "live" | "orphaned" | "unrecognised";

/**
 * Verify that a durable marker names the physical root and namespace inspected.
 * @param dir - Canonical namespace path
 * @param root - Direct child root
 * @param owner - Valid owner marker
 * @returns True when device, inode, and canonical identities all match
 */
function markerMatchesInspectedPath(
  dir: string,
  root: string,
  owner: ScratchOwnerRecordV1
): boolean {
  const namespaceStat = lstatSync(dir);
  const rootStat = lstatSync(root);
  return (
    !rootStat.isSymbolicLink() &&
    rootStat.isDirectory() &&
    owner.namespace.canonicalPath === realpathSync(dir) &&
    owner.namespace.dev === namespaceStat.dev &&
    owner.namespace.ino === namespaceStat.ino &&
    owner.root.canonicalPath === realpathSync(root) &&
    owner.root.dev === rootStat.dev &&
    owner.root.ino === rootStat.ino
  );
}

/**
 * Classify one direct namespace child without treating age as authority.
 * @param dir - Canonical namespace path
 * @param name - Direct child basename
 * @param alive - Pid liveness probe
 * @param birth - Process-birth probe
 * @returns Fail-closed entry disposition
 */
function classifyNamespaceEntry(
  dir: string,
  name: string,
  alive: (pid: number) => boolean,
  birth: (pid: number) => string | undefined
): NamespaceEntryDisposition {
  const root = path.join(dir, name);
  try {
    const owner = readScratchOwnerRecord(root);
    if (!markerMatchesInspectedPath(dir, root, owner)) return "unrecognised";
    return classifyScratchOwner(owner, {
      isProcessAlive: alive,
      processBirthFingerprint: birth,
    }) === "preserve"
      ? "live"
      : "orphaned";
  } catch {
    return "unrecognised";
  }
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
 * @param birth - Process-birth probe, overridable for tests
 * @returns The classified residue.
 */
export const inspectNamespace = (
  dir: string = scratchNamespaceDir(),
  alive: (pid: number) => boolean = isProcessAlive,
  birth: (pid: number) => string | undefined = processBirthFingerprint
): NamespaceResidue => {
  const entries = readNamespaceEntries(dir);
  const classified = entries.map(name => ({
    name,
    disposition: classifyNamespaceEntry(dir, name, alive, birth),
  }));

  return {
    orphaned: classified
      .filter(entry => entry.disposition === "orphaned")
      .map(entry => entry.name),
    unrecognised: classified
      .filter(entry => entry.disposition === "unrecognised")
      .map(entry => entry.name),
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

/** Safe operator recovery when automatic deletion authority is unavailable. */
const MANUAL_RECOVERY_GUIDANCE =
  "Remove only an exact entry whose dead owner you can independently verify. " +
  "Do not clear the shared namespace or remove a live sibling's root.";

/**
 * Builds the failure message for a namespace that is accumulating.
 *
 * Every branch names the directory and the offending entries, because the
 * failure this replaces was a 60-second timeout that named nothing.
 *
 * `unrecognised` is deliberately a fail-closed refusal. A foreign, malformed,
 * or identity-mismatched entry is preserved because age and naming are not
 * deletion authority; proceeding would silently permit unbounded residue, and
 * deleting it could destroy a live sibling's work. The diagnostic therefore
 * names the bounded entries and gives the only safe manual recovery rule.
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
      `working, so a killed run's residue is now permanent. ${MANUAL_RECOVERY_GUIDANCE}`
    );
  }

  if (residue.unrecognised.length > 0) {
    return (
      `Test scratch namespace ${dir} holds ${String(residue.unrecognised.length)} ` +
      `root(s) without valid owner-marker authority: ${sample(residue.unrecognised)}. ` +
      `Lisa preserved the uncertain residue instead of deleting a path that ` +
      `cannot be bound to a token and process-birth fingerprint. ` +
      `There are ${String(residue.total)} entries in total; the historical ` +
      `accumulating-residue ceiling is ${String(MAX_NAMESPACE_ENTRIES)}. ${MANUAL_RECOVERY_GUIDANCE}`
    );
  }

  // Entries no live process owns. Written as the general expression rather
  // than as `unrecognised` alone: the orphaned branch above returns first
  // today, so the term is zero here — and hard-coding that would make this
  // line silently wrong the moment the branch above stops being terminal.
  const unowned = residue.orphaned.length + residue.unrecognised.length;

  if (unowned > MAX_NAMESPACE_ENTRIES) {
    return (
      `Test scratch namespace ${dir} holds ${String(unowned)} entries that no ` +
      `live process owns, past the ceiling of ${String(MAX_NAMESPACE_ENTRIES)} ` +
      `(${String(residue.total)} entries in total, the rest being work in ` +
      `flight). Scratch space is accumulating rather than being reclaimed — ` +
      `the condition this guard exists to prevent. ${MANUAL_RECOVERY_GUIDANCE}`
    );
  }

  return undefined;
};

/**
 * Sweeps the namespace and reports what survived.
 * @param alive - Process liveness probe shared by both phases
 * @param snapshot - One bulk process-birth snapshot provider
 * @returns The residue remaining after the sweep.
 */
export const sweepThenInspect = (
  alive: (pid: number) => boolean = isProcessAlive,
  snapshot: typeof processBirthFingerprintSnapshot = processBirthFingerprintSnapshot
): NamespaceResidue => {
  const dir = scratchNamespaceDir();
  const liveOwnerPids = readNamespaceEntries(dir).flatMap(name => {
    try {
      const pid = readScratchOwnerRecord(path.join(dir, name)).pid;
      return alive(pid) ? [pid] : [];
    } catch {
      return [];
    }
  });
  const births = snapshot(liveOwnerPids);
  const birth = (pid: number): string | undefined => births.get(pid);
  sweepScratchNamespace({
    isProcessAlive: alive,
    processBirthFingerprint: birth,
  });
  return inspectNamespace(dir, alive, birth);
};

/**
 * Audits the namespace, tolerating a sibling run's worker exiting mid-audit.
 *
 * That worker's root becomes orphaned in the window between the sweep and the
 * inspection, through no fault of this run. Sweeping once more before treating
 * an orphan as a defect keeps a guard built to catch a permanent leak from
 * failing on a transient one.
 * @returns The residue to judge.
 */
const auditNamespace = (): NamespaceResidue => {
  const first = sweepThenInspect();
  return first.orphaned.length > 0 ? sweepThenInspect() : first;
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
 * silently disarm {@link announceRefusal}.
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
 * Unguarded on purpose: {@link announceRefusal} is the only caller and holds
 * the single guard. Two copies of one condition is one condition that can go
 * inert without any test noticing.
 * @param failure - The residue failure being reported
 * @param write - Where the line goes; defaults to a synchronous stderr write
 */
export const armRefusalSummary = (
  failure: string,
  write: (text: string) => void = text => {
    writeSync(STDERR_FD, text);
  }
): void => {
  process.once("exit", () => {
    write(renderRefusalSummary(failure));
  });
};

/**
 * Says a run was refused — at the top of the transcript and again at the foot —
 * and says nothing at all from a process that cannot refuse a run.
 *
 * ## Why a worker announces nothing
 *
 * This project has tests that invoke the real {@link setup} against a
 * deliberately overfull namespace, and both halves of an announcement outlive
 * the call that made it: the banner is already on the run's stderr, and the
 * summary is a handler that fires whenever that process exits. Announced
 * unconditionally, each such test contributed to a transcript that was not its
 * own.
 *
 * Measured on ten consecutive runs of 64 files and 893 tests, every one green
 * and exiting 0: **two** "TEST RUN REFUSED TO START" banners in each, naming
 * the tests' own fixture directories, and — until this guard — two matching
 * "❌ NO VERDICT" lines. A green run that says it was refused is the same class
 * of lie as a killed gate that says FAILED, in the same transcript, and it is
 * the one the "repeated runs agree" scenario trips over: two readers of the
 * same passing run can reasonably disagree about what it concluded.
 *
 * The banner half predates the summary half and shipped with #3027; the summary
 * half was introduced by #3032's own first attempt at this fix. Both are cured
 * here by one condition rather than two.
 *
 * The guard is structural rather than a rule each test must remember: only the
 * process vitest runs `globalSetup` in can refuse a run, and that process is
 * the one WITHOUT {@link POOL_WORKER_ENV}. A test calling `setup` runs in a
 * worker and therefore announces nothing, whatever it does to the namespace.
 * @param failure - The residue failure being reported
 * @param writeNotice - Where the banner goes; defaults to the run's stderr
 */
export const announceRefusal = (
  failure: string,
  writeNotice: (text: string) => void = text => {
    process.stderr.write(text);
  }
): void => {
  if (inPoolWorker()) return;
  // Before the throw, so it lands above every line vitest goes on to print —
  // see renderRefusalNotice for the measured ordering that fixes.
  writeNotice(renderRefusalNotice(failure));
  armRefusalSummary(failure);
};

/**
 * Reclaims residue from previous runs, then refuses to start into a namespace
 * that is accumulating.
 *
 * A refusal speaks twice — a banner before collection and a summary line at
 * exit — and the two are not redundant. They are the top and the bottom of a
 * transcript nobody reads in full.
 * @throws {Error} When residue is present that the sweep cannot or did not reclaim.
 */
export const setup = (): void => {
  // The namespace directory is not created here. `createRunRoot` makes it
  // recursively in whichever worker allocates first, and both the sweep and the
  // inspection treat an absent namespace as an empty one — so creating it would
  // be a side effect ahead of the audit that buys nothing.
  const dir = scratchNamespaceDir();
  const residue = auditNamespace();
  const failure = describeResidueFailure(dir, residue);

  if (failure !== undefined) {
    // Both halves of the announcement happen before the throw, because the
    // throw is what ends this function.
    announceRefusal(failure);
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
  sweepScratchNamespace();
};
