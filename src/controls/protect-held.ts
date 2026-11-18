/**
 * Why a derived check is held back instead of being made required.
 *
 * Requiring a check is only safe when something reports it. Each reason here
 * is one plain sentence or two, because it is printed as it stands in the
 * result document and in the file handed to an administrator: what was found,
 * what would go wrong, and what has to happen first.
 * @module controls/protect-held
 */
import { ACTIONS_INTEGRATION_ID } from "../health/ruleset-inspection.js";

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
    detail: `It has not run yet: the hosting platform shows no result under this exact name on ${on} or on the pull requests most recently merged into it. A result on a pull request that is still open, or that was closed without being merged, does not count, because it does not show that the branch runs the check. ${WAITS_FOR_EVER} First merge the workflow (or install the app) that reports it and let it run once, then run this command again.`,
  };
}

/**
 * Name the source a check would be required from.
 * @param appId - The app's id, or `null` for any source
 * @returns The source, as a sentence names it
 */
function sourceName(appId: number | null): string {
  if (appId === null) return "any source";
  return appId === ACTIONS_INTEGRATION_ID
    ? `GitHub Actions (app ${String(appId)})`
    : `app ${String(appId)}`;
}

/**
 * A check the platform shows a result for, but not from the source the
 * change would require it from.
 * @param on - The protected branch, as a sentence names it
 * @param wanted - The apps that would have to report it
 * @param seen - Who did report it, in words
 * @returns The reason
 */
export function reportedByAnother(
  on: string,
  wanted: readonly (number | null)[],
  seen: readonly string[]
): HeldBack {
  const from = wanted.map(sourceName).join(" and ");
  return {
    state: "not-ready",
    detail: `It has not been reported by the source that would be required: the hosting platform shows a result under this exact name on ${on} or on a pull request merged into it, but from ${seen.join(" and ")}, not from ${from}. Once required, only a result from ${from} would count, so requiring it now would leave every pull request waiting for a result that never arrives. If ${seen.join(" and ")} is what reports this check, name it in .lisa.config.json (posted_by on the gate that awaits it); otherwise let ${from} report it once, then run this command again.`,
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
    detail: `It could not be read whether this check has ever run on ${on} or on a pull request merged into it (${reason}), so it was not made required. ${WAITS_FOR_EVER.replace("Requiring it now", "Requiring a check that never reports")}`,
  };
}

/**
 * A check that a ruleset of unknown reach may already require.
 * @param on - The protected branch, as a sentence names it
 * @param ruleset - The ruleset's name
 * @param reason - Why it could not be worked out whether it covers the branch
 * @returns The reason
 */
export function reachNotKnown(
  on: string,
  ruleset: string,
  reason: string
): HeldBack {
  return {
    state: "unknown",
    detail: `It is not known whether this check is required on ${on}. The ruleset ${JSON.stringify(ruleset)} requires it, and it could not be worked out whether that ruleset covers ${on}: ${reason}. So it was neither counted as required nor made required a second time. Look at that ruleset's branch conditions on the hosting platform; if it covers ${on}, the check is already required.`,
  };
}
