/**
 * Looking up what a person answered.
 *
 * A later step may rest a decision on an operator's answer, and it cites that
 * answer by the id of the question that was asked. This is the one lookup:
 * hand it a validated report and the id, and it returns the fact on record,
 * or nothing when the question is still open or was never asked.
 *
 * An answer stays on record, under the same id, for as long as the person
 * leaves it on its answer line in the rendered report. The id is derived, not
 * chosen (`./question-ids.ts`), so it is the same after any number of audits.
 * @module controls/audit-answers
 */
import type { AuditAnswer, AuditReport } from "./audit-report-types.js";

/**
 * Find the answer on record for a question.
 * @param report - A validated report, or anything that holds its `answers`
 * @param id - The question's id: `<criterion>@<scope>`, or a setup id
 * @returns The answer, with the question as it was asked, or `null` when no
 *   answer to that question is on record
 */
export function recordedAnswer(
  report: Pick<AuditReport, "answers">,
  id: string
): AuditAnswer | null {
  return report.answers.find(answer => answer.id === id) ?? null;
}
