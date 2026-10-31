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
 * Writes go through ledger.mjs's atomic read-transform-write.
 * @module session-manager/ledger-questions
 */
import { requireItem, updateLedger, withItem } from "./ledger.mjs";

/** Ways an item can be marked human-needed. */
const MARKER_TYPES = new Set(["label", "role"]);

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
 * @param {{ref: string, markerType: string, marker: string}} mark - The mark
 * @param {import("./ledger.mjs").LedgerSeams} [seams] - Injected seams
 * @returns {Promise<import("./ledger.mjs").LedgerItem>} The updated item
 */
export function recordMarked(projectRoot, { ref, markerType, marker }, seams) {
  if (!MARKER_TYPES.has(markerType)) {
    return Promise.reject(new Error("--marker-type must be label or role."));
  }
  if (typeof marker !== "string" || marker.trim() === "") {
    return Promise.reject(new Error("--marker must name the label or role."));
  }
  return updateLedger(projectRoot, seams, (ledger, at) => {
    const previous = requireItem(ledger, ref);
    const pending = requirePending(previous, ref);
    return withItem(ledger, ref, {
      ...previous,
      pendingQuestion: { ...pending, markerType, marker, markedAt: at },
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
