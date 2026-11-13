/**
 * The `lisa ui` refusal, kept after the Lisa Console was removed
 * (CodySwannGT/lisa#4804).
 *
 * Without it the word `ui` falls through to the default `apply` action, so
 * `lisa ui` would write Lisa's managed files into a `ui/` directory wherever
 * one exists, instead of saying the command is gone.
 * @module cli/removed-ui-cmd
 */
import type { Command } from "commander";

/** What `lisa ui` prints now that the console no longer ships. */
export const REMOVED_UI_MESSAGE =
  "lisa ui was removed: the Lisa Console no longer ships. Edit .lisa.config.json directly, and run `lisa sync` to fill in missing settings.\n";

/**
 * Register a hidden `ui` command that refuses with a non-zero exit.
 * @param program - The root commander program
 */
export function addRemovedUiCommand(program: Command): void {
  program
    .command("ui", { hidden: true })
    .allowUnknownOption()
    .allowExcessArguments()
    .action(() => {
      process.stderr.write(REMOVED_UI_MESSAGE);
      process.exitCode = 1;
    });
}
