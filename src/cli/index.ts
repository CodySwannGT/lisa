import { Command } from "commander";
import { runApply } from "./apply.js";
import { printUpdateWarning } from "./print-update-warning.js";
import { runSetupProject } from "./setup-project.js";
import { addSharedOptions, type CLIOptions } from "./shared-options.js";
import { SETUP_TYPES } from "./starters.js";
import { runUpdateCheck } from "./update-check.js";
import { getPackageVersion } from "./version.js";

/**
 * Injectable collaborators for {@link createProgram}. Defaults wire the real
 * apply action and npm update-check; tests override them to observe the program
 * wiring without touching the registry or the orchestrator.
 */
export interface ProgramDependencies {
  /** Applies Lisa to a destination (defaults to the real {@link runApply}). */
  runApply: typeof runApply;
  /** Creates a starter-backed project and applies Lisa overlays. */
  runSetupProject: typeof runSetupProject;
  /** Runs the non-fatal npm update check (defaults to {@link runUpdateCheck}). */
  runUpdateCheck: typeof runUpdateCheck;
  /** Prints the update warning (defaults to {@link printUpdateWarning}). */
  printUpdateWarning: typeof printUpdateWarning;
}

const DEFAULT_DEPENDENCIES: ProgramDependencies = {
  runApply,
  runSetupProject,
  runUpdateCheck,
  printUpdateWarning,
};

/**
 * Create and configure the CLI program.
 *
 * The root program is subcommand-style: `apply` is the explicit subcommand and
 * also the default command, so the historical positional `lisa <dest>`
 * invocation keeps working. Both forms call the same apply action. A
 * `preAction` hook runs the npm update-check exactly once per invocation before
 * any action fires.
 * @param dependencies - Optional collaborator overrides for testing
 * @returns Configured Commander program
 */
export function createProgram(
  dependencies: Partial<ProgramDependencies> = {}
): Command {
  const deps: ProgramDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...dependencies,
  };
  const program = new Command();

  program
    .name("lisa")
    .description(
      "Claude Code / Codex CLI governance framework - apply guardrails and guidance to projects"
    )
    .version(getPackageVersion())
    .option("--no-update-check", "Skip the npm latest-version check");

  // Run the npm update-check once per invocation, before the matched action.
  // It is non-fatal: a failed check never blocks the action from running.
  program.hook("preAction", async () => {
    if (program.opts().updateCheck === false) {
      return;
    }
    const result = await deps.runUpdateCheck();
    deps.printUpdateWarning(result);
  });

  // `apply` is both the explicit subcommand and the default command, so the
  // historical positional form `lisa <destination>` routes here unchanged and
  // produces the same result as `lisa apply <destination>`. Commander rejects a
  // root-level positional `argument` once subcommands exist, so the default
  // command is the supported way to keep the bare-positional invocation.
  addSharedOptions(
    program
      .command("apply", { isDefault: true })
      .description("Apply Lisa to an existing project (backwards-compatible)")
      .argument("[destination]", "Path to the project directory")
  ).action(async (destination: string | undefined, options: CLIOptions) => {
    await deps.runApply(destination, options);
  });

  addSharedOptions(
    program
      .command("setup-project")
      .description("Create a new Lisa-managed project from a starter repo")
      .requiredOption(
        "--type <type>",
        `Project type: ${SETUP_TYPES.join(" | ")}`
      )
      .argument("[destination]", "Project name or path (default: ./<type>-app)")
  ).action(
    async (
      destination: string | undefined,
      options: CLIOptions & { type?: string }
    ) => {
      await deps.runSetupProject(destination, options);
    }
  );

  return program;
}

export { createPrompter } from "./prompts.js";
