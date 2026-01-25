import { confirm, select } from "@inquirer/prompts";
import type { ProjectType } from "../core/config.js";

/**
 * Message shown when uncommitted changes are detected
 */
const UNCOMMITTED_CHANGES_HEADER = "\nUncommitted changes detected:";

/**
 * Confirmation message for dirty git prompt
 */
const DIRTY_GIT_CONFIRM_MESSAGE =
  "Your git working directory has uncommitted changes.\nContinue with Lisa anyway?";

/**
 * Overwrite decision options
 */
export type OverwriteDecision = "yes" | "no" | "diff";

/**
 * Interface for user prompts
 */
export interface IPrompter {
  /**
   * Prompt for file overwrite decision
   * @param relativePath Path to the conflicting file
   * @returns User's decision
   */
  promptOverwrite(relativePath: string): Promise<OverwriteDecision>;

  /**
   * Confirm detected project types with user
   * @param detected Array of detected project types
   * @returns Confirmed/modified project types
   */
  confirmProjectTypes(
    detected: readonly ProjectType[]
  ): Promise<readonly ProjectType[]>;

  /**
   * Confirm proceeding with dirty git working directory
   * @param status Git status output showing uncommitted changes
   * @returns True if user wants to proceed despite dirty state
   */
  confirmDirtyGit(status: string): Promise<boolean>;
}

/**
 * Interactive prompter using {@link https://github.com/enquirer/enquirer inquirer}/prompts
 */
export class InteractivePrompter implements IPrompter {
  async promptOverwrite(relativePath: string): Promise<OverwriteDecision> {
    return select({
      message: `File differs: ${relativePath}\nOverwrite?`,
      choices: [
        { name: "Yes - overwrite", value: "yes" as const },
        { name: "No - skip", value: "no" as const },
        { name: "Diff - show differences", value: "diff" as const },
      ],
    });
  }

  async confirmProjectTypes(
    detected: readonly ProjectType[]
  ): Promise<readonly ProjectType[]> {
    const typesDisplay =
      detected.length > 0 ? detected.join(", ") : "(none detected)";

    await confirm({
      message: `Detected project types: ${typesDisplay}\nContinue with these types?`,
      default: true,
    });

    return detected;
  }

  async confirmDirtyGit(status: string): Promise<boolean> {
    console.log(UNCOMMITTED_CHANGES_HEADER);
    console.log(status);
    console.log("");

    return confirm({
      message: DIRTY_GIT_CONFIRM_MESSAGE,
      default: false,
    });
  }
}

/**
 * Auto-accepting prompter for non-interactive mode
 *
 * Note: confirmDirtyGit always prompts interactively even in auto-accept mode,
 * as running Lisa on a dirty working directory requires explicit user consent.
 */
export class AutoAcceptPrompter implements IPrompter {
  async promptOverwrite(_relativePath: string): Promise<OverwriteDecision> {
    return "yes";
  }

  async confirmProjectTypes(
    detected: readonly ProjectType[]
  ): Promise<readonly ProjectType[]> {
    return detected;
  }

  async confirmDirtyGit(status: string): Promise<boolean> {
    // Always prompt for dirty git, even in auto-accept mode
    // This is intentional - running Lisa on uncommitted changes is risky
    if (!isInteractive()) {
      // If not in TTY, cannot prompt - fail safe by returning false
      console.log(UNCOMMITTED_CHANGES_HEADER);
      console.log(status);
      console.log("");
      console.log(
        "Cannot proceed: working directory has uncommitted changes and no TTY available for confirmation."
      );
      console.log("Please commit or stash your changes before running Lisa.");
      return false;
    }

    console.log(UNCOMMITTED_CHANGES_HEADER);
    console.log(status);
    console.log("");

    return confirm({
      message: DIRTY_GIT_CONFIRM_MESSAGE,
      default: false,
    });
  }
}

/**
 * Check if running in interactive mode (TTY available)
 * @returns True if running in TTY mode
 */
export function isInteractive(): boolean {
  return process.stdin.isTTY === true;
}

/**
 * Create appropriate prompter based on mode and TTY
 * @param yesMode Non-interactive mode flag
 * @returns Prompter instance
 */
export function createPrompter(yesMode: boolean): IPrompter {
  if (yesMode || !isInteractive()) {
    return new AutoAcceptPrompter();
  }
  return new InteractivePrompter();
}
