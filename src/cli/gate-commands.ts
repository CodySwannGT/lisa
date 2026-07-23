/** Registrars for non-project gate commands shipped to host projects. */
import type { Command } from "commander";

import type { FileUpstreamOptions } from "./file-upstream-cmd.js";
import { runInstallMergeDriver } from "./install-merge-driver-cmd.js";
import {
  runMergeLearnings,
  type MergeLearningsOptions,
} from "./merge-learnings-cmd.js";

/**
 * Gate runners kept structural to avoid importing the whole CLI dependency
 * record.
 *
 * `merge-learnings` and `install-merge-driver` are deliberately NOT members.
 * They are invoked by git and by an operator repairing a repository, never
 * substituted by the root CLI, and both mutate real state — the merge driver
 * overwrites the file git hands it, and the installer writes local git config.
 * An optional, defaulted field would be the worst shape here: a caller that
 * believed it had stubbed every gate command would silently run the real driver
 * against real files. Leaving them off the record makes non-injectability
 * explicit; they are covered directly by unit tests and by end-to-end tests
 * that drive real `git merge`.
 */
export interface GateCommandDependencies {
  runCheckLearningsBudget: (path: string | undefined) => Promise<number>;
  runFileUpstream: (options: FileUpstreamOptions) => Promise<number>;
}

/**
 * Gate commands skip the root npm update check.
 *
 * `merge-learnings` especially: git runs it inline during every merge of the
 * ledger, so a network update check would stall the merge and pollute the
 * driver's output.
 */
export const GATE_COMMAND_NAMES = [
  "check-learnings-budget",
  "file-upstream",
  "merge-learnings",
  "install-merge-driver",
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
 * Register the project-learnings union merge driver.
 *
 * Invoked by git, not by humans: the argument names map to git's `%O %A %B %P`
 * placeholders and the exit code carries the merge verdict.
 * @param program - Commander program
 */
function addMergeLearningsCommand(program: Command): void {
  program
    .command("merge-learnings")
    .description(
      "Git merge driver: union the project learnings ledger by entry id"
    )
    .option("--base <file>", "Merge-base version (git %O)")
    .option("--ours <file>", "Our version; receives the result (git %A)")
    .option("--theirs <file>", "Their version (git %B)")
    .option("--path <path>", "Real pathname for diagnostics (git %P)")
    .action(async (options: MergeLearningsOptions) => {
      const code = await runMergeLearnings(options);
      if (code !== 0) process.exitCode = code;
    });
}

/**
 * Register the machine-local merge-driver installer.
 * @param program - Commander program
 */
function addInstallMergeDriverCommand(program: Command): void {
  program
    .command("install-merge-driver")
    .description(
      "Register the project learnings union merge driver in local git config"
    )
    .argument("[path]", "Project directory (default: current directory)")
    .action(async (targetPath: string | undefined) => {
      const code = await runInstallMergeDriver(targetPath);
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
  addMergeLearningsCommand(program);
  addInstallMergeDriverCommand(program);
}
