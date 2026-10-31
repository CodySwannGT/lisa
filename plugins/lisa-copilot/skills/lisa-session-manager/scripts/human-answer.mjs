/**
 * Reading a human's answer back off a work item (CodySwannGT/lisa#4555,
 * part 3). Pure: no I/O, no clock, no config reads.
 *
 * Tracker text is untrusted, and in a single-user setup the operator's
 * tracker identity is also the one the workers and the manager post as. So
 * an operator-id match alone proves nothing: {@link isMachineAuthoredComment}
 * runs first and is the ONE place that decides a comment is a machine's.
 * It excludes a comment that opens with a Lisa or Claude machine tag
 * (`[claude-sync] …`, `[lisa-…] …`), holds a `[lisa-` marker or a
 * `<!-- lisa:` marker, says "Written by Claude", or carries the Claude Code
 * attribution footer; and any comment whose id the manager recorded as one it
 * posted itself (`ledger marked --comment-id`), whatever it says. Markdown
 * blockquote lines are ignored before the markers are tested, so a human's
 * "Quote reply" of the question (or of a machine comment) is still a human's
 * answer, and an ordinary reply such as `[x] option 1` is not a machine tag
 * (#4561). Only then is the author matched, on stable ids only: a GitHub
 * login or numeric id, a Jira accountId, a Linear user id, never a display
 * name or email, which anyone can set. The text is carried as data.
 *
 * The question the answer must follow is the comment whose id the manager
 * recorded last; with no recorded id, the latest comment that STARTS with
 * the question marker and is by an allowed answerer. A marker merely quoted,
 * or posted by anyone else, never moves that anchor, so nobody can hide an
 * answer by posting the marker after it.
 * @module session-manager/human-answer
 */
import { QUESTION_MARKER } from "./human-needed.mjs";

/** Body markers that make a comment a machine's, never a human's answer. */
const MACHINE_MARKERS = [
  /^\s*\[(lisa|claude)-[a-z0-9-]*\]/i,
  /\[lisa-/i,
  /<!--\s*lisa:/i,
  /Written by Claude/i,
  /Generated with Claude Code/i,
  /🤖 Generated with/,
];

/** A Markdown blockquote line: quoted text, never the commenter's own. */
const QUOTE_LINE = /^\s*>/;

/** The comment fields that carry its tracker id. */
const COMMENT_ID_KEYS = ["id", "node_id"];

/** The author fields that are stable ids, never settable display text. */
const STABLE_ID_KEYS = ["login", "id", "accountId"];

/**
 * The string or number values of `keys` on `value`, as strings.
 * @param {unknown} value - Object to read
 * @param {readonly string[]} keys - Keys to read
 * @returns {string[]} Values
 */
function idsOf(value, keys) {
  if (value === null || typeof value !== "object") return [];
  return keys
    .map(key => value[key])
    .filter(id => typeof id === "string" || typeof id === "number")
    .map(String);
}

/**
 * The comment body, whatever the tracker calls it.
 * @param {Record<string, unknown>} comment - One comment
 * @returns {string} Body text
 */
function bodyOf(comment) {
  const body = comment?.body ?? comment?.text ?? "";
  return typeof body === "string" ? body : "";
}

/**
 * The comment body without its Markdown blockquote lines.
 * @param {string} text - Body text
 * @returns {string} The commenter's own text
 */
function unquoted(text) {
  return text
    .split("\n")
    .filter(line => !QUOTE_LINE.test(line))
    .join("\n");
}

/**
 * Whether a comment was written by a machine (an agent, a Lisa flow, or the
 * manager itself) and so can never be a human's answer.
 * @param {Record<string, unknown>} comment - One tracker comment
 * @param {{managerCommentIds?: readonly (string|number)[]}} [options] - Ids
 *   of comments the manager posted (from the ledger)
 * @returns {boolean} True for a machine's comment
 */
export function isMachineAuthoredComment(comment, options = {}) {
  const mine = new Set((options.managerCommentIds ?? []).map(String));
  if (idsOf(comment, COMMENT_ID_KEYS).some(id => mine.has(id))) return true;
  const text = unquoted(bodyOf(comment));
  return MACHINE_MARKERS.some(pattern => pattern.test(text));
}

/**
 * Index of the question comment an answer must follow: the comment whose id
 * the manager recorded last, when it recorded any; otherwise the latest
 * comment that starts with the question marker and is by an allowed author.
 * @param {Record<string, unknown>[]} rows - Comments, chronological
 * @param {readonly (string|number)[]} managerCommentIds - Recorded ids
 * @param {(row: Record<string, unknown>) => string|undefined} authorOf -
 *   The row's allowed stable author id, if any
 * @returns {number} Index, or -1 when there is no question comment
 */
function questionIndex(rows, managerCommentIds, authorOf) {
  if (managerCommentIds.length > 0) {
    const latest = String(managerCommentIds.at(-1));
    return rows.findLastIndex(row =>
      idsOf(row, COMMENT_ID_KEYS).includes(latest)
    );
  }
  return rows.findLastIndex(
    row =>
      bodyOf(row).trimStart().startsWith(QUESTION_MARKER) &&
      authorOf(row) !== undefined
  );
}

/**
 * Pick the human's answer from an item's comments: the first comment after
 * the manager's latest question comment ({@link questionIndex}) that is not
 * a machine's ({@link isMachineAuthoredComment}), has text of its own
 * outside quoted lines (a comment made only of `>` lines quotes someone
 * else and answers nothing), and whose author's stable id is allowed. Comments are taken in the order given (chronological).
 * @param {{comments: unknown, allowed: readonly string[],
 *   managerCommentIds?: readonly (string|number)[]}} input - The item's
 *   comments, the answerer ids, and the ids the manager posted
 * @returns {{answer: {text: string, author: string, at: string|null} | null,
 *   reason: string}} The answer, or null with why there is none
 */
export function pickItemAnswer({ comments, allowed, managerCommentIds = [] }) {
  if (!Array.isArray(comments)) {
    throw new Error('stdin must be JSON {"comments":[...]}');
  }
  const rows = comments.filter(row => row && typeof row === "object");
  const allow = new Set(allowed.map(String));
  const authorOf = row =>
    idsOf(row.author ?? row.user, STABLE_ID_KEYS).find(id => allow.has(id));
  const asked = questionIndex(rows, managerCommentIds, authorOf);
  if (asked === -1) return { answer: null, reason: "no-question-comment" };
  const reply = rows
    .slice(asked + 1)
    .filter(row => !isMachineAuthoredComment(row, { managerCommentIds }))
    .find(
      row => authorOf(row) !== undefined && unquoted(bodyOf(row)).trim() !== ""
    );
  if (!reply) return { answer: null, reason: "no-answer-yet" };
  const at = reply.createdAt ?? reply.created ?? reply.created_at ?? null;
  return {
    answer: {
      text: bodyOf(reply).trim(),
      author: authorOf(reply),
      at: typeof at === "string" ? at : null,
    },
    reason: "answered",
  };
}
