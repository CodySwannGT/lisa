import { type Command, InvalidArgumentError } from "commander";
import type { Harness, RefreshTemplates } from "../core/config.js";
import { ACCEPTED_HARNESS_INPUTS } from "../core/config.js";
import { GitService } from "../core/git-service.js";
import type { LisaDependencies } from "../core/lisa.js";
import { DetectorRegistry } from "../detection/index.js";
import type { ConsoleLogger } from "../logging/index.js";
import { MigrationRegistry } from "../migrations/index.js";
import { normalizeHarness } from "../core/project-config.js";
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
  /**
   * Declare this apply a package-manager install lifecycle.
   *
   * The only thing that selects the reduced `postinstall-safe` subset. Every
   * Lisa-written postinstall invocation carries it, in this spelling or as
   * `LISA_POSTINSTALL=1` (CodySwannGT/lisa#3066).
   */
  postinstallSafe?: boolean;
  /**
   * Run the FULL apply even inside a declared postinstall.
   *
   * The override of last resort, for an operator forcing the complete apply
   * from inside a lifecycle script.
   */
  fullApply?: boolean;
  /** Bare `--refresh-templates` yields true; with a value, the raw path list. */
  refreshTemplates?: boolean | string;
  harness?: Harness;
}

/**
 * Resolve `--refresh-templates` into the selection the strategies consume.
 * @param value - Raw commander value: absent, true, or a comma-separated list
 * @returns The selection, or undefined when the flag was not passed
 */
export function parseRefreshTemplates(
  value: boolean | string | undefined
): RefreshTemplates | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) return { mode: "all" };
  const paths = value
    .split(",")
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
  // `--refresh-templates=` with nothing after it reads as "refresh nothing",
  // which is a footgun either way. Treat it as the bare flag rather than
  // silently matching no path.
  return paths.length > 0 ? { mode: "paths", paths } : { mode: "all" };
}

/**
 * Validate the --harness CLI argument. Commander invokes this with the raw
 * user-supplied string and expects either the parsed value or a thrown
 * InvalidArgumentError.
 * @param value - Raw argument value
 * @returns The validated harness
 */
export function parseHarnessArg(value: string): Harness {
  const normalized = normalizeHarness(value);
  if (normalized === undefined) {
    const allowed = ACCEPTED_HARNESS_INPUTS.join(" | ");
    throw new InvalidArgumentError(
      `expected ${allowed}, got ${JSON.stringify(value)}`
    );
  }
  return normalized;
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
      "Skip the dirty git working directory check. Means only that: the apply " +
        "still runs in full, including every agent emit (CodySwannGT/lisa#3066)."
    )
    .option(
      "--postinstall-safe",
      "Declare this apply a package-manager install lifecycle, which runs the " +
        "reduced postinstall-safe subset: no agent emit (Codex, Claude, agy, " +
        "Copilot, OpenCode) and no Sonar integration, so an install never " +
        "regenerates committed agent trees. Equivalent to LISA_POSTINSTALL=1."
    )
    .option(
      "--full-apply",
      "Run the FULL apply even inside a declared postinstall. Overrides " +
        "--postinstall-safe and LISA_POSTINSTALL=1."
    )
    .option(
      "--refresh-templates [paths]",
      "Let a non-interactive apply replace managed files it would otherwise report as out of date. " +
        "Optionally scope to a comma-separated list of repo-relative paths " +
        "(e.g. --refresh-templates=scripts/lisa-hooks). Backs up before replacing."
    )
    .option(
      "--harness <harness>",
      `Target harness for emitted artifacts: ${ACCEPTED_HARNESS_INPUTS.join(" | ")} (default: claude, or value from .lisa.config.json)`,
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
