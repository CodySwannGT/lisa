import { confirm, select } from "@inquirer/prompts";
import type { ProjectType } from "../core/config.js";

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
}

/**
 * Interactive prompter using @inquirer/prompts
 */
export class InteractivePrompter implements IPrompter {
  async promptOverwrite(relativePath: string): Promise<OverwriteDecision> {
    const choice = await select({
      message: `File differs: ${relativePath}\nOverwrite?`,
      choices: [
        { name: "Yes - overwrite", value: "yes" as const },
        { name: "No - skip", value: "no" as const },
        { name: "Diff - show differences", value: "diff" as const },
      ],
    });
    return choice;
  }

  async confirmProjectTypes(
    detected: readonly ProjectType[]
  ): Promise<readonly ProjectType[]> {
    const typesDisplay =
      detected.length > 0 ? detected.join(", ") : "(none detected)";

    const confirmed = await confirm({
      message: `Detected project types: ${typesDisplay}\nContinue with these types?`,
      default: true,
    });

    if (confirmed) {
      return detected;
    }

    // Allow user to specify types manually
    // For simplicity, just return detected types for now
    // Full implementation would allow type selection
    return detected;
  }
}

/**
 * Auto-accepting prompter for non-interactive mode
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
}

/**
 * Check if running in interactive mode (TTY available)
 */
export function isInteractive(): boolean {
  return process.stdin.isTTY === true;
}

/**
 * Create appropriate prompter based on mode and TTY
 */
export function createPrompter(yesMode: boolean): IPrompter {
  if (yesMode || !isInteractive()) {
    return new AutoAcceptPrompter();
  }
  return new InteractivePrompter();
}
