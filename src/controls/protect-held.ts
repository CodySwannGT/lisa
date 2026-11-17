/**
 * Why a derived check is held back instead of being made required.
 *
 * Requiring a check is only safe when something reports it. Each reason here
 * is one plain sentence or two, because it is printed as it stands in the
 * result document and in the file handed to an administrator: what was found,
 * what would go wrong, and what has to happen first.
 * @module controls/protect-held
 */

/** A check that must not be required as things stand, and why. */
export interface HeldBack {
  /**
   * `not-ready`: nothing reports it yet. `excluded`: the repository's own
   * configuration says never to require it. `unknown`: it could not be read
   * whether anything reports it.
   */
  readonly state: "not-ready" | "excluded" | "unknown";
  /** The sentence that says so. */
  readonly detail: string;
}

/** What requiring a check that never reports does to a repository. */
const WAITS_FOR_EVER =
  "Requiring it now would leave every pull request waiting for a result that never arrives.";

/** A pipeline check in a repository that has no pipeline. */
export const NO_WORKFLOW_FOLDER: HeldBack = {
  state: "not-ready",
  detail: `It has not run yet, and nothing in this repository can run it: there is no .github/workflows folder, so GitHub Actions has nothing to start. ${WAITS_FOR_EVER} First add and merge the workflow that reports this check.`,
};

/** A check the repository's configuration opts out of. */
export const DROPPED_BY_CONFIGURATION: HeldBack = {
  state: "excluded",
  detail:
    "This repository's own configuration (.lisa.config.json, under github.rulesets.dropRequiredChecks) says it must never be required, while the control register says the platform enforces it. The two disagree. Take it off that list, or declare the rule's tier as advisory.",
};

/**
 * A check the platform has never shown a result for.
 * @param on - The protected branch, as a sentence names it
 * @returns The reason
 */
export function neverReported(on: string): HeldBack {
  return {
    state: "not-ready",
    detail: `It has not run yet: the hosting platform shows no result under this exact name on ${on} or on the most recent pull requests into it. ${WAITS_FOR_EVER} First merge the workflow (or install the app) that reports it and let it run once, then run this command again.`,
  };
}

/**
 * A check whose history could not be read.
 * @param on - The protected branch, as a sentence names it
 * @param reason - What the read answered
 * @returns The reason
 */
export function reportingNotRead(on: string, reason: string): HeldBack {
  return {
    state: "unknown",
    detail: `It could not be read whether this check has ever run on ${on} or on a recent pull request into it (${reason}), so it was not made required. ${WAITS_FOR_EVER.replace("Requiring it now", "Requiring a check that never reports")}`,
  };
}
