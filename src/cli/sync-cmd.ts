/**
 * `lisa sync` — populate `.lisa.config.json` with every missing setting and
 * push config values back into the artifact files that mirror them.
 * @module cli/sync-cmd
 */
import * as path from "node:path";
import { runConfigSync, type SyncReport } from "../sync/config-sync.js";

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
 * @returns Exit code (0 on success, 1 when required keys are missing)
 */
export async function runSync(
  targetPath: string | undefined,
  options: SyncCmdOptions = {}
): Promise<number> {
  const destDir = path.resolve(targetPath ?? ".");
  const report = await runConfigSync(destDir, {
    dryRun: options.dryRun === true,
  });
  if (options.json === true) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSyncReport(report);
  }
  return report.missingRequired.length > 0 ? 1 : 0;
}
