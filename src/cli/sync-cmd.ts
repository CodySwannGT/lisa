/**
 * `lisa sync` — populate `.lisa.config.json` with every missing setting and
 * push config values back into the artifact files that mirror them.
 * @module cli/sync-cmd
 */
import * as path from "node:path";
import { runConfigSync, type SyncReport } from "../sync/config-sync.js";
import { MutationFloorDivergenceError } from "../sync/stryker-thresholds-ownership.js";

/** CLI options for `lisa sync`. */
export interface SyncCmdOptions {
  /** Report what would change without writing */
  readonly dryRun?: boolean;
  /** Emit the report as JSON instead of human-readable lines */
  readonly json?: boolean;
}

/**
 * Print a sync report in human-readable form.
 * @param report - Report returned by the sync engine
 */
export function printSyncReport(report: SyncReport): void {
  const prefix = report.dryRun ? "[dry-run] " : "";
  if (report.actions.length === 0) {
    console.log(`${prefix}Config is in sync — nothing to do.`);
  }
  report.actions.forEach(action => {
    console.log(`${prefix}${action.kind}  ${action.key} — ${action.detail}`);
  });
  report.missingRequired.forEach(missing => {
    console.warn(
      `${prefix}missing-required  ${missing.key} — cannot be defaulted; run ${missing.setupHint}`
    );
  });
}

/**
 * Run the `lisa sync` command.
 * @param targetPath - Project path argument (defaults to the current directory)
 * @param options - CLI options
 * @returns Exit code (0 on success, 1 when required keys are missing or the
 *   config-owned mutation floor diverges from stryker.conf.json)
 */
export async function runSync(
  targetPath: string | undefined,
  options: SyncCmdOptions = {}
): Promise<number> {
  const destDir = path.resolve(targetPath ?? ".");
  // A divergence is a refusal, not a crash: print the diagnosis the way an
  // operator can act on it rather than letting a stack trace reach the user.
  const report = await runConfigSync(destDir, {
    dryRun: options.dryRun === true,
  }).catch((error: unknown) => {
    if (error instanceof MutationFloorDivergenceError) {
      console.error(error.message);
      return undefined;
    }
    throw error;
  });
  if (report === undefined) {
    return 1;
  }
  if (options.json === true) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSyncReport(report);
  }
  return report.missingRequired.length > 0 ? 1 : 0;
}
