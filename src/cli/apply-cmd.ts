import { existsSync } from "node:fs";
import type { Command } from "commander";
import type { runApply } from "./apply.js";
import { addSharedOptions, type CLIOptions } from "./shared-options.js";

/**
 * Support explicit apply and the legacy positional form for an existing path.
 * Register this before the update hook, which can write a cache on disk.
 * @param program - The root CLI command
 * @param apply - The apply action
 */
export function addApplyCommand(
  program: Command,
  apply: typeof runApply
): void {
  const command = addSharedOptions(
    program
      .command("apply", { isDefault: true })
      .description("Apply Lisa to an existing project (backwards-compatible)")
      .argument("[destination]", "Path to the project directory")
  ).action(async (destination: string | undefined, options: CLIOptions) => {
    await apply(destination, options);
  });

  // Commander sends unrecognized words to the default command. Checking the
  // parsed operand distinguishes a destination from options and their values.
  program.hook("preAction", (root, matched) => {
    const destination: unknown = matched.processedArgs[0];
    if (
      matched === command &&
      root.args[0] !== "apply" &&
      typeof destination === "string" &&
      !existsSync(destination)
    ) {
      root.error(
        `Unknown command ${JSON.stringify(destination)} in Lisa ${root.version()}. Run "lisa --help" to see the available commands.`,
        { code: "commander.unknownCommand" }
      );
    }
  });
}
