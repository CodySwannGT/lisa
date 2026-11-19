/**
 * Rule: while the repository names no tracker Lisa can file in, the report
 * asks which one the team uses.
 *
 * Which tracker a team uses is in no file until someone configures it, and a
 * later step has nowhere to file a ticket until it is known. That step points
 * the operator at this question by its fixed id, so the question has to be
 * there. Whether it is there is decided here, by code, not left to the agent
 * that wrote the report.
 *
 * The question is owed only while the fact is open: not once a tracker is
 * configured, and not once a person has answered.
 * @module controls/audit-report-rules/tracker-question
 */
import type { AuditReportRule } from "../audit-report-types.js";
import { TRACKER_QUESTION_ID } from "../tracker-question.js";

/** The name this rule's violations carry. */
export const TRACKER_QUESTION_RULE = "tracker-question";

/**
 * The tracker question is asked while no tracker is configured and nobody has
 * answered it.
 * @param report - The report
 * @param context - The facts it is checked against
 * @returns One violation when the question is owed and absent
 */
export const trackerQuestionAsked: AuditReportRule = (report, context) =>
  context.trackerConfigured ||
  [...report.questions, ...report.answers].some(
    entry => entry.id === TRACKER_QUESTION_ID
  )
    ? []
    : [
        {
          rule: TRACKER_QUESTION_RULE,
          message: `No tracker is configured for this repository, and the report does not ask which one the team uses. Add a question with the id "${TRACKER_QUESTION_ID}" to "questions": one plain sentence, with the trackers the audit found evidence for, or where it looked and found none.`,
        },
      ];
