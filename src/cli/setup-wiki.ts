import { type CLIOptions } from "./shared-options.js";
import { runApply } from "./apply.js";

/** Options parsed for the setup-wiki command. */
export type SetupWikiOptions = CLIOptions;

/** Runtime collaborators for setup-wiki. */
export interface SetupWikiDependencies {
  runApply: (
    destination: string | undefined,
    options: CLIOptions
  ) => Promise<void>;
}

const DEFAULT_DEPENDENCIES: SetupWikiDependencies = {
  runApply,
};

/**
 * Prepare an existing project for embedded Lisa wiki setup.
 *
 * The wiki kernel is delivered through Lisa's plugin and skill overlay, so the
 * CLI command reuses the normal apply path against the target project. After
 * apply, the runtime-specific `/setup:wiki` or `$lisa-wiki-setup` command owns
 * the interactive wiki scaffold/repair workflow.
 * @param destination - Optional project path, defaults to the current directory
 * @param options - Parsed shared Lisa options
 * @param dependencies - Injectable collaborators
 * @returns Promise that resolves after Lisa apply completes
 */
export async function runSetupWiki(
  destination: string | undefined,
  options: SetupWikiOptions,
  dependencies: SetupWikiDependencies = DEFAULT_DEPENDENCIES
): Promise<void> {
  await dependencies.runApply(destination ?? ".", options);
}
