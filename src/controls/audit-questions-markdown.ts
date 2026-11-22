/**
 * The audit's questions as an operator reads and answers them.
 *
 * Each question is written in the form of `./audit-questions-format.ts`, the
 * one `/lisa:agent-ready` uses in `wiki/gaps.md`: a heading that is the
 * question's id, the question as one plain sentence, the candidate answers
 * with where each was found (or where the audit looked and found none), and an
 * answer line to type on. An answered question is shown with its answer on
 * that same line, so a person can read it back and correct it.
 *
 * The block is rendered twice: into `.lisa/audit/report.md`, with the open
 * and the answered questions, and into `wiki/gaps.md` when the repository
 * keeps a wiki, with the open ones only. The order never follows the order an
 * agent happened to write: setup questions first, then the questions about
 * requirements in catalogue order, each requirement's folders in listed order.
 *
 * What is rendered here is read back by `./audit-inline-answers.ts`. Text that
 * comes from the record is put on one line and nothing else is done to it, so
 * the reader returns exactly what the record holds.
 *
 * Under each entry stands one comment line of marks
 * (`./audit-question-lines.ts`), so the reader can refuse a line of the entry
 * that a person typed on instead of the answer line.
 * @module controls/audit-questions-markdown
 */
import { entryMarksLine } from "./audit-question-lines.js";
import {
  ANSWER_PLACEHOLDER,
  ENTRY_LABEL,
  NO_CANDIDATES,
  QUESTIONS_END,
  QUESTIONS_START,
  STATUS_ABSORBED,
  STATUS_OPEN,
} from "./audit-questions-format.js";
import type {
  AuditAnswer,
  AuditQuestion,
  AuditReport,
} from "./audit-report-types.js";
import type { InScopeCriterion } from "./catalogue.js";
import { SETUP_QUESTION_IDS, parseQuestionId } from "./question-ids.js";

/** What a person does with an open question, said once in each heading. */
const HOW_TO_ANSWER =
  "type each answer on its Answer line, then run the audit again";

/** What the open questions are called, in a heading and when pointed at. */
export const OPEN_QUESTIONS_TITLE = "Open questions";

/** The heading of the open questions in the readable report. */
const OPEN_QUESTIONS_HEADING = `## ${OPEN_QUESTIONS_TITLE} (${HOW_TO_ANSWER})`;

/** The heading of the answered questions in the readable report. */
const ANSWERED_QUESTIONS_HEADING =
  "## Answered questions (to change an answer, edit its Answer line, then run the audit again)";

/** The heading of the open questions in a wiki's gaps file. */
const GAPS_QUESTIONS_HEADING = `## ${OPEN_QUESTIONS_TITLE} from the audit (${HOW_TO_ANSWER})`;

/** The heading in a wiki's gaps file when no question is open. */
const GAPS_NONE_OPEN_HEADING = `## ${OPEN_QUESTIONS_TITLE} from the audit (none open)`;

/**
 * Put free text on one line.
 * @param text - Text from the record
 * @returns The text with every run of white space as one space
 */
