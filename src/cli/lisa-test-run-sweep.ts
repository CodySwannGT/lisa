/**
 * The start-of-run cleanup step `lisa-test-run` performs before its payload
 * (CodySwannGT/lisa#4597).
 *
 * Two jobs. It returns the variables the payload must inherit —
 * `LISA_TEST_RUN_OWNER=<pid>:<start>`, so every test process and descendant
 * carries the name of the run that owns it (a later sweep kills them only once
 * this run is gone), and `LISA_CLEANUP_SWEPT=1`, so nested runs skip the sweep.
 * And it sweeps stale Lisa temp entries and orphans of earlier, dead runs —
 * unless `LISA_CLEANUP_SWEPT` says an enclosing run (the gate runner at push,
 * or an outer `lisa-test-run`) already did. A nested `lisa-test-run` fixture
 * therefore marks itself but never sweeps again.
 *
 * Nothing here fails the run. A marker whose start time cannot be read falls
 * back to `<pid>:0` (children are then reaped only once this pid is dead), a
 * sweep error is printed, and a sweep still running after the same 15 s the
 * gate runner allows is abandoned with one line.
 * @module cli/lisa-test-run-sweep
 */
import {
  formatSummary,
  sweep as defaultSweep,
  SWEPT_ENV,
  type SweepResult,
} from "../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs";
import {
  formatOwnerMarker,
  OWNER_ENV,
  ownerMarkerFor,
} from "../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep-processes.mjs";

/** Longest the sweep may hold up a test run; matches the gate runner's child deadline. */
const SWEEP_DEADLINE_MS = 15_000;

/** Seams for {@link startOfRunSweep}; production uses the defaults. */
export interface StartOfRunSweepSeams {
  readonly sweep?: () => Promise<SweepResult>;
  readonly ownerMarker?: () => string;
  readonly write?: (line: string) => void;
  readonly timeoutMs?: number;
}

/**
 * Describe a thrown value in one line.
 * @param error - Whatever was thrown
 * @returns Its message
 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The owner marker for this run, falling back to an unknown start time.
 * @param ownerMarker - Marker source
 * @param write - Output sink
 * @returns `<pid>:<start>`
 */
function markerOrFallback(
  ownerMarker: () => string,
  write: (line: string) => void
): string {
  try {
    return ownerMarker();
  } catch (error) {
    write(`🧹 owner marker failed: ${reasonOf(error)}; continuing\n`);
    return formatOwnerMarker(process.pid, undefined);
  }
}

/**
 * Run the sweep, giving up after `timeoutMs`.
 * @param sweep - The sweep
 * @param timeoutMs - Deadline
 * @returns The result, or undefined when the deadline won
 */
function sweepWithin(
  sweep: () => Promise<SweepResult>,
  timeoutMs: number
): Promise<SweepResult | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    timer.unref();
    sweep().then(
      result => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Run the sweep under its deadline and print its one line, whatever happens.
 * @param sweep - The sweep
 * @param timeoutMs - Deadline
 * @param write - Output sink
 */
async function reportSweep(
  sweep: () => Promise<SweepResult>,
  timeoutMs: number,
  write: (line: string) => void
): Promise<void> {
  try {
    const result = await sweepWithin(sweep, timeoutMs);
    write(
      result === undefined
        ? `🧹 cleanup sweep did not finish (timed out after ${timeoutMs / 1000} s); continuing\n`
        : `${formatSummary(result)}\n`
    );
  } catch (error) {
    write(`🧹 cleanup sweep failed: ${reasonOf(error)}; continuing\n`);
  }
}

/**
 * Sweep once unless an enclosing run already did, and name this run's owner.
 * @param environment - Environment this run inherited
 * @param seams - Injected sweep, marker, output and deadline
 * @returns The variables the payload must inherit
 */
export async function startOfRunSweep(
  environment: Readonly<Record<string, string | undefined>>,
  seams: StartOfRunSweepSeams = {}
): Promise<Readonly<Record<string, string>>> {
  const {
    sweep = () => defaultSweep(),
    ownerMarker = () => ownerMarkerFor(process.pid),
    write = (line: string) => process.stderr.write(line),
    timeoutMs = SWEEP_DEADLINE_MS,
  } = seams;
  const inherit = {
    [OWNER_ENV]: markerOrFallback(ownerMarker, write),
    [SWEPT_ENV]: "1",
  };
  if (!environment[SWEPT_ENV]) await reportSweep(sweep, timeoutMs, write);
  return inherit;
}
