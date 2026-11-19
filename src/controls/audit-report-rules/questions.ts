/**
 * Rule: the questions of a report and its findings agree, under ids that are
 * derived and never chosen.
 *
 * A finding in the state `question` and the question that asks for its answer
 * are two halves of one thing. Each must have the other:
 *
 * - every finding in the state `question` has a question whose id is formed
 *   from the finding's requirement and scope (`../question-ids.ts`);
 * - every question formed that way belongs to a finding of this report, and
 *   that finding is in the state `question`.
 *
 * A question that belongs to no finding uses one of the fixed setup ids. Any
 * other id is refused: an id an agent made up would differ on the next run,
 * the question would be asked twice, and a later step could not cite its
 * answer.
 *
 * A question that has an answer on record is never asked again. Its finding
 * may not stay in the state `question` either: the answer is a fact now, and
 * the finding is decided from it.
 *
 * Every word a person reads here (the question, each candidate, where the
 * audit looked) is plain language, with no requirement id in it.
 * @module controls/audit-report-rules/questions
 */
import { recordedAnswer } from "../audit-answers.js";
import {
  type AuditAnswer,
  type AuditFinding,
  type AuditQuestion,
  type AuditReport,
  type AuditReportRule,
  type AuditReportViolation,
} from "../audit-report-types.js";
import { findingViolation } from "../audit-report-wording.js";
import { criterionIdsIn } from "../catalogue.js";
import {
  QUESTION_ID_SEPARATOR,
  SETUP_QUESTION_IDS,
  parseQuestionId,
  requirementQuestionId,
} from "../question-ids.js";

/** The name this rule's violations carry. */
export const QUESTIONS_RULE = "questions";

/** The finding state that needs a person's answer. */
const QUESTION_STATE = "question";

/** How an id is formed, said once for every message that needs it. */
const ID_FORMS = `A question about a requirement has the id "<requirement id>${QUESTION_ID_SEPARATOR}<scope>", formed from its finding. A question about how the repository is set up has one of these ids: ${SETUP_QUESTION_IDS.join(", ")}.`;

/**
 * Report each id a list holds more than once.
 * @param ids - The ids of a list, in order
 * @param describe - Says what is wrong for one repeated id
 * @returns One violation per repeated id
 */
function repeated(
  ids: readonly string[],
  describe: (id: string, times: number) => string
): readonly AuditReportViolation[] {
  return [...new Set(ids)]
    .map(id => ({ id, times: ids.filter(listed => listed === id).length }))
    .filter(({ times }) => times > 1)
    .map(({ id, times }) => ({
      rule: QUESTIONS_RULE,
      message: describe(id, times),
    }));
}

/**
 * Check that the words of a question are plain.
 * @param question - The question
 * @returns What is wrong with them
 */
function wordingViolations(
  question: AuditQuestion
): readonly AuditReportViolation[] {
  const read = [
    question.text,
    question.no_candidates_reason ?? "",
    ...question.candidates.flatMap(candidate => [
      candidate.answer,
      candidate.found_in,
    ]),
  ];
  return [
    ...(question.text.trim().endsWith("?")
      ? []
      : [
          `The question "${question.id}" must be one plain question, ending in a question mark.`,
        ]),
    ...(read.some(text => criterionIdsIn(text).length > 0)
      ? [
          `The question "${question.id}" names a requirement by its id. Say it in plain words: the id belongs in the question's "id" only.`,
        ]
      : []),
  ].map(message => ({ rule: QUESTIONS_RULE, message }));
}

/**
 * Check where one question stands against the findings and the answers.
 * @param question - The question
 * @param report - The report it is in
 * @returns What is wrong with it
 */
function placementViolations(
  question: AuditQuestion,
  report: AuditReport
): readonly AuditReportViolation[] {
  const parts = parseQuestionId(question.id);
  if (parts === null) {
    return [
      {
        rule: QUESTIONS_RULE,
        message: `"${question.id}" is not an id Lisa can place. ${ID_FORMS}`,
      },
    ];
  }
  if (recordedAnswer(report, question.id) !== null) {
    return [
      {
        rule: QUESTIONS_RULE,
        message: `The question "${question.id}" was already answered, so it is not asked again. Remove it from "questions" and use the answer on record.`,
      },
    ];
  }
  if (parts.kind === "setup") return [];
  const finding = report.findings.find(
    candidate =>
      candidate.criterion === parts.criterion && candidate.scope === parts.scope
  );
  if (finding === undefined) {
    return [
      {
        rule: QUESTIONS_RULE,
        message: `The question "${question.id}" does not match a finding of this report. ${ID_FORMS}`,
      },
    ];
  }
  return finding.state === QUESTION_STATE
    ? []
    : [
        findingViolation(
          QUESTIONS_RULE,
          finding,
          `A question is asked about this finding, but the finding is not filed as needing a person's answer. Set its state to "${QUESTION_STATE}", or remove the question with the id "${question.id}".`,
          "state"
        ),
      ];
}

/**
 * Check that a finding which needs a person's answer has its question.
 * @param finding - A finding in the state `question`
 * @param report - The report it is in
 * @returns What is wrong with it
 */
function unaskedViolations(
  finding: AuditFinding,
  report: AuditReport
): readonly AuditReportViolation[] {
  const id = requirementQuestionId(finding.criterion, finding.scope);
  const answer = recordedAnswer(report, id);
  if (answer !== null) {
    return [
      findingViolation(
        QUESTIONS_RULE,
        finding,
        `This finding is filed as needing a person's answer, but its question was answered: "${answer.answer}". Decide the finding again with that answer as a fact, and give it another state.`,
        "state"
      ),
    ];
  }
  return report.questions.some(question => question.id === id)
    ? []
    : [
        findingViolation(
          QUESTIONS_RULE,
          finding,
          `This finding needs a person's answer, so the report must ask for it. Add an entry to "questions" with the id "${id}": the question as one plain sentence, and the candidate answers the audit found evidence for.`,
          "state"
        ),
      ];
}

/**
 * Check the ids the answers on record are kept under.
 * @param answers - The answers on record
 * @returns What is wrong with them
 */
function answerIdViolations(
  answers: readonly AuditAnswer[]
): readonly AuditReportViolation[] {
  return [...new Set(answers.map(answer => answer.id))]
    .filter(id => parseQuestionId(id) === null)
    .map(id => ({
      rule: QUESTIONS_RULE,
      message: `An answer is recorded under "${id}", which is not the id of a question. ${ID_FORMS}`,
    }));
}

/**
 * Questions and findings agree, no question is asked twice or asked again
 * after it was answered, and every question is in plain words.
 * @param report - The report
 * @returns The violations found: about the questions, in listed order, then
 *   about the findings that lack one, then about the answers
 */
export const questionsMatchFindings: AuditReportRule = report => [
  ...repeated(
    report.questions.map(question => question.id),
    (id, times) => `The question "${id}" is asked ${times} times. Ask it once.`
  ),
  ...report.questions.flatMap(question => [
    ...placementViolations(question, report),
    ...wordingViolations(question),
  ]),
  ...report.findings
    .filter(finding => finding.state === QUESTION_STATE)
    .flatMap(finding => unaskedViolations(finding, report)),
  ...repeated(
    report.answers.map(answer => answer.id),
    (id, times) =>
      `The question "${id}" has ${times} answers on record. Keep the one that was typed in the report.`
  ),
  ...answerIdViolations(report.answers),
];
