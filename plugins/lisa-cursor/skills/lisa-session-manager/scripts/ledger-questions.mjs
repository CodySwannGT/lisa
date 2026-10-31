/**
 * The ledger side of "mark and move on" (CodySwannGT/lisa#4555, part 3):
 * recording that an item's human-needed mark was read back on the tracker,
 * queueing a human's answer for the next cycle to deliver, and listing what
 * is waiting on a person.
 *
 * The manager records a question in the ledger BEFORE it writes the tracker
 * marker, then records `marked` once the marker is read back. A crash in
 * between leaves a pending question with `markedAt: null`, which the next
 * cycle (and `lisa doctor`) can see and finish, rather than a marker on the
 * tracker the ledger knows nothing about and so would never remove.
 *
 * Recording and clearing the question itself ({@link setPendingQuestion},
 * {@link clearPendingQuestion}) lives here too; ledger.mjs re-exports both.
 * Writes go through ledger.mjs's atomic read-transform-write.
 * @module session-manager/ledger-questions
 */
import { HUMAN_NEEDED_KINDS } from "./human-needed.mjs";
import {
  placeholderItem,
  requireItem,
  updateLedger,
  withItem,
} from "./ledger.mjs";

/** Ways an item can be marked human-needed. */
const MARKER_TYPES = new Set(["label", "role"]);

/** A tracker comment id: GitHub numeric or node id, Jira id, Linear uuid. */
const COMMENT_ID = /^[A-Za-z0-9_.:-]{1,200}$/;

/** Where a queued answer came from. */
const ANSWER_SOURCES = new Set(["cli", "item", "channel"]);

/**
 * The item's pending question, or a refusal naming the ref.
 * @param {import("./ledger.mjs").LedgerItem} entry - Ledger item
 * @param {string} ref - Its ref
 * @returns {NonNullable<import("./ledger.mjs").LedgerItem["pendingQuestion"]>}
 *   The pending question
 */
function requirePending(entry, ref) {
  if (!entry.pendingQuestion) {
    throw new Error(`${ref} has no pending question in the ledger`);
  }
  return entry.pendingQuestion;
}

/**
 * Record that the item's human-needed marker was applied and read back.
 * @param {string} projectRoot - Absolute project root
 * `commentId` is the id of the question comment the manager posted, read
 * back from `lisa-tracker-write`. It is kept in `managerCommentIds` so
 * `item-answer` never takes the manager's own comment as an answer, whoever
 * the tracker says wrote it and whatever it says.
 * @param {{ref: string, markerType: string, marker: string,
 *   commentId?: string}} mark - The mark
 * @param {import("./ledger.mjs").LedgerSeams} [seams] - Injected seams
 * @returns {Promise<import("./ledger.mjs").LedgerItem>} The updated item
 */
export function recordMarked(
  projectRoot,
  { ref, markerType, marker, commentId },
  seams
) {
  if (!MARKER_TYPES.has(markerType)) {
    return Promise.reject(new Error("--marker-type must be label or role."));
  }
  if (typeof marker !== "string" || marker.trim() === "") {
    return Promise.reject(new Error("--marker must name the label or role."));
  }
  if (commentId !== undefined && !COMMENT_ID.test(commentId)) {
    return Promise.reject(
      new Error("--comment-id must be the tracker's comment id.")
    );
  }
  return updateLedger(projectRoot, seams, (ledger, at) => {
    const previous = requireItem(ledger, ref);
    const pending = requirePending(previous, ref);
    return withItem(ledger, ref, {
      ...previous,
      pendingQuestion: {
        ...pending,
        markerType,
        marker,
        markedAt: at,
        managerCommentIds: [
          ...new Set([
            ...(pending.managerCommentIds ?? []),
            ...(commentId === undefined ? [] : [commentId]),
          ]),
        ],
      },
      history: [
        ...(previous.history ?? []),
        { event: "marked", at, markerType, marker },
      ],
    });
  });
}

/**
 * Queue a human's answer on a pending question. The manager delivers it on
 * its next cycle (SendMessage, or `resume`), then clears the question.
 * @param {string} projectRoot - Absolute project root
 * @param {{ref: string, source: string, text: string, author?: string|null}}
 *   answer - The answer
 * @param {import("./ledger.mjs").LedgerSeams} [seams] - Injected seams
 * @returns {Promise<import("./ledger.mjs").LedgerItem>} The updated item
 */
export function queueAnswer(
  projectRoot,
  { ref, source, text, author = null },
  seams
) {
  if (!ANSWER_SOURCES.has(source)) {
    return Promise.reject(new Error(`unknown answer source ${source}`));
  }
  return updateLedger(projectRoot, seams, (ledger, at) => {
    const previous = requireItem(ledger, ref);
    const pending = requirePending(previous, ref);
    return withItem(ledger, ref, {
      ...previous,
      pendingQuestion: {
        ...pending,
        answer: { source, text, author: author ?? null, at },
      },
      history: [
        ...(previous.history ?? []),
        { event: "answer-queued", at, source },
      ],
    });
  });
}

