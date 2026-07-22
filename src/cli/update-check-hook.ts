/** Root CLI update-check hook registration. */
import type { Command } from "commander";
import { GATE_COMMAND_NAMES } from "./gate-commands.js";
import type { printUpdateWarning } from "./print-update-warning.js";
import type { runUpdateCheck } from "./update-check.js";

const UPDATE_CHECK_EXEMPT_COMMANDS = Object.freeze([
  "doctor",
  "health",
  "standards-proof",
  "sync",
  "ui",
  "update",
  "version",
]);

/** Collaborators used by the non-fatal root update-check hook. */
interface UpdateCheckHookDependencies {
  /** Read current and latest package versions. */
  runUpdateCheck: typeof runUpdateCheck;
  /** Print an update warning when a newer version is available. */
  printUpdateWarning: typeof printUpdateWarning;
}

/**
 * Register the root update check that precedes non-maintenance actions.
 * @param program - Commander program to mutate
 * @param dependencies - Update-check collaborators
 */
export function addUpdateCheckHook(
  program: Command,
  dependencies: UpdateCheckHookDependencies
): void {
  program.hook("preAction", async (_thisCommand, actionCommand) => {
    if (isUpdateCheckExempt(actionCommand)) return;
    if (program.opts().updateCheck === false) return;
    const result = await dependencies.runUpdateCheck();
    dependencies.printUpdateWarning(result);
  });
}

/**
 * Determine whether an action intentionally bypasses the root update warning.
 * @param actionCommand - Matched Commander action
 * @returns Whether the action owns a maintenance or provider-specific path
 */
function isUpdateCheckExempt(actionCommand: Command): boolean {
  return (
    actionCommand.parent?.name() === "kane" ||
    UPDATE_CHECK_EXEMPT_COMMANDS.includes(actionCommand.name()) ||
    (GATE_COMMAND_NAMES as readonly string[]).includes(actionCommand.name())
  );
}
