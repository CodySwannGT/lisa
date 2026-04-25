import { Command, InvalidArgumentError } from "commander";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Harness, LisaConfig } from "../core/config.js";
import { HARNESS_VALUES } from "../core/config.js";
import { GitService } from "../core/git-service.js";
import { Lisa, type LisaDependencies } from "../core/lisa.js";
import {
  isHarness,
  readProjectConfig,
  resolveHarness,
  writeProjectConfig,
} from "../core/project-config.js";
import { DetectorRegistry } from "../detection/index.js";
import { ConsoleLogger } from "../logging/index.js";
import { MigrationRegistry } from "../migrations/index.js";
import { StrategyRegistry } from "../strategies/index.js";
import { BackupService, DryRunBackupService } from "../transaction/index.js";
import { toAbsolutePath } from "../utils/path-utils.js";
import { createPrompter } from "./prompts.js";

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
 * Validate the --harness CLI argument. Commander invokes this with the raw
 * user-supplied string and expects either the parsed value or a thrown
 * InvalidArgumentError.
 * @param value - Raw argument value
 * @returns The validated harness
 */
function parseHarnessArg(value: string): Harness {
  if (!isHarness(value)) {
    const allowed = HARNESS_VALUES.join(" | ");
    throw new InvalidArgumentError(
      `expected ${allowed}, got ${JSON.stringify(value)}`
    );
  }
  return value;
}

/**
 * Create and configure the CLI program
 * @returns Configured Commander program
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("lisa")
    .description(
      "Claude Code / Codex CLI governance framework - apply guardrails and guidance to projects"
    )
    .version("1.0.0")
    .argument("[destination]", "Path to the project directory")
    .option("-n, --dry-run", "Show what would be done without making changes")
    .option(
      "-y, --yes",
      "Non-interactive mode (auto-accept defaults, overwrite on conflict)"
    )
    .option(
      "-v, --validate",
      "Validate project compatibility without applying changes"
    )
    .option(
      "--skip-git-check",
      "Skip dirty git working directory check (for postinstall use)"
    )
    .option(
      "--harness <harness>",
      `Target harness for emitted artifacts: ${HARNESS_VALUES.join(" | ")} (default: claude, or value from .lisa.config.json)`,
      parseHarnessArg
    )
    .action(async (destination: string | undefined, options: CLIOptions) => {
      await runLisa(destination, options);
    });

  return program;
}

/**
 * CLI options parsed from command line arguments
 */
interface CLIOptions {
  dryRun?: boolean;
  yes?: boolean;
  validate?: boolean;
  skipGitCheck?: boolean;
  harness?: Harness;
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
 * Create Lisa dependencies based on options
 * @param dryRun - Whether in dry run mode
 * @param yesMode - Whether in non-interactive mode
 * @param logger - Logger instance
 * @returns Dependencies for Lisa
 */
function createDependencies(
  dryRun: boolean,
  yesMode: boolean,
  logger: ConsoleLogger
): LisaDependencies {
  return {
    logger,
    prompter: createPrompter(yesMode),
    backupService: dryRun
      ? new DryRunBackupService()
      : new BackupService(logger),
    detectorRegistry: new DetectorRegistry(),
    strategyRegistry: new StrategyRegistry(),
    gitService: new GitService(),
    migrationRegistry: new MigrationRegistry(),
  };
}

/**
 * Run Lisa with the given options
 * @param destination - Path to destination directory
 * @param options - CLI options
 * @returns Promise that completes when Lisa finishes
 */
async function runLisa(
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

export { createPrompter } from "./prompts.js";
