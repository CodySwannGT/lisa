/**
 * Kind-keyed identity entries for `sessionManager.operatorIds` and
 * `sessionManager.trustedAuthorIds` (CodySwannGT/lisa#4623).
 *
 * ## Why this exists
 *
 * One plain config value used to mean two identities. An all-digit entry was
 * a numeric account id to the answer matcher (#4571: anyone can register an
 * all-digit login, nobody picks their own numeric id) but a login to the
 * Ready-queue order and the claim. So an operator whose GitHub login is all
 * digits could not answer on the item, and the stranger whose numeric id
 * equals that login could; switching the entry to the numeric id fixed the
 * answers and broke the queue. A kind-keyed entry names one identity, and
 * every reader matches it the same way:
 *
 * - `login:<v>` is a GitHub login and matches only a `login` field.
 * - `id:<v>` is an account id (a GitHub numeric id, a Jira accountId, a
 *   Linear user id) and matches only an id field.
 * - `integration:<service>` names an integration that files items with no
 *   person behind them (CodySwannGT/lisa#4895), and is meaningful only in
 *   `trustedAuthorIds`. Linear's Sentry integration creates issues whose
 *   `creator` is null, so there is no person id to trust; the entry matches
 *   such an item by the integration Linear records on it instead (`botActor`).
 *   It never matches an item a person authored, never an item a non-Linear
 *   user filed through an integration (`externalUserCreator`), and never a
 *   person, so it cannot answer a question or release a human hold: those
 *   readers drop it (`idComparableValues`, the answer matcher), and the
 *   validator refuses it in `operatorIds` and `trustedReleaseIds`.
 * - A plain entry (no prefix) keeps exactly the meaning each reader gave it
 *   before kind-keyed entries existed. Changing that is a later, breaking
 *   change.
 *
 * ## The prefix rule
 *
 * A prefix is one run of ASCII letters followed by `:` at the very start.
 * Jira accountIds can hold a colon (`557058:<uuid>`), but their part before
 * it is digits, so they stay plain. Jira Service Management portal customers
 * have accountIds that start with letters (`qm:<id>`); `qm` is therefore not
 * a prefix and such an id stays plain too. Any other letters-and-colon start
 * is an unknown prefix, and an entry whose prefix is followed by nothing is
 * an empty value. Both are invalid: a reader matches them against nobody and
 * `validate-config.mjs` refuses them, naming the entry.
 *
 * The validator ships as a standalone payload script and keeps its own copy
 * of this grammar; `tests/unit/scripts/operator-id-kinds.test.ts` pins the
 * two together on a table of entries.
 * @module operator-id-kinds
 */

/** The kinds a prefixed entry may name. */
export const ID_ENTRY_KINDS = Object.freeze(["login", "id", "integration"]);

/** A letters-only prefix at the start of an entry. */
const PREFIX = /^([A-Za-z]+):/;

/**
 * Letters-and-colon starts that belong to a real tracker id, never a prefix:
 * Jira Service Management portal customers' accountIds start `qm:`.
 */
const PLAIN_ID_STARTS = new Set(["qm"]);

/**
 * @typedef {{ kind: "login" | "id" | "integration" | "plain", value: string }
 *   | { kind: "invalid", problem: "unknown-prefix" | "empty-value", prefix: string }} IdEntry
 */

/**
 * Parse one entry. A number (a hand-written numeric id) reads as its string,
 * exactly as the readers have always taken it.
 * @param {unknown} entry - One `operatorIds` / `trustedAuthorIds` entry
 * @returns {IdEntry | null} The parsed entry; null for a non-string,
 *   non-number value
 */
export function parseIdEntry(entry) {
  if (typeof entry === "number") return { kind: "plain", value: String(entry) };
  if (typeof entry !== "string") return null;
  const prefix = PREFIX.exec(entry)?.[1];
  if (prefix === undefined || PLAIN_ID_STARTS.has(prefix)) {
    return { kind: "plain", value: entry };
  }
  if (!ID_ENTRY_KINDS.includes(prefix)) {
    return { kind: "invalid", problem: "unknown-prefix", prefix };
  }
  const value = entry.slice(prefix.length + 1).trim();
  return value === ""
    ? { kind: "invalid", problem: "empty-value", prefix }
    : { kind: prefix, value };
}

/**
 * Parse a configured list, dropping values that are not entries at all.
 * @param {unknown} entries - The configured list
 * @returns {IdEntry[]} Parsed entries, invalid ones kept so a reader can
 *   count them (an invalid trusted entry still means a filter is set)
 */
export function parseIdEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map(parseIdEntry)
    .filter(entry => entry !== null);
}

/**
 * Whether one parsed entry names the identity whose fields are given. Each
 * field is the reader's value for that kind: `plain` is what a plain entry
 * has always been compared with there, `login` the GitHub login (null when
 * the tracker has none), `id` the account id, `integration` the integration
 * that filed an item with no person author (null otherwise, and absent for
 * every reader that matches people). A missing field never matches.
 * @param {IdEntry} entry - Parsed entry
 * @param {{ plain?: string | null, login?: string | null, id?: string | null, integration?: string | null }} fields
 * @returns {boolean} Whether it matches
 */
export function entryMatches(entry, fields) {
  if (entry.kind === "invalid") return false;
  const actual = fields[entry.kind];
  return typeof actual === "string" && actual !== "" && actual === entry.value;
}

/**
 * The values an id-only comparator may hold, for a reader that compares
 * account ids and nothing else (the hold-release check in
 * `intake-blocker-reprobe.mjs`): plain entries as written and `id:` values.
 * A `login:` entry names a login, which such a reader never sees, so it is
 * dropped rather than compared with an id it could collide with.
 * @param {unknown} entries - The configured list
 * @returns {string[]} Values to compare as ids
 */
export function idComparableValues(entries) {
  return parseIdEntries(entries)
    .filter(entry => entry.kind === "plain" || entry.kind === "id")
    .map(entry => entry.value);
}