function oneLine(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

/**
 * Write one labelled line of an entry.
 * @param label - The line's label
 * @param value - What stands after it; nothing for a label with sub-bullets
 * @returns The line
 */
function field(label: string, value = ""): string {
  return value === "" ? `- **${label}**:` : `- **${label}**: ${value}`;
}

/**
 * Where an id sorts: setup questions in their listed order, then requirements
 * in catalogue order, then anything the catalogue no longer holds.
 * @param id - A question's id
 * @param criteria - The in-scope criteria, in catalogue order
 * @returns The rank; lower sorts first
 */
function rank(id: string, criteria: readonly InScopeCriterion[]): number {
  const parts = parseQuestionId(id);
  if (parts === null) return Number.MAX_SAFE_INTEGER;
  if (parts.kind === "setup") return SETUP_QUESTION_IDS.indexOf(parts.id);
  const position = criteria.findIndex(
    criterion => criterion.id === parts.criterion
  );
  return position === -1
    ? Number.MAX_SAFE_INTEGER - 1
    : SETUP_QUESTION_IDS.length + position;
}

/**
 * Put entries in the one order they are always rendered in.
 * @param entries - Questions or answers, in any order
 * @param criteria - The in-scope criteria, in catalogue order
 * @param scopes - The report's scopes, in listed order
 * @returns The entries, sorted without any locale involved
 */
function inOrder<Entry extends { readonly id: string }>(
  entries: readonly Entry[],
  criteria: readonly InScopeCriterion[],
  scopes: readonly string[]
): readonly Entry[] {
  const scopeRank = (id: string): number => {
    const parts = parseQuestionId(id);
    const listed =
      parts?.kind === "requirement" ? scopes.indexOf(parts.scope) : 0;
    return listed === -1 ? scopes.length : listed;
  };
  return [...entries].sort((left, right) => {
    const byRank = rank(left.id, criteria) - rank(right.id, criteria);
    const byScope = scopeRank(left.id) - scopeRank(right.id);
    if (byRank !== 0) return byRank;
    if (byScope !== 0) return byScope;
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
  });
}

/**
 * Close an entry with the line that holds the marks of its lines.
 * @param lines - The entry's lines, from its heading on
 * @returns The lines, then the marks line
 */
function marked(lines: readonly string[]): readonly string[] {
  return [...lines, entryMarksLine(lines)];
}

/**
 * Render one open question.
 * @param question - The question
 * @returns The entry's lines
 */
function openEntry(question: AuditQuestion): readonly string[] {
  return marked([
    `### ${question.id}`,
    "",
    field(ENTRY_LABEL.question, oneLine(question.text)),
    ...(question.candidates.length === 0
      ? [
          field(ENTRY_LABEL.candidates, NO_CANDIDATES),
          field(
            ENTRY_LABEL.looked,
            oneLine(question.no_candidates_reason ?? "")
          ),
        ]
      : [
          field(ENTRY_LABEL.candidates),
          ...question.candidates.map(
            candidate =>
              `  - ${oneLine(candidate.answer)}. Found: ${oneLine(candidate.found_in)}`
          ),
        ]),
    field(ENTRY_LABEL.answer, ANSWER_PLACEHOLDER),
    field(ENTRY_LABEL.status, STATUS_OPEN),
  ]);
}

/**
 * Render one answered question.
 * @param answer - The answer on record
 * @returns The entry's lines
 */
function answeredEntry(answer: AuditAnswer): readonly string[] {
  return marked([
    `### ${answer.id}`,
    "",
    field(ENTRY_LABEL.question, oneLine(answer.question)),
    field(ENTRY_LABEL.answer, answer.answer),
    field(ENTRY_LABEL.status, STATUS_ABSORBED),
  ]);
}

/**
 * Render a heading and the entries under it.
 * @param heading - The section's heading
 * @param entries - The lines of each entry
 * @returns The section's lines, each entry set off by a blank line
 */
function section(
  heading: string,
  entries: readonly (readonly string[])[]
): readonly string[] {
  return [heading, ...entries.flatMap(entry => ["", ...entry])];
}

/**
 * Put sections between the two marker lines.
 * @param sections - The lines of each section
 * @returns The block's lines
 */
function block(sections: readonly (readonly string[])[]): readonly string[] {
  return [
    QUESTIONS_START,
    ...sections.flatMap(lines => ["", ...lines]),
    "",
    QUESTIONS_END,
  ];
}

/**
 * The questions block of the readable report: what is open, then what was
 * answered.
 * @param report - The report
 * @param criteria - The in-scope criteria, in catalogue order
 * @returns The block's lines; none when nothing was asked or answered
 */
export function questionsSection(
  report: AuditReport,
  criteria: readonly InScopeCriterion[]
): readonly string[] {
  const open = inOrder(report.questions, criteria, report.scopes);
  const answered = inOrder(report.answers, criteria, report.scopes);
  if (open.length === 0 && answered.length === 0) return [];
  return block([
    ...(open.length === 0
      ? []
      : [section(OPEN_QUESTIONS_HEADING, open.map(openEntry))]),
    ...(answered.length === 0
      ? []
      : [section(ANSWERED_QUESTIONS_HEADING, answered.map(answeredEntry))]),
  ]);
}

/**
 * The questions block of a wiki's gaps file: the open questions only.
 * @param report - The report
 * @param criteria - The in-scope criteria, in catalogue order
 * @returns The block's lines, from one marker to the other
 */
export function renderGapsQuestionBlock(
  report: AuditReport,
  criteria: readonly InScopeCriterion[]
): readonly string[] {
  const open = inOrder(report.questions, criteria, report.scopes);
  return block([
    open.length === 0
      ? [GAPS_NONE_OPEN_HEADING]
      : section(GAPS_QUESTIONS_HEADING, open.map(openEntry)),
  ]);
}
