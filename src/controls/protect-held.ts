/**
 * Why a derived check is held back instead of being made required.
 *
 * Requiring a check is only safe when something reports it. Each reason here
 * is one plain sentence or two, because it is printed as it stands in the
 * result document and in the file handed to an administrator: what was found,
 * what would go wrong, and what has to happen first.
 *
 * What has to happen first must be something that works. Naming an app in
 * the declaration works for a reporter that is an app; it cannot work for a
 * commit status, which does not say which app wrote it. So the step a
 * sentence names is chosen from what was seen ({@link reportedByAnother}),
 * never one sentence for every case.
 * @module controls/protect-held
 */
import { ACTIONS_INTEGRATION_ID } from "../health/ruleset-inspection.js";
import type { OtherReporters } from "./protect-reported.js";

export type { OtherReporters } from "./protect-reported.js";

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
 * How the app a held-back check would be required from came to be chosen.
 *
 * - `awaited`: another app reports the check and the configuration names
 *   that app (`posted_by` on the gate that awaits it, or `integration_id` on
 *   its entry under `github.rulesets.requiredChecks`). Left without an app,
 *   the check would be open to any source.
 * - `entry`: the check's entry under `github.rulesets.requiredChecks`
 *   decides. Left without an app there, it is required from GitHub Actions,
 *   not from any source.
 * - `pipeline`: a pipeline job reports the check and nothing is declared
 *   about its app, which is GitHub Actions.
 */
export type PinOrigin = "awaited" | "entry" | "pipeline";

/**
 * Pick the origin that speaks for a check several declarations ask for.
 *
 * The one that leaves the operator the fewest steps wins, so that no step is
 * named that would not work for one of the declarations.
 * @param origins - How the app of each declaration came to be chosen
 * @returns The origin to word the remedy for
 */
export function leastOpen(origins: readonly PinOrigin[]): PinOrigin {
  if (origins.includes("entry")) return "entry";
  return origins.includes("awaited") ? "awaited" : "pipeline";
}

/** How a sentence names a check run the platform gives no app for. */
const UNNAMED_RUN = "a check run that names no app";

/** How a sentence names a commit status. */
const COMMIT_STATUS = "a commit status";

/** The last step of every remedy. */
const RUN_AGAIN = "run this command again.";

/** Where the app of a check is declared, by how it came to be chosen. */
const WHERE_NAMED: Readonly<Record<Exclude<PinOrigin, "pipeline">, string>> = {
  awaited:
    "posted_by on the gate that awaits it, or integration_id under github.rulesets.requiredChecks",
  entry: "integration_id under github.rulesets.requiredChecks",
};

/**
 * Join names the way a sentence lists them.
 * @param names - The names
 * @returns The names with `and` between them
 */
function listed(names: readonly string[]): string {
  return names.join(" and ");
}

/**
 * Say what to do about the reporters that do not say which app they are.
 *
 * Naming an app in the declaration only helps for a reporter that has one.
 * A commit status has none, so there are two things that work: declare the
 * check without an app, which lets any source report it, or have the app
 * report a check run. Only an awaited check is opened to any source by
 * leaving its app out, so that half is offered for no other.
 * @param from - The source that would be required, as a sentence names it
 * @param unnamed - The reporters, as a sentence names them; never empty
 * @param origin - How the app came to be chosen
 * @returns The sentences
 */
function withoutAnApp(
  from: string,
  unnamed: readonly string[],
  origin: PinOrigin
): string {
  const one = unnamed.length === 1;
  const who = listed(unnamed);
  const why = `${who.charAt(0).toUpperCase()}${who.slice(1)} ${one ? "does" : "do"} not say which app reported ${one ? "it" : "them"}, so ${one ? "it" : "they"} can never count for a check that names an app, and there is no app to name for ${one ? "it" : "them"}.`;
  return origin === "awaited"
    ? `${why} If ${who} ${one ? "is" : "are"} what reports this check, declare the check without an app in .lisa.config.json (remove posted_by from the gate that awaits it, and any integration_id for it under github.rulesets.requiredChecks), so that any source may report it; otherwise have ${from} report it as a check run. Then ${RUN_AGAIN}`
    : `${why} Have ${from} report it as a check run, then ${RUN_AGAIN}`;
}

/**
 * Say what has to happen before a check that something else reports can be
 * required.
 *
 * Every step named here is one that works for what was seen. Which that is
 * depends on who reported the name and on how the app the check is required
 * from came to be chosen, so both are asked for.
 * @param from - The source that would be required, as a sentence names it
 * @param seen - Who did report it
 * @param origin - How the app came to be chosen
 * @returns The sentences
 */
function remedy(from: string, seen: OtherReporters, origin: PinOrigin): string {
  if (origin === "pipeline") {
    return `This check is one a pipeline job in this repository reports, so only GitHub Actions counts for it, and what was seen comes from something else that uses the same name. Merge the workflow that reports it and let it run once, then ${RUN_AGAIN}`;
  }
  const one = seen.apps.length === 1;
  const naming = `If ${listed(seen.apps.map(sourceName))} ${one ? "is" : "are"} what reports this check, name ${one ? "it" : "the one that does"} for the check in .lisa.config.json (${WHERE_NAMED[origin]})`;
  const unnamed = [
    ...(seen.unnamedRun ? [UNNAMED_RUN] : []),
    ...(seen.commitStatus ? [COMMIT_STATUS] : []),
  ];
  if (unnamed.length === 0) {
    return `${naming}; otherwise let ${from} report it once, then ${RUN_AGAIN}`;
  }
  const rest = withoutAnApp(from, unnamed, origin);
  return seen.apps.length === 0 ? rest : `${naming}. ${rest}`;
}

/**
 * A check the platform shows a result for, but not from the source the
 * change would require it from.
 *
 * The source named as missing is the app, or apps, the check would be pinned
 * to. A declaration any source satisfies is left out of it: a result was
 * seen, so that declaration is not what is missing.
 * @param on - The protected branch, as a sentence names it
 * @param wanted - The apps that would have to report it
 * @param seen - Who did report it
 * @param origin - How the app it is required from came to be chosen
 * @returns The reason
 */
export function reportedByAnother(
  on: string,
  wanted: readonly (number | null)[],
  seen: OtherReporters,
  origin: PinOrigin
): HeldBack {
  const pinned = wanted.filter(app => app !== null);
  const from = listed([
    ...new Set((pinned.length === 0 ? wanted : pinned).map(sourceName)),
  ]);
  const who = listed([
    ...seen.apps.map(sourceName),
    ...(seen.unnamedRun ? [UNNAMED_RUN] : []),
    ...(seen.commitStatus ? [COMMIT_STATUS] : []),
  ]);
  return {
    state: "not-ready",
    detail: `It has not been reported by the source that would be required: the hosting platform shows a result under this exact name on ${on} or on a pull request merged into it, but from ${who}, not from ${from}. Once required, only a result from ${from} would count, so requiring it now would leave every pull request waiting for a result that never arrives. ${remedy(from, seen, origin)}`,
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
