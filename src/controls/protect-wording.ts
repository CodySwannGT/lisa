/**
 * The sentences `lisa controls protect` reports its outcomes in.
 *
 * Each reason is read by whoever stands at the gate — an operator, or the
 * administrator the change is handed to — so each one says, in plain words,
 * what was found and what would change it.
 * @module controls/protect-wording
 */
import type { ProtectedEntry } from "./protect-derive.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import {
  PULL_REQUEST_MOMENT,
  type CriterionOutcome,
  type EntryOutcome,
  type RequiredCheck,
} from "./protect-types.js";
import { mechanismAt } from "./register-types.js";

/** Why nothing was changed when the command was not told to change anything. */
export const NOT_ASKED_TO_APPLY =
  "Nothing was changed, because the command was run without --apply.";

/** Why a run that sent a change still is not wired. */
export const READ_BACK_DIFFERS =
  "The change was sent, but the settings read back afterwards do not require every derived check.";

/**
 * Put a name in backticks, as a sentence quotes it.
 * @param name - A check or branch name
 * @returns The name in backticks
 */
function quoted(name: string): string {
  return `\`${name}\``;
}

/**
 * Name the branch in a sentence.
 * @param branch - The branch, or `null` when none is known
 * @returns For example `` `main` `` or `the default branch`
 */
export function branchName(branch: string | null): string {
  return branch === null ? "the default branch" : `\`${branch}\``;
}

/**
 * Say that the live settings could not be read.
 * @param detail - What the read answered
 * @returns The reason
 */
export function couldNotRead(detail: string): string {
  return `The repository's merge protection could not be read (${detail}), so nothing was compared and nothing was changed.`;
}

/**
 * Say that the default branch the platform named cannot be used.
 * @param named - The name the platform gave
 * @returns The reason
 */
export function unusableDefaultBranch(named: string): string {
  return `The platform names ${JSON.stringify(named)} as the repository's default branch, and that is not a branch name this command can put in a request, so nothing was compared and nothing was changed. Say which branch to protect with --branch <name>.`;
}

/**
 * Say that a change which creates a ruleset could not be read back.
 * @param listed - How many rulesets the platform lists now
 * @param page - The most the platform lists in one answer
 * @returns The reason
 */
export function couldNotBeReadBack(listed: number, page: number): string {
  return `The hosting platform lists ${String(listed)} rulesets for this repository (ones its organisation applies to it count), and requiring these checks would create one more. It lists at most ${String(page)} in one answer, and a full answer cannot be told from a list that goes on, so the change could not be confirmed once it was sent. Delete a ruleset that is no longer needed, or name an existing ruleset to hold these checks with --ruleset <name>.`;
}

/**
 * Say that the platform refused the change.
 * @param failures - What it answered, one per refused step
 * @returns The reason
 */
export function writeRefused(failures: readonly string[]): string {
  return `The platform refused the change: ${failures.join(" | ").replaceAll(/\s+/gu, " ")}`;
}

/**
 * Say that every derived check is required.
 * @param branch - The branch that was compared
 * @param changed - Whether this run sent a change
 * @returns The reason
 */
export function allRequired(branch: string | null, changed: boolean): string {
  const how = changed
    ? "The change was sent in this run and the settings were read back."
    : "Nothing needed to change.";
  return `Every check the control register derives is required on ${branchName(branch)}. ${how}`;
}

/** What the run found, beside the checks themselves. */
export interface RunFacts {
  /** The branch that was compared, when one is known. */
  readonly branch: string | null;
  /** Why this run did not require what is missing; empty when nothing is. */
  readonly runReason: string;
  /**
   * The checks it is not known to be required or not, because a ruleset
   * whose reach could not be worked out holds them.
   */
  readonly unconfirmed?: ReadonlySet<string> | undefined;
}

/**
 * Say why one check leaves an entry blocked.
 * @param check - The check
 * @param facts - What the run found
 * @returns The reason
 */
function checkReason(check: RequiredCheck, facts: RunFacts): string {
  const name = quoted(check.context);
  const on = branchName(facts.branch);
  if (check.state === "required") return "";
  const notConfirmed = `It could not be confirmed that ${name} is required on ${on}.`;
  if (check.detail !== null) {
    return facts.unconfirmed?.has(check.context) === true
      ? `${notConfirmed} ${check.detail}`
      : `${name} is not required on ${on}. ${check.detail}`;
  }
  return check.state === "unknown"
    ? `${notConfirmed} ${facts.runReason}`
    : `${name} is not required on ${on}. ${facts.runReason}`;
}

/**
 * Say why an entry with no check cannot be wired.
 * @param protectedEntry - The entry
 * @returns The reason
 */
function noCheckReason(protectedEntry: ProtectedEntry): string {
  const { entry } = protectedEntry;
  const point = entry.enforcement_points.find(
    candidate => candidate.moment === PULL_REQUEST_MOMENT
  );
  const kind = point === undefined ? "nothing" : mechanismAt(entry, point).kind;
  return `The control register says the hosting platform enforces this rule, but the rule has no check a platform can require: on a pull request it is measured by "${kind}". Give the gate a command, a task or an awaited check in ${GATES_DECLARATION_PATH}, or declare its tier as advisory.`;
}

/**
 * Report the outcome of one register entry.
 * @param protectedEntry - The entry and the names of its checks
 * @param checks - Every derived check, with where it stands
 * @param facts - The branch that was compared, why this run did not require
 *   what is missing, and the checks of unknown standing
 * @returns The entry's outcome, once for the entry and once per requirement
 */
export function entryOutcome(
  protectedEntry: ProtectedEntry,
  checks: readonly RequiredCheck[],
  facts: RunFacts
): EntryOutcome {
  const { branch } = facts;
  const { entry } = protectedEntry;
  const own = checks.filter(check =>
    protectedEntry.checks.includes(check.context)
  );
  const open = own.filter(check => check.state !== "required");
  const wired = own.length > 0 && open.length === 0;
  const names = own.map(check => quoted(check.context)).join(" and ");
  const reason = wired
    ? `The hosting platform requires ${names} on ${branchName(branch)}.`
    : own.length === 0
      ? noCheckReason(protectedEntry)
      : open.map(check => checkReason(check, facts)).join(" ");
  const outcome = wired ? "wired" : "blocked";
  return {
    id: entry.id,
    gate: entry.gate,
    scope: entry.scope,
    checks: protectedEntry.checks,
    outcome,
    reason,
    criteria: entry.criteria.map(
      (criterion): CriterionOutcome => ({ criterion, outcome, reason })
    ),
  };
}

/**
 * List what the platform does not require as derived.
 * @param checks - Every derived check, with where it stands
 * @param branch - The branch that was compared
 * @param unconfirmed - The checks it is not known to be required or not,
 *   because a ruleset whose reach could not be worked out holds them
 * @returns One line per check that is known not to be required. A check
 *   whose required state was never read, or is not known, is left out; one
 *   that was read as not required is listed even when it is unknown whether
 *   it has ever run
 */
export function differencesOf(
  checks: readonly RequiredCheck[],
  branch: string | null,
  unconfirmed: ReadonlySet<string> = new Set()
): readonly string[] {
  return checks
    .filter(
      check =>
        check.state !== "required" &&
        !unconfirmed.has(check.context) &&
        !(check.state === "unknown" && check.detail === null)
    )
    .map(
      check => `\`${check.context}\` is not required on ${branchName(branch)}.`
    );
}
