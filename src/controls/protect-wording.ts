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
  type CheckState,
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

/**
 * Say why one check leaves an entry blocked.
 * @param check - The check
 * @param branch - The branch that was compared
 * @param runReason - Why this run did not make it required
 * @returns The reason
 */
function checkReason(
  check: RequiredCheck,
  branch: string | null,
  runReason: string
): string {
  const name = `\`${check.context}\``;
  const on = branchName(branch);
  const sentences: Record<Exclude<CheckState, "required">, string> = {
    missing: `${name} is not required on ${on}. ${runReason}`,
    unknown: `It could not be confirmed that ${name} is required on ${on}. ${runReason}`,
    "not-ready": `${name} is not required on ${on}, and nothing in this repository reports it yet (there is no .github/workflows folder), so requiring it now would hold every pull request waiting. Add and merge the workflow that reports it, then run this again.`,
    excluded: `${name} is not required on ${on}, and ${GATES_DECLARATION_PATH} lists it under github.rulesets.dropRequiredChecks, which says never to require it. Take it off that list, or declare the rule's tier as advisory.`,
  };
  return check.state === "required" ? "" : sentences[check.state];
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
 * @param branch - The branch that was compared
 * @param runReason - Why this run did not require what is missing
 * @returns The entry's outcome, once for the entry and once per requirement
 */
export function entryOutcome(
  protectedEntry: ProtectedEntry,
  checks: readonly RequiredCheck[],
  branch: string | null,
  runReason: string
): EntryOutcome {
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
      : open.map(check => checkReason(check, branch, runReason)).join(" ");
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
 * @returns One line per check that is known not to be required
 */
export function differencesOf(
  checks: readonly RequiredCheck[],
  branch: string | null
): readonly string[] {
  return checks
    .filter(check => check.state !== "required" && check.state !== "unknown")
    .map(
      check => `\`${check.context}\` is not required on ${branchName(branch)}.`
    );
}
