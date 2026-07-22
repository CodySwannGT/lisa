/** Registrars for non-project gate commands shipped to host projects. */
import type { Command } from "commander";

import type { DeployStatusSyncOptions } from "./deploy-status-sync-cmd.js";
import type { FileUpstreamOptions } from "./file-upstream-cmd.js";

/** Gate runners kept structural to avoid importing the whole CLI dependency record. */
export interface GateCommandDependencies {
  runCheckLearningsBudget: (path: string | undefined) => Promise<number>;
  runFileUpstream: (options: FileUpstreamOptions) => Promise<number>;
  runDeployStatusSync: (options: DeployStatusSyncOptions) => Promise<number>;
}

/** Gate commands skip the root npm update check. */
export const GATE_COMMAND_NAMES = [
  "check-learnings-budget",
  "file-upstream",
  "deploy-status-sync",
] as const;

/**
 * Register the bounded learnings-budget check.
 * @param program - Commander program
 * @param dependencies - Gate runners
 */
function addCheckLearningsBudgetCommand(
  program: Command,
  dependencies: GateCommandDependencies
): void {
  program
    .command("check-learnings-budget")
    .description(
      "Fail if the project learnings file exceeds its hard budget (missing file passes)"
    )
    .argument(
      "[path]",
      "Learnings file to check (default: resolved from .lisa.config.json)"
    )
    .action(async (targetPath: string | undefined) => {
      const code = await dependencies.runCheckLearningsBudget(targetPath);
      if (code !== 0) process.exitCode = code;
    });
}

/**
 * Register the public upstream-filing projection.
 * @param program - Commander program
 * @param dependencies - Gate runners
 */
function addFileUpstreamCommand(
  program: Command,
  dependencies: GateCommandDependencies
): void {
  program
    .command("file-upstream")
    .description(
      "Project a public upstream filing document from allowlisted fields only"
    )
    .option("--input <file>", "JSON filing event (default: read stdin)")
    .action(async (options: FileUpstreamOptions) => {
      const code = await dependencies.runFileUpstream(options);
      if (code !== 0) process.exitCode = code;
    });
}

/**
 * Register the deploy-status-sync transition engine (DSS-2). Runs in host
 * project CI after a deploy, so it must skip the root npm update check.
 * @param program - Commander program
 * @param dependencies - Gate runners
 */
function addDeployStatusSyncCommand(
  program: Command,
  dependencies: GateCommandDependencies
): void {
  program
    .command("deploy-status-sync")
    .description(
      "Move the work items a deployed commit range shipped to the environment's configured done status"
    )
    .option("--environment <env>", "Environment the deploy landed in")
    .option("--branch <branch>", "Deployed branch (resolved to an environment)")
    .option("--range <range>", "Deployed commit range as <base>..<head>")
    .option("--before <sha>", "Range base SHA (with --after)")
    .option("--after <sha>", "Range head SHA (with --before)")
    .option("--dry-run", "Plan and print without any tracker writes")
    .option("--json", "Emit the machine-readable plan/result JSON")
    .option("--config <path>", "Config path (default: .lisa.config.json)")
    .action(async (options: DeployStatusSyncOptions) => {
      const code = await dependencies.runDeployStatusSync(options);
      if (code !== 0) process.exitCode = code;
    });
}

/**
 * Register all non-project gate commands.
 * @param program - Commander program
 * @param dependencies - Gate runners
 */
export function addGateCommands(
  program: Command,
  dependencies: GateCommandDependencies
): void {
  addCheckLearningsBudgetCommand(program, dependencies);
  addFileUpstreamCommand(program, dependencies);
  addDeployStatusSyncCommand(program, dependencies);
}