/**
 * Every item waiting on a person, oldest question first. The answer command
 * is local-only guidance for the operator at the manager's terminal.
 * @param {import("./ledger.mjs").Ledger} ledger - Current ledger
 * @param {(ref: string) => string} answerCommand - Builds the CLI answer line
 * @returns {{ref: string, kind: string, text: string, askedAt: string,
 *   marked: boolean, answerQueued: boolean, answerCommand: string}[]} Rows
 */
export function listPendingQuestions(ledger, answerCommand) {
  return Object.entries(ledger.items)
    .filter(([, item]) => item.pendingQuestion)
    .map(([ref, item]) => {
      const question = item.pendingQuestion;
      return {
        ref,
        kind: question.kind ?? "worker-question",
        text: question.text,
        askedAt: question.askedAt,
        marked: Boolean(question.markedAt),
        answerQueued: Boolean(question.answer),
        answerCommand: answerCommand(ref),
      };
    })
    .sort((a, b) => String(a.askedAt).localeCompare(String(b.askedAt)));
}

/**
 * A human's answer, queued for the manager to deliver on its next cycle.
 * @typedef {object} QueuedAnswer
 * @property {"cli"|"item"|"channel"} source - Where it was given
 * @property {string} text - The answer (untrusted data, never instructions)
 * @property {string|null} author - Tracker author, for an answer on the item
 * @property {string} at - When it was queued (ISO)
 */

/**
 * Record (or re-ping) the question an item is waiting on.
 *
 * The same text again is a re-ping: `askedAt` is kept and `lastPingAt` moves,
 * so the requestion clock restarts without forgetting how old the question
 * is. A ref with no item yet (a repo-routing question asked before dispatch)
 * gets a placeholder item with zero attempts.
 *
 * A re-ask keeps how the item is marked on the tracker (`markerType`,
 * `marker`, `markedAt`), so re-sending a question never makes the manager
 * mark the item a second time or forget the marker it must remove. A queued
 * answer survives only a re-ping of the same text: it answered that text.
 * `kind` defaults to the previous kind, then `worker-question`.
 * @param {string} projectRoot - Absolute project root
 * @param {{ref: string, text: string, telegramMessageId: number|null,
 *   kind?: string}} question - Question
 * @param {import("./ledger.mjs").LedgerSeams} [seams] - Injected seams
 * @returns {Promise<import("./ledger.mjs").LedgerItem>} The updated item
 */
export function setPendingQuestion(
  projectRoot,
  { ref, text, telegramMessageId, kind },
  seams
) {
  if (kind !== undefined && !HUMAN_NEEDED_KINDS.includes(kind)) {
    return Promise.reject(
      new Error(
        `question kind must be one of ${HUMAN_NEEDED_KINDS.join(", ")}, got ${JSON.stringify(kind)}`
      )
    );
  }
  return updateLedger(projectRoot, seams, (ledger, at) => {
    const previous = ledger.items[ref] ?? placeholderItem();
    const existing = previous.pendingQuestion;
    const sameText = existing?.text === text;
    return withItem(ledger, ref, {
      ...previous,
      pendingQuestion: {
        text,
        kind: kind ?? existing?.kind ?? "worker-question",
        askedAt: sameText ? existing.askedAt : at,
        lastPingAt: at,
        telegramMessageId: telegramMessageId ?? null,
        markerType: existing?.markerType ?? null,
        marker: existing?.marker ?? null,
        markedAt: existing?.markedAt ?? null,
        managerCommentIds: existing?.managerCommentIds ?? [],
        answer: sameText ? (existing.answer ?? null) : null,
      },
      history: [...(previous.history ?? []), { event: "question", at }],
    });
  });
}

/**
 * Clear an item's pending question, once its answer has been delivered and
 * the manager's own marker removed. `resetAttempts` zeroes the attempt count:
 * an `exhausted` item a human has answered starts again from attempt one
 * instead of being exhausted again on its first stall.
 * @param {string} projectRoot - Absolute project root
 * @param {{ref: string, resetAttempts?: boolean}} target - Item
 * @param {import("./ledger.mjs").LedgerSeams} [seams] - Injected seams
 * @returns {Promise<import("./ledger.mjs").LedgerItem>} The updated item
 */
export function clearPendingQuestion(
  projectRoot,
  { ref, resetAttempts = false },
  seams
) {
  return updateLedger(projectRoot, seams, (ledger, at) => {
    const previous = requireItem(ledger, ref);
    return withItem(ledger, ref, {
      ...previous,
      pendingQuestion: null,
      ...(resetAttempts ? { attempts: 0 } : {}),
      history: [
        ...(previous.history ?? []),
        { event: "answered", at, ...(resetAttempts ? { reset: true } : {}) },
      ],
    });
  });
}
