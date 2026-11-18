/**
 * Rule: the answers on record are exactly the answers people typed in the
 * rendered report.
 *
 * `report.md` is where a person answers, and the next passing check renders
 * it again from the record. So before a record is accepted, everything typed
 * on an answer line has to be in it already. Otherwise the render would
 * overwrite a person's answer with an empty line, and the answer would be
 * gone. This rule is what makes that impossible: a record that does not carry
 * a typed answer is refused, the earlier `report.md` stays where it is, and
 * `lisa controls report-check --absorb` is the way to record it.
 *
 * It holds the other way too. An answer in the record that nobody typed is
 * not a person's answer, and deciding an answer on a person's behalf is not
 * something an audit may do. Every answer on record has to pass the one test
 * of `personAnswer` (`../audit-answers.ts`): the same question holds the same
 * words on its answer line in a file a person types in. That is so whether
 * or not a rendered report exists. A record that holds answers with no
 * `report.md` beside it is refused, because nothing then shows that a person
 * typed them: the first audit of a repository has no answers to carry, and a
 * report that was deleted cannot vouch for the ones it held.
 *
 * A file that cannot be read in the written form is refused here as well,
 * with its line named, for the same reason: a line that was skipped may be
 * the one the answer is on.
 *
 * ## What this rule cannot see
 *
 * An answer that was typed, never absorbed, and whose file was then deleted
 * has left nothing behind to check. The audit is told never to remove or
 * edit `report.md`; no code can notice that it did.
 * @module controls/audit-report-rules/recorded-answers
 */
import { personAnswer } from "../audit-answers.js";
import {
  AUDIT_REPORT_MARKDOWN_PATH,
  type AuditAnswer,
  type AuditReportRule,
  type AuditReportViolation,
  type InlineAnswers,
  type InlineEntry,
} from "../audit-report-types.js";

/** The name this rule's violations carry. */
export const RECORDED_ANSWERS_RULE = "recorded-answers";

/** The command that brings the record in line with what was typed. */
const ABSORB = "`lisa controls report-check --absorb`";

/**
 * Wrap one message as a violation of this rule.
 * @param message - What is wrong and what to do
 * @returns The violation
 */
function violation(message: string): AuditReportViolation {
  return { rule: RECORDED_ANSWERS_RULE, message };
}

/**
 * Say where an entry's answer line is.
 * @param entry - The entry
 * @returns The file and line
 */
function where(entry: InlineEntry): string {
  return `${entry.file} line ${entry.line}`;
}

/**
 * Say why an answer on record is not a person's, when no answer line holds
 * anything for its question.
 * @param answer - The answer on record
 * @param typed - What was read from the files people type in
 * @returns What is wrong and what to do
 */
function nobodyTyped(answer: AuditAnswer, typed: InlineAnswers): string {
  const emptied = typed.entries.find(
    entry => entry.id === answer.id && entry.answered
  );
  if (emptied !== undefined) {
    return `The answer line at ${where(emptied)} is empty, but the record still holds an answer to "${answer.question}". Run ${ABSORB} to withdraw the answer, or type it back on that line.`;
  }
  return typed.rendered
    ? `The record holds an answer to "${answer.question}" that is not written in ${AUDIT_REPORT_MARKDOWN_PATH}. Only an answer a person typed in the report is recorded: remove it from "answers".`
    : `The record holds an answer to "${answer.question}", but ${AUDIT_REPORT_MARKDOWN_PATH} is not there, so nothing shows that a person typed it. Put the file back as it was, or remove the answer from "answers" so that the audit asks the question again.`;
}

/**
 * The record carries every typed answer, and nothing that was not typed.
 * @param report - The report
 * @param context - The facts it is checked against
 * @returns The violations found: what is wrong with the files themselves,
 *   then typed answers the record lacks, then recorded answers nobody typed
 */
export const answersAreWhatWasTyped: AuditReportRule = (report, context) => {
  const { inlineAnswers } = context;
  const { entries, problems } = inlineAnswers;
  if (problems.length > 0) return problems.map(problem => violation(problem));
  const typed = entries.filter(entry => entry.answer !== null);
  return [
    ...typed.flatMap(entry => {
      const recorded = report.answers.find(answer => answer.id === entry.id);
      if (recorded?.answer === entry.answer) return [];
      return [
        violation(
          recorded === undefined
            ? `${where(entry)} holds an answer to "${entry.question}" that the record does not carry. Run ${ABSORB} to record it, then run this check again.`
            : `${where(entry)} gives "${entry.question}" a different answer from the one on record. Run ${ABSORB} to record what is written there, then run this check again.`
        ),
      ];
    }),
    // An answer whose question has a typed line was dealt with above: the
    // two agree, or the difference was reported from the line.
    ...report.answers
      .filter(
        answer =>
          personAnswer(report, inlineAnswers, answer.id) === null &&
          !typed.some(entry => entry.id === answer.id)
      )
      .map(answer => violation(nobodyTyped(answer, inlineAnswers))),
  ];
};
