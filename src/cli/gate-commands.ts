/** Registrars for non-project gate commands shipped to host projects. */
import type { Command } from "commander";

import type { FileUpstreamOptions } from "./file-upstream-cmd.js";

/** Gate runners kept structural to avoid importing the whole CLI dependency record. */
export interface GateCommandDependencies {
  runCheckLearningsBudget: (path: string | undefined) => Promise<number>;
  runFileUpstream: (options: FileUpstreamOptions) => Promise<number>;
}

/** Gate commands skip the root npm update check. */
export const GATE_COMMAND_NAMES = [
  "check-learnings-budget",
  "file-upstream",
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
}
