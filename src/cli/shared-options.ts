import { type Command, InvalidArgumentError } from "commander";
import type { Harness } from "../core/config.js";
import { HARNESS_VALUES } from "../core/config.js";
import { GitService } from "../core/git-service.js";
import type { LisaDependencies } from "../core/lisa.js";
import { DetectorRegistry } from "../detection/index.js";
import type { ConsoleLogger } from "../logging/index.js";
import { MigrationRegistry } from "../migrations/index.js";
import { isHarness } from "../core/project-config.js";
import { StrategyRegistry } from "../strategies/index.js";
import { BackupService, DryRunBackupService } from "../transaction/index.js";
import { createPrompter } from "./prompts.js";

/**
 * CLI options parsed from command line arguments. Shared by the `apply`
 * subcommand and the backwards-compatible positional default.
 */
export interface CLIOptions {
  dryRun?: boolean;
  yes?: boolean;
  validate?: boolean;
  skipGitCheck?: boolean;
  harness?: Harness;
}

/**
 * Validate the --harness CLI argument. Commander invokes this with the raw
 * user-supplied string and expects either the parsed value or a thrown
 * InvalidArgumentError.
 * @param value - Raw argument value
 * @returns The validated harness
 */
export function parseHarnessArg(value: string): Harness {
  if (!isHarness(value)) {
    const allowed = HARNESS_VALUES.join(" | ");
    throw new InvalidArgumentError(
      `expected ${allowed}, got ${JSON.stringify(value)}`
    );
  }
  return value;
}

/**
 * Register the apply-flow flags shared by every entry point that applies Lisa
 * to a project. Mutates and returns the command for chaining.
 * @param command - Command to decorate with shared options
 * @returns The same command instance
 */
export function addSharedOptions(command: Command): Command {
  return command
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
    );
}

/**
 * Create Lisa dependencies based on options
 * @param dryRun - Whether in dry run mode
 * @param yesMode - Whether in non-interactive mode
 * @param logger - Logger instance
 * @returns Dependencies for Lisa
 */
export function createDependencies(
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
