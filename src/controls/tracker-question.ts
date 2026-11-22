/**
 * The audit's question about which tracker the team uses.
 *
 * Which tracker a team uses is in no file until someone configures it, so the
 * audit asks. A later step that cannot file a ticket points the operator at
 * that question. The two meet on one fixed id: the audit writes the question
 * under {@link TRACKER_QUESTION_ID}, and a reader looks for that id. Import the
 * constant; do not spell the id out a second time.
 *
 * A leaf module on purpose: it imports nothing from the report code or from
 * any command, so the audit and every later step can use it.
 * @module controls/tracker-question
 */
import { isJsonObject } from "../sync/json-path.js";

/** The id of the audit question that asks which tracker the team uses. */
export const TRACKER_QUESTION_ID = "tracker";

/**
 * Tell whether a question still waits for its answer.
 * @param answer - The question's `answer` value, when it has one
 * @returns Whether nobody has answered it
 */
function isUnanswered(answer: unknown): boolean {
  return (
    answer === undefined ||
    answer === null ||
    (typeof answer === "string" && answer.trim() === "")
  );
}

/**
 * Find the open tracker question of an audit report.
 *
 * It reads the report document as parsed JSON and expects nothing of it: a
 * report that records no questions, or one whose `questions` value is not a
 * list, has no open tracker question.
 * @param document - The parsed content of the audit report, of any shape
 * @returns The question's id while it is unanswered, otherwise `null`
 */
export function openTrackerQuestionId(document: unknown): string | null {
  if (!isJsonObject(document) || !Array.isArray(document.questions)) {
    return null;
  }
  return document.questions.some(
    question =>
      isJsonObject(question) &&
      question.id === TRACKER_QUESTION_ID &&
      isUnanswered(question.answer)
  )
    ? TRACKER_QUESTION_ID
    : null;
}
