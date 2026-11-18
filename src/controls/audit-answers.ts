/**
 * Looking up what a person answered.
 *
 * A later step may rest a decision on an operator's answer, and it cites that
 * answer by the id of the question that was asked. There are two lookups.
 *
 * {@link recordedAnswer} reads the record alone: hand it a validated report
 * and the id, and it returns the fact on record, or nothing when the question
 * is still open or was never asked.
 *
 * {@link personAnswer} is the test of whether a person gave that answer. The
 * record is a file an agent writes, so an entry of `answers` proves nothing
 * by being there. An answer counts as a person's only when both hold:
 *
 * - it is on record, under the question's id, and is more than a placeholder;
 * - the same question holds the same words on its answer line in a file a
 *   person types in: `.lisa/audit/report.md`, or `wiki/gaps.md`.
 *
 * With no such file, or with one that cannot be read in the written form,
 * nothing shows that a person typed the answer, and it does not count. The
 * report check and the attest step both apply this one test, each at the
 * moment it reads the files, so a report that passed earlier cannot carry an
 * answer nobody typed into evidence.
 *
 * An answer stays on record, under the same id, for as long as the person
 * leaves it on its answer line in the rendered report. The id is derived, not
 * chosen (`./question-ids.ts`), so it is the same after any number of audits.
 * @module controls/audit-answers
 */
import { isInlineAnswer } from "./audit-questions-format.js";
import type {
  AuditAnswer,
  AuditReport,
  InlineAnswers,
} from "./audit-report-types.js";

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

/**
 * Find the answer a person gave to a question.
 * @param report - A validated report, or anything that holds its `answers`
 * @param typed - What was read from the files people type their answers in
 * @param id - The question's id: `<criterion>@<scope>`, or a setup id
 * @returns The answer on record when a person typed those words on the
 *   question's answer line, and `null` otherwise
 */
export function personAnswer(
  report: Pick<AuditReport, "answers">,
  typed: InlineAnswers,
  id: string
): AuditAnswer | null {
  const recorded = recordedAnswer(report, id);
  if (recorded === null || !isInlineAnswer(recorded.answer)) return null;
  const written =
    typed.problems.length === 0 &&
    typed.entries.some(
      entry => entry.id === id && entry.answer === recorded.answer
    );
  return written ? recorded : null;
}
