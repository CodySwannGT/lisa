/**
 * The start-of-run cleanup step `lisa-test-run` performs before its payload
 * (CodySwannGT/lisa#4597).
 *
 * Two jobs, in this order. First it exports `LISA_TEST_RUN_OWNER=<pid>:<start>`
 * so every test process and descendant this run starts carries the name of
 * the run that owns it; a later sweep kills them only once this run is gone.
 * Then it sweeps stale Lisa temp entries and orphans of earlier, dead runs —
 * unless `LISA_CLEANUP_SWEPT` says an enclosing run (the gate runner at push,
 * or an outer `lisa-test-run`) already did. It sets that variable itself, so a
 * nested `lisa-test-run` fixture marks itself but never sweeps again.
 *
 * A sweep failure is printed and swallowed: the sweep never fails a run.
 * @module cli/lisa-test-run-sweep
 */
import {
  formatSummary,
  sweep as defaultSweep,
  SWEPT_ENV,
  type SweepResult,
} from "../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs";
import {
  OWNER_ENV,
  ownerMarkerFor,
} from "../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep-processes.mjs";

/** Seams for {@link startOfRunSweep}; production uses the defaults. */
export interface StartOfRunSweepSeams {
  readonly sweep?: () => Promise<SweepResult>;
  readonly ownerMarker?: () => string;
  readonly write?: (line: string) => void;
}

/**
 * Mark this run as the owner of everything it starts, then sweep once.
 * @param environment - Environment the payload will inherit (mutated)
 * @param seams - Injected sweep, marker and output
 */
export async function startOfRunSweep(
  environment: Record<string, string | undefined>,
  seams: StartOfRunSweepSeams = {}
): Promise<void> {
  const {
    sweep = () => defaultSweep(),
    ownerMarker = () => ownerMarkerFor(process.pid),
    write = (line: string) => process.stderr.write(line),
  } = seams;
  const alreadySwept = Boolean(environment[SWEPT_ENV]);
  // eslint-disable-next-line functional/immutable-data -- every payload process inherits this environment
  environment[OWNER_ENV] = ownerMarker();
  // eslint-disable-next-line functional/immutable-data -- tells nested runs the sweep already ran
  environment[SWEPT_ENV] = "1";
  if (alreadySwept) return;
  try {
    write(`${formatSummary(await sweep())}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    write(`🧹 cleanup sweep failed: ${reason}; continuing\n`);
  }
}
