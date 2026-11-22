/**
 * The assign-on-take rule (CodySwannGT/lisa#5029), as a check `spawn` runs
 * before it launches anything.
 *
 * The rule (runbook "Fixed facts", "Taking an item"): every item the manager
 * takes is assigned to "me" when it has no assignee, and nothing is ever
 * dispatched unassigned. The claim step used to do the assigning implicitly,
 * and the dispatch step accepted the claim's word for it, so an item the
 * manager released, re-dispatched or drove itself could reach a worker with
 * nobody named on it. `spawn` now needs the assignees the manager read back
 * from the tracker (`--assignees`) and refuses, with exit 5, an item that is
 * unassigned or held by anyone other than "me" or an operator.
 *
 * An assignee is compared exactly as the queue and the orphan sweep compare
 * one: a plain string is the tracker's normalized id (GitHub login, Jira
 * accountId, Linear user id), and a `{login, id}` object (GitHub, with the
 * REST numeric id) also matches `login:` and `id:` operator entries.
 * Pure: no I/O.
 * @module session-manager/take-check
 */
import {
  entryMatches,
  parseIdEntries,
} from "../../../scripts/operator-id-kinds.mjs";

/**
 * A trimmed id string, or null. Numeric ids become strings.
 * @param {unknown} value - Raw id
 * @returns {string | null} Comparable id
 */
function idOrNull(value) {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return Number.isSafeInteger(value) ? String(value) : null;
}

/**
 * The fields one assignee is compared on: a plain string is the tracker's
 * normalized id (GitHub login, Jira accountId, Linear user id); a
 * `{login, id}` object adds the kind-keyed fields.
 * @param {unknown} assignee - One assignee as the tracker gave it
 * @returns {{plain: string|null, login: string|null, id: string|null}} Fields
 */
export function assigneeFields(assignee) {
  if (assignee !== null && typeof assignee === "object") {
    const login = idOrNull(assignee.login);
    const id = idOrNull(assignee.id ?? assignee.accountId);
    return { plain: login ?? id, login, id };
  }
  return { plain: idOrNull(assignee), login: null, id: null };
}

/**
 * The fields `spawn` compares one read-back assignee on. A plain string means
 * what the tracker's normalized id is: on GitHub a login (so `login:` entries
 * match it and `id:` entries never do, since anyone can pick an all-digit
 * login), and on Jira and Linear an account id (so `id:` entries match it).
 * With no known tracker it keeps `assigneeFields`' plain-only reading.
 * @param {unknown} assignee - One assignee as read back
 * @param {string | undefined} tracker - `github`, `jira` or `linear`
 * @returns {{plain: string|null, login: string|null, id: string|null}} Fields
 */
function takenFields(assignee, tracker) {
  const fields = assigneeFields(assignee);
  if (typeof assignee !== "string" || fields.plain === null) return fields;
  if (tracker === "github") return { ...fields, login: fields.plain };
  if (tracker === "jira" || tracker === "linear") {
    return { ...fields, id: fields.plain };
  }
  return fields;
}

/**
 * Whether one assignee is "me" or an operator.
 * @param {{plain: string|null, login: string|null, id: string|null}} fields - Assignee fields
 * @param {{me: string|null, operators: object[]}} who - Identities
 * @returns {boolean} True for "me" or an operator
 */
export function isMeOrOperator(fields, who) {
  if (fields.plain === null) return false;
  if (who.me !== null && fields.plain === who.me) return true;
  return who.operators.some(entry => entryMatches(entry, fields));
}

/**
 * Judge whether an item may be dispatched under the assign-on-take rule.
 * @param {unknown} assignees - The item's live assignees, as read back
 * @param {{me?: string|null, operatorIds?: unknown, tracker?: string}} identities - "Me"
 *   (`ledger control.me`), `sessionManager.operatorIds`, and the project's
 *   tracker, which says what a plain assignee string is
 * @returns {{ok: true} | {ok: false, reason: "unassigned"|"foreign", foreign: string[]}}
 *   `unassigned`: nobody is named, so assign "me" and read it back first;
 *   `foreign`: someone other than "me" or an operator holds it, so leave it
 */
export function judgeTake(assignees, identities) {
  const who = {
    me: idOrNull(identities.me),
    operators: parseIdEntries(identities.operatorIds),
  };
  const named = (Array.isArray(assignees) ? assignees : [])
    .map(assignee => takenFields(assignee, identities.tracker))
    .filter(fields => fields.plain !== null);
  if (named.length === 0)
    return { ok: false, reason: "unassigned", foreign: [] };
  const foreign = named
    .filter(fields => !isMeOrOperator(fields, who))
    .map(fields => fields.plain);
  return foreign.length === 0
    ? { ok: true }
    : { ok: false, reason: "foreign", foreign };
}
