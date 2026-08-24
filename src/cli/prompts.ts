import { confirm, select } from "@inquirer/prompts";
import type { ProjectType } from "../core/config.js";

/**
 * Header printed before git status so users see context before deciding.
 */
const UNCOMMITTED_CHANGES_HEADER = "\nUncommitted changes detected:";

/**
 * Explicit consent prompt to avoid overwriting uncommitted work.
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
   * Whether this run has no operator decision available to it — neither a live
   * prompt to answer nor a `--yes` given in advance.
   *
   * The apply needs to tell those apart, and the prompter is the only thing
   * that knows. A `--yes` run is *attended*: the operator decided before
   * starting. A run with no TTY and no flag is not — there is nobody to ask,
   * and answering on their behalf is what #3026 was.
   */
  readonly unattended: boolean;

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
   * Gate risky runs on explicit user consent, even in --yes mode.
   * @param status Git status output showing uncommitted changes
   * @returns True if user wants to proceed despite dirty state
   */
  confirmDirtyGit(status: string): Promise<boolean>;
}

/**
 * Interactive prompter using {@link https://github.com/enquirer/enquirer inquirer}/prompts
 */
export class InteractivePrompter implements IPrompter {
  /** A human is at the keyboard and answers every question. */
  readonly unattended = false;

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
 * Auto-accepting prompter for `--yes`
 *
 * Reached only when the operator passed the flag. That flag *is* the decision —
 * "replace what differs, do not ask me" — so this prompter is attended even
 * though nothing is interactive about it. What it must never cover is a run
 * where no such flag was given; see {@link UnattendedPrompter}.
 *
 * Note: confirmDirtyGit always prompts interactively even in auto-accept mode,
 * as running Lisa on a dirty working directory requires explicit user consent.
 */
export class AutoAcceptPrompter implements IPrompter {
  /** The operator decided in advance by passing `--yes`. */
  readonly unattended = false;

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
 * Prompter for a run with no operator on either end — no TTY to ask, and no
 * `--yes` given in advance.
 *
 * This is the common case, not the exotic one: every agent-driven, scripted,
 * and CI `lisa apply` lands here. It used to be answered by
 * {@link AutoAcceptPrompter}, which says "yes" to every overwrite. So a bare
 * `lisa apply` replaced host-customised `knip.json`, `eslint.config.ts`, and
 * `tsconfig.json` and reported the result under "Overwritten: N files
 * (approved or Lisa-owned)" — nobody approved them, and Lisa owns none of
 * them. The absence of a terminal was being read as consent from an operator
 * who was never there (#3026).
 *
 * It answers "no" so that nothing is silently replaced even if a caller builds
 * a strategy context by hand. The apply's own routing does the rest: an
 * unattended run takes the same branch the postinstall does, which reports the
 * file as out of date and still honours `--refresh-templates`, the flag that
 * means "take upstream's version of these".
 */
export class UnattendedPrompter implements IPrompter {
  /** There is nobody to ask and no answer was given in advance. */
  readonly unattended = true;

  async promptOverwrite(_relativePath: string): Promise<OverwriteDecision> {
    return "no";
  }

  async confirmProjectTypes(
    detected: readonly ProjectType[]
  ): Promise<readonly ProjectType[]> {
    return detected;
  }

  async confirmDirtyGit(status: string): Promise<boolean> {
    console.log(UNCOMMITTED_CHANGES_HEADER);
    console.log(status);
    console.log("");
    console.log(
      "Cannot proceed: working directory has uncommitted changes and no TTY available for confirmation."
    );
    console.log("Please commit or stash your changes before running Lisa.");
    return false;
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
 *
 * The three cases are three different sources of authority, and collapsing any
 * two of them loses the distinction that matters. `--yes` is consent given in
 * advance. A TTY is consent obtainable on demand. Neither one is a run with no
 * operator at all, which gets a prompter that declines rather than one that
 * invents an approval (#3026).
 * @param yesMode Non-interactive mode flag
 * @returns Prompter instance
 */
export function createPrompter(yesMode: boolean): IPrompter {
  if (yesMode) {
    return new AutoAcceptPrompter();
  }
  if (!isInteractive()) {
    return new UnattendedPrompter();
  }
  return new InteractivePrompter();
}
