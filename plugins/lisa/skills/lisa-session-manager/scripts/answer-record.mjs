/**
 * Record an operator's answer on the item when no worker will receive it
 * (CodySwannGT/lisa#4624).
 *
 * An answer to a question whose worker reported `DONE` or `FAILED` (including
 * one the operator stopped with `stop REF`), or to an `exhausted` item, is
 * delivered to no worker: the next attempt can only read it on the item. An
 * answer given with `answer` (source `cli`) or on Telegram (source `channel`)
 * lives only in the ledger, and clearing the question deletes it there, so
 * the manager must post it on the item, and read it back, before it clears.
 * An answer that came from the item is already there, and a live worker
 * receives its answer directly; both are left as they were.
 *
 * Pure: no I/O and no clock (the time is the answer's own `at`). The answer
 * is data: it is quoted verbatim, never interpreted.
 * @module session-manager/answer-record
 */
import {
  MANAGER_COMMENT_PREFIX,
  findCredentialShape,
} from "./human-needed.mjs";

/** Worker statuses after which no worker receives an answer. */
const FINISHED = new Set(["DONE", "FAILED"]);

/** How each answer source is named in the comment. */
const SOURCE_NAMES = { cli: "answer", channel: "Telegram" };

/**
 * The answer, kept verbatim. A one-line answer follows the colon; a longer one
 * is quoted line by line beneath it, so its own lines can never pass for a
 * new comment's first line.
 * @param {string} head - First line, ending with the colon
 * @param {string} text - Answer text
 * @returns {string} Comment body
 */
function withAnswer(head, text) {
  if (!/[\r\n]/.test(text)) return `${head} ${text}`;
  const quoted = text
    .split(/\r?\n|\r/)
    .map(line => (line === "" ? ">" : `> ${line}`));
  return [head, "", ...quoted].join("\n");
}

/**
 * Why no comment is needed, or null when one is. No worker receives the
 * answer when the worker finished, the item is `exhausted`, or no worker has
 * been started yet (a `decision`, say): then only the item can carry it. A
 * `repo-route` answer is always carried by the `repo:<name>` stamp.
 * @param {string | undefined} status - The ledger item's status
 * @param {string | null | undefined} worker - The ledger item's worker
 * @param {{kind?: string, answer?: {source: string} | null} | null} pending
 *   - The pending question
 * @returns {string | null} Reason
 */
function skipReason(status, worker, pending) {
  if (!pending) return "no-pending-question";
  if (!pending.answer) return "no-answer-queued";
  if (pending.answer.source === "item") return "answered-on-item";
  if (pending.kind === "repo-route") return "routed-by-repo-stamp";
  if (pending.kind === "exhausted" || FINISHED.has(status ?? "")) return null;
  return worker ? "worker-not-finished" : null;
}

/**
 * `{requeue: true}` when clearing must also move the item to the `ready`
 * role, else `{}`. A worker's `FAILED` moved the item to the `blocked` role,
 * and the blocked pass keeps an item with no dependency edges, so without
 * this move the "next attempt" that reads the recorded answer is never
 * dispatched (CodySwannGT/lisa#4643). It holds whether the answer still has
 * to be posted or is already on the item. A `DONE` worker's item and a
 * repo-routing answer (carried by its `repo:<name>` stamp) are not moved.
 * @param {string | undefined} status - The ledger item's status
 * @param {{kind?: string, answer?: object | null} | null} pending - The
 *   pending question
 * @returns {{requeue?: true}} The flag, only when it applies
 */
function requeueOf(status, pending) {
  const due =
    status === "FAILED" &&
    Boolean(pending?.answer) &&
    pending?.kind !== "repo-route";
  return due ? { requeue: true } : {};
}

/**
 * Plan recording a queued answer on the item. Throws when the answer looks
 * like it holds a credential: it would be posted on the item.
 * @param {{ref: string, status?: string, worker?: string | null,
 *   pending: object | null}} input - The item's ref, its ledger status and
 *   worker, and its pending question
 * @returns {{ref: string, record: false, reason: string, requeue?: true} |
 *   {ref: string, record: true, source: string, answerAt: string | null,
 *   comment: string, requeue?: true}} Plan; answerAt is the queued answer's
 *   `at`, which `ledger clear-question --expect-answer-at` checks before
 *   clearing; `requeue: true` means also move the item to the `ready` role
 */
export function planAnswerRecord({ ref, status, worker, pending }) {
  const reason = skipReason(status, worker, pending);
  const requeue = requeueOf(status, pending);
  if (reason) return { ref, record: false, reason, ...requeue };
  const { source, text, at } = pending.answer;
  const shape = findCredentialShape(text);
  if (shape) {
    throw new Error(
      `the queued answer looks like it holds a credential (${shape}); it would be posted on the item. Nothing was planned: have the operator answer again without it and keep secrets in the secrets provider.`
    );
  }
  const by = SOURCE_NAMES[source] ?? source;
  return {
    ref,
    record: true,
    source,
    answerAt: at ?? null,
    comment: withAnswer(
      `${MANAGER_COMMENT_PREFIX} The operator answered the question above (by ${by}, ${at ?? "time unknown"}):`,
      text
    ),
    ...requeue,
  };
}
