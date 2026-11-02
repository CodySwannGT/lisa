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
 * name or email, which anyone can set. An all-digit allowed entry is a
 * numeric id and matches only the `id` or `accountId` field, never a login,
 * which its owner chooses and may make all digits (#4571). The text is
 * carried as data.
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
 * The author fields an all-digit allowed entry may match. A GitHub login can
 * be all digits and is chosen by its owner, so a numeric operator id must
 * never be matched against a login: user `583231` would otherwise pass as the
 * operator whose numeric id is 583231 (CodySwannGT/lisa#4571).
 */
const NUMERIC_ID_KEYS = ["id", "accountId"];

/** An allowed entry that is a numeric account id, never a login. */
const ALL_DIGITS = /^\d+$/;

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
 * else and answers nothing), whose author's stable id is allowed, and that
 * `refuses` does not refuse. Comments are taken in the order given
 * (chronological).
 *
 * A refused reply (one that looks like it holds a credential) is skipped and
 * reported in `refused`, never returned: returning it made every later cycle
 * pick the same reply and fail on it again, so a corrected reply posted after
 * it was never read (CodySwannGT/lisa#4571).
 * @param {{comments: unknown, allowed: readonly string[],
 *   managerCommentIds?: readonly (string|number)[],
 *   refuses?: (text: string) => string | null | undefined}} input - The
 *   item's comments, the answerer ids, the ids the manager posted, and why a
 *   reply's text may not be queued (null when it may)
 * @returns {{answer: {text: string, author: string, at: string|null} | null,
 *   reason: string, refused?: {id: string|null, author: string, why: string}[]}}
 *   The answer, or null with why there is none, and (only when any were)
 *   the replies refused
 */
export function pickItemAnswer({
  comments,
  allowed,
  managerCommentIds = [],
  refuses = () => null,
}) {
  if (!Array.isArray(comments)) {
    throw new Error('stdin must be JSON {"comments":[...]}');
  }
  const rows = comments.filter(row => row && typeof row === "object");
  const allow = allowed.map(String);
  const numeric = new Set(allow.filter(id => ALL_DIGITS.test(id)));
  const named = new Set(allow.filter(id => !ALL_DIGITS.test(id)));
  const authorOf = row => {
    const author = row.author ?? row.user;
    return (
      idsOf(author, NUMERIC_ID_KEYS).find(id => numeric.has(id)) ??
      idsOf(author, STABLE_ID_KEYS).find(id => named.has(id))
    );
  };
  const asked = questionIndex(rows, managerCommentIds, authorOf);
  const refused = [];
  if (asked === -1) return { answer: null, reason: "no-question-comment" };
  const withRefused = result =>
    refused.length > 0 ? { ...result, refused } : result;
  const replies = rows
    .slice(asked + 1)
    .filter(row => !isMachineAuthoredComment(row, { managerCommentIds }))
    .filter(
      row => authorOf(row) !== undefined && unquoted(bodyOf(row)).trim() !== ""
    );
  for (const reply of replies) {
    const text = bodyOf(reply).trim();
    const why = refuses(text);
    if (why) {
      refused.push({
        id: idsOf(reply, COMMENT_ID_KEYS)[0] ?? null,
        author: authorOf(reply),
        why,
      });
      continue;
    }
    const at = reply.createdAt ?? reply.created ?? reply.created_at ?? null;
    return withRefused({
      answer: {
        text,
        author: authorOf(reply),
        at: typeof at === "string" ? at : null,
      },
      reason: "answered",
    });
  }
  return withRefused({
    answer: null,
    reason: refused.length > 0 ? "credential-refused" : "no-answer-yet",
  });
}
