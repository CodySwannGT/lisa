import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { LisaConfig } from "../core/config.js";
import { getBootstrapApplySkipNotice } from "../core/bootstrap-environment.js";
import { ACCEPTED_HARNESS_INPUTS } from "../core/config.js";
import { Lisa } from "../core/lisa.js";
import {
  detectLegacyHarnessMigration,
  projectConfigExists,
  readProjectConfig,
  resolveHarness,
  shouldPersistProjectConfig,
  writeProjectConfig,
} from "../core/project-config.js";
import { ConsoleLogger } from "../logging/index.js";
import { toAbsolutePath } from "../utils/path-utils.js";
import { nudgeCrossPollinate } from "./cross-pollinate-nudge.js";
import { type CLIOptions, createDependencies } from "./shared-options.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Inputs used to decide whether `.lisa.config.json` should be persisted.
 */
interface ProjectConfigPersistenceInput {
  /** Whether the destination already has `.lisa.config.json`. */
  readonly fileExists: boolean;
  /** Harness value supplied by the caller, if any. */
  readonly flagHarness: CLIOptions["harness"];
  /** Harness already persisted in `.lisa.config.json`, if any. */
  readonly existingHarness: Awaited<
    ReturnType<typeof readProjectConfig>
  >["harness"];
  /** Harness resolved for this invocation. */
  readonly resolvedHarness: LisaConfig["harness"];
}

/**
 * Get Lisa directory (where configs are stored)
 * @returns Path to Lisa directory
 */
function getLisaDir(): string {
  // Go up from dist/cli to project root
  return path.resolve(__dirname, "..", "..");
}

/**
 * Print usage help and exit
 */
function printUsageAndExit(): never {
  console.error("Error: destination path is required");
  console.log("");
  console.log("Usage: lisa [options] <destination-path>");
  console.log("");
  console.log("Options:");
  console.log(
    "  -n, --dry-run     Show what would be done without making changes"
  );
  console.log(
    "  -y, --yes         Non-interactive mode (auto-accept defaults, overwrite on conflict)"
  );
  console.log(
    "  -v, --validate    Validate project compatibility without applying changes"
  );
  console.log(
    "  --skip-git-check  Skip dirty git working directory check (for postinstall use)"
  );
  console.log("  --no-update-check Skip the npm latest-version check");
  console.log(
    `  --harness <h>     Target harness for emitted artifacts: ${ACCEPTED_HARNESS_INPUTS.join(" | ")} (persisted in .lisa.config.json)`
  );
  console.log("  -h, --help        Show this help message");
  console.log("");
  console.log("Examples:");
  console.log("  lisa /path/to/my-project");
  console.log("  lisa --dry-run .");
  console.log("  lisa --yes /path/to/project          # CI/CD pipeline usage");
  console.log(
    "  lisa --validate .                    # Check compatibility only"
  );
  console.log("  lisa --harness=codex .               # Emit Codex artifacts");
  console.log(
    "  lisa --harness=all .                 # Emit for every agent (alias for fleet)"
  );
  process.exit(1);
}

/**
 * Resolve the required destination argument or print the legacy usage error.
 * @param destination - Destination argument from the CLI
 * @returns Absolute destination path
 */
function resolveDestinationOrExit(destination: string | undefined): string {
  if (!destination) {
    printUsageAndExit();
  }
  return toAbsolutePath(destination);
}

/**
 * Persist the resolved harness when a real apply needs to backfill or update
 * `.lisa.config.json`.
 * @param destDir - Destination project directory
 * @param input - Existing config state and resolved harness values
 */
async function persistProjectConfigIfNeeded(
  destDir: string,
  input: ProjectConfigPersistenceInput
): Promise<void> {
  if (!shouldPersistProjectConfig(input)) return;
  await writeProjectConfig(destDir, { harness: input.resolvedHarness });
}

/**
 * Rewrite a retired legacy harness value (e.g. `both`) in `.lisa.config.json`
 * to its canonical form so the file stops carrying a value Lisa no longer
 * accepts verbatim. Logs a notice describing the migration.
 * @param destDir - Destination project directory
 * @param logger - Logger for the migration notice
 */
async function migrateLegacyHarnessIfNeeded(
  destDir: string,
  logger: ConsoleLogger
): Promise<void> {
  const migration = await detectLegacyHarnessMigration(destDir);
  if (migration === undefined) return;
  await writeProjectConfig(destDir, { harness: migration.to });
  logger.info(
    `Migrated legacy harness "${migration.from}" to "${migration.to}" in .lisa.config.json`
  );
}

/**
 * Apply Lisa to the given destination with the given options.
 *
 * This is the relocated action that previously lived inline in
 * `src/cli/index.ts` as `runLisa`. It backs both the explicit `apply`
 * subcommand and the backwards-compatible positional default, so the two
 * invocation forms produce identical results.
 * @param destination - Path to destination directory
 * @param options - CLI options
 * @returns Promise that completes when Lisa finishes
 */
export async function runApply(
  destination: string | undefined,
  options: CLIOptions
): Promise<void> {
  const dryRun = options.dryRun ?? options.validate ?? false;
  const yesMode = options.yes ?? false;
  const validateOnly = options.validate ?? false;
  const destDir = resolveDestinationOrExit(destination);
  const logger = new ConsoleLogger();

  const skipNotice = getBootstrapApplySkipNotice({ validateOnly });
  if (skipNotice !== undefined) {
    console.log(skipNotice);
    return;
  }

  // Resolve harness with precedence: CLI flag > .lisa.config.json > default
  const projectConfig = await readProjectConfig(destDir);
  const configFileExists = await projectConfigExists(destDir);
  const harness = resolveHarness(options.harness, projectConfig);

  const config: LisaConfig = {
    lisaDir: getLisaDir(),
    destDir,
    dryRun,
    yesMode,
    validateOnly,
    skipGitCheck: options.skipGitCheck ?? false,
    harness,
  };

  const deps = createDependencies(dryRun, yesMode, logger);
  const lisa = new Lisa(config, deps);

  try {
    const result = options.validate
      ? await lisa.validate()
      : await lisa.apply();

    if (!result.success) {
      result.errors.forEach(error => logger.error(error));
      process.exit(1);
    }

    // Ensure every applied project carries a .lisa.config.json (not on
    // validate / dry-run). A missing file is always backfilled with the
    // resolved harness (the default when no --harness was passed) so no
    // project is left config-less; an existing file is only rewritten when
    // --harness actually changes the persisted value, avoiding churn.
    if (!options.validate && !dryRun) {
      await persistProjectConfigIfNeeded(destDir, {
        fileExists: configFileExists,
        flagHarness: options.harness,
        existingHarness: projectConfig.harness,
        resolvedHarness: harness,
      });
      // Rewrite retired legacy harness values (e.g. "both") in place so the
      // committed config stops carrying a value newer Lisa versions reject.
      await migrateLegacyHarnessIfNeeded(destDir, logger);
    }

    // After a real apply, surface (read-only) whether any locally-authored
    // agent definitions need cross-pollinating to the project's other agents.
    // Never writes here — the emit stays behind the explicit skill/command.
    if (!options.validate && !dryRun) {
      await nudgeCrossPollinate(destDir, getLisaDir(), logger);
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
