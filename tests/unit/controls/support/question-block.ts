/**
 * A rendered questions block written by hand, for the suites that read one
 * back (CodySwannGT/lisa#4980, CodySwannGT/lisa#4978).
 *
 * The entry is written out here line by line, and closed with the comment
 * line of marks Lisa writes under every entry, so a suite can change one line
 * after the marks were made and see what the reader says about it.
 * @module tests/unit/controls/support/question-block
 */
import { parseQuestionBlock } from "../../../../src/controls/audit-inline-answers.js";
import { entryMarksLine } from "../../../../src/controls/audit-question-lines.js";
import {
  ANSWER_PLACEHOLDER,
  QUESTIONS_END,
  QUESTIONS_START,
} from "../../../../src/controls/audit-questions-format.js";

/** The file the block is read as. */
export const FILE = ".lisa/audit/report.md";

/** Where each line of the first entry of a {@link document} stands. */
export const LINE = {
  heading: 7,
  question: 9,
  candidate: 11,
  answer: 12,
  status: 13,
  marks: 14,
} as const;

/**
 * One question entry in the written form: its lines, then the comment line
 * that holds the marks of the lines Lisa wrote.
 * @param id - The question's id
 * @param answer - What stands after the answer label
 * @param status - What the status line says
 * @returns The entry's lines
 */
export function entry(
  id: string,
  answer = ` ${ANSWER_PLACEHOLDER}`,
  status = "open"
): string[] {
  const lines = [
    `### ${id}`,
    "",
    "- **Question**: Which tracker does the team plan its work in?",
    "- **Candidates**:",
    "  - GitHub Issues (found: the remote named origin is on github.com)",
    `- **Answer**:${answer}`,
    `- **Status**: ${status}`,
  ];
  return [...lines, entryMarksLine(lines)];
}

/**
 * A document holding one marked block.
 * @param inside - The lines between the markers
 * @param around - Lines before and after the block
 * @param around.before - Lines before the start marker
 * @param around.after - Lines after the end marker
 * @returns The document
 */
export function document(
  inside: readonly string[],
  around: { before?: readonly string[]; after?: readonly string[] } = {}
): string {
  return [
    ...(around.before ?? ["# Audit report", ""]),
    QUESTIONS_START,
    "",
    "## Open questions",
    "",
    ...inside,
    "",
    QUESTIONS_END,
    ...(around.after ?? []),
    "",
  ].join("\n");
}

/**
 * A document whose one entry had a line changed after Lisa wrote it.
 * @param line - The line's number in the document
 * @param change - What becomes of the line: other lines, or none
 * @returns The document
 */
export function changed(
  line: number,
  change: (text: string) => readonly string[]
): string {
  return document(
    entry("tracker").flatMap((text, index) =>
      index === line - LINE.heading ? change(text) : [text]
    )
  );
}

/**
 * Read a document the way the report's own file is read.
 * @param text - The document
 * @returns What the reader found
 */
export function read(text: string): ReturnType<typeof parseQuestionBlock> {
  return parseQuestionBlock(text, FILE, { lisaRendered: true });
}
