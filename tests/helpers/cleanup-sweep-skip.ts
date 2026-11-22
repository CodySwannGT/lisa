/**
 * The environment a test hands a spawned gate runner or `lisa-test-run` so
 * that it skips the start-of-run cleanup sweep (CodySwannGT/lisa#4597).
 *
 * A fixture that runs `lisa-run-gates.mjs --moment=push` — directly or through
 * a pre-push hook — would otherwise sweep the MACHINE's temp directory and
 * process table from inside a test. The skip is keyed on a live sweeper, so
 * the value names this test process (alive for as long as the test runs) with
 * its real start time.
 * @module tests/helpers/cleanup-sweep-skip
 */
import { ownerMarkerFor } from "../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep-processes.mjs";
import { SWEPT_ENV } from "../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs";

/**
 * Environment entries that make a spawned run skip the cleanup sweep.
 * @param base - Entries to keep alongside the skip
 * @returns `base` plus `LISA_CLEANUP_SWEPT: "<this pid>:<start>"`
 */
export function sweepAlreadyRanEnv(
  base: Readonly<Record<string, string | undefined>> = {}
): Readonly<Record<string, string | undefined>> {
  return { ...base, [SWEPT_ENV]: ownerMarkerFor(process.pid) };
}
