/**
 * Vitest Configuration - Refusal announcement
 *
 * How a global setup that refuses a run says so: a banner before collection and
 * one summary line at exit, because those are the top and the bottom of a
 * transcript nobody reads in full. Extracted from the retired scratch global
 * setup (CodySwannGT/lisa#4602) so the coverage include guard keeps it.
 * @module configs/vitest/refusal-announcement
 */
import { writeSync } from "node:fs";
import { env } from "node:process";

/**
 * Renders the banner a refused run prints before vitest's own output.
 *
 * Vitest prints its unhandled-error report after `setup` throws, so the reason
 * printed here, before the throw, lands above every line of that output instead
 * of below it. The banner says what the zeroes below it mean, because the
 * operator standing at this gate is not necessarily an engineer and "0%
 * coverage" reads as a verdict on the code rather than as the absence of a
 * measurement.
 * @param failure - Why the run was refused
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
 * Every other run puts its verdict at the end, so the end is where a reader
 * looks; without this line a refused run ended on a stack trace through
 * vitest's internals (CodySwannGT/lisa#3032).
 * @param failure - Why the run was refused
 * @returns A single newline-terminated summary line.
 */
export const renderRefusalSummary = (failure: string): string =>
  `❌ NO VERDICT — the run was refused before collection, so 0 test files ` +
  `ran: nothing passed, nothing failed, and no coverage was measured. ` +
  `Reason: ${failure}\n`;

/**
 * Vitest's marker for a pool worker. Absent in the process that runs
 * `globalSetup`, present in every process that runs a test file — measured on
 * vitest 4.1.9 rather than assumed.
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
 * `writeSync` on the descriptor, never `process.stderr.write`: on a POSIX pipe
 * Node's stderr is asynchronous, and an asynchronous write issued from an exit
 * handler can be discarded when the process tears down.
 * @param failure - Why the run was refused
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
 * A pool worker announces nothing: a test that invokes a real guard against a
 * deliberately bad input would otherwise leave a "refused" banner in a green
 * run's transcript.
 * @param failure - Why the run was refused
 * @param writeNotice - Where the banner goes; defaults to the run's stderr
 */
export const announceRefusal = (
  failure: string,
  writeNotice: (text: string) => void = text => {
    process.stderr.write(text);
  }
): void => {
  if (inPoolWorker()) return;
  writeNotice(renderRefusalNotice(failure));
  armRefusalSummary(failure);
};
