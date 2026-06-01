import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { LisaConfig } from "../core/config.js";
import { HARNESS_VALUES } from "../core/config.js";
import { Lisa } from "../core/lisa.js";
import {
  readProjectConfig,
  resolveHarness,
  writeProjectConfig,
} from "../core/project-config.js";
import { ConsoleLogger } from "../logging/index.js";
import { toAbsolutePath } from "../utils/path-utils.js";
import { type CLIOptions, createDependencies } from "./shared-options.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    `  --harness <h>     Target harness for emitted artifacts: ${HARNESS_VALUES.join(" | ")} (persisted in .lisa.config.json)`
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
    "  lisa --harness=both .                # Emit both Claude and Codex artifacts"
  );
  process.exit(1);
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
  if (!destination) {
    printUsageAndExit();
  }

  const dryRun = options.dryRun ?? options.validate ?? false;
  const yesMode = options.yes ?? false;
  const destDir = toAbsolutePath(destination);

  // Resolve harness with precedence: CLI flag > .lisa.config.json > default
  const projectConfig = await readProjectConfig(destDir);
  const harness = resolveHarness(options.harness, projectConfig);

  const config: LisaConfig = {
    lisaDir: getLisaDir(),
    destDir,
    dryRun,
    yesMode,
    validateOnly: options.validate ?? false,
    skipGitCheck: options.skipGitCheck ?? false,
    harness,
  };

  const logger = new ConsoleLogger();
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

    // Persist resolved harness on apply (not validate, not dry-run) so the
    // choice survives to the next run without requiring the flag every time.
    // Only write when the user actually supplied --harness, so existing
    // host projects don't gain a brand-new .lisa.config.json with the
    // default value just by running `lisa` once.
    if (
      !options.validate &&
      !dryRun &&
      options.harness !== undefined &&
      projectConfig.harness !== harness
    ) {
      await writeProjectConfig(destDir, { harness });
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
