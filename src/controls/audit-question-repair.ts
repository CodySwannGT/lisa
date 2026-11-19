/**
 * Saying which lines of a question are not as Lisa wrote them, and how to put
 * the question right without giving up an answer.
 *
 * `./audit-inline-answers.ts` collects the lines of each question entry. This
 * module holds the collected lines to the marks written under the entry
 * (`./audit-question-lines.ts`) and words the refusal.
 *
 * ## No refusal asks for an answer to be given up
 *
 * A question whose lines cannot be put back one by one used to be put right
 * one way only: delete the whole question and run the audit again. For an
 * open question that works, because the record still asks it and the next
 * passing check writes it again. For an answered question it does not. The
 * record is then left holding an answer that is written nowhere a person
 * types, the report check refuses that until the answer is taken off the
 * record, and the person is asked a question they already answered.
 *
 * So the way out depends on what the question holds ({@link Held}):
 *
 * - nothing: start it over;
 * - an answer on record: never delete it. The message says which lines to
 *   put back and where their words are kept;
 * - an answer typed and not yet recorded: keep the answer, then start over.
 *
 * Pure: it takes the lines of an entry and returns sentences.
 * @module controls/audit-question-repair
 */
import {
  ENTRY_HEADING_START,
  ENTRY_MARKS_START,
  compareEntryLines,
  entryMarksLine,
  lineMark,
  type EntryLineDifference,
  type EntryMarks,
  type NumberedLine,
} from "./audit-question-lines.js";
import {
  ENTRY_LABEL,
  STATUS_ABSORBED,
  answerLineStart,
  normaliseInlineAnswer,
} from "./audit-questions-format.js";
import { AUDIT_REPORT_JSON_PATH } from "./audit-report-types.js";

/** What a comment line under an entry holds, and the line it stands on. */
export interface MarksLine extends EntryMarks {
  readonly line: number;
}

/** What stands after a label on one line of an entry, and where. */
export interface LabelledValue {
  readonly value: string;
  readonly line: number;
}

/** The lines of one question entry, as they were found in a file. */
export interface EntryAsFound {
  /** The question's id. */
  readonly id: string;
  /** The number of the entry's heading line. */
  readonly heading: number;
  /**
   * The lines Lisa wrote and nobody types on, the heading first: every
   * labelled line but the answer, and the candidates.
   */
  readonly written: readonly NumberedLine[];
  /** Every comment line of marks found in the entry. */
  readonly marks: readonly MarksLine[];
  /** What each status line found says. */
  readonly statuses: readonly LabelledValue[];
  /** What each answer line found holds. */
  readonly answers: readonly LabelledValue[];
}

/** What every refusal of a stray line tells the person to do. */
export const HOW_TO_ANSWER = `Type the answer on the line that starts "${answerLineStart()}", and leave every other line as it was.`;

/**
 * The way out when an entry that holds no answer cannot be put back line by
 * line. It is never offered for one that holds an answer: see {@link Held}.
 */
const START_OVER = `delete the whole question, from its "###" line to the comment line under its Status line, and run the audit again: Lisa writes the question again`;

/** The status line of a question whose answer is on record, as Lisa writes it. */
const RECORDED_STATUS_LINE = `- **${ENTRY_LABEL.status}**: ${STATUS_ABSORBED}`;

/**
 * What is said about a question whose answer is on record, in place of
 * "delete it". Every line of such a question can be written again from the
 * record, so the message says which lines they are and where their words
 * are kept.
 */
const KEEP_RECORDED_ANSWER = `This question's answer is on record. Do not delete the question, and do not remove its answer from the record: the answer would be lost and the question asked again. Put the question's lines back instead. They are, in this order: the line "${ENTRY_HEADING_START}" followed by the question's id; an empty line; the line "- **${ENTRY_LABEL.question}**: " followed by the question, on one line; the answer line, left as it is; the line "${RECORDED_STATUS_LINE}"; and the comment line that starts "${ENTRY_MARKS_START}", left as it is. The id and the question are in ${AUDIT_REPORT_JSON_PATH}, under "id" and "question" in the entry of "answers" that holds this answer.`;

/** What a question holds that deleting it would lose. */
type Held =
  | { readonly kind: "nothing" }
  | { readonly kind: "typed"; readonly line: number }
  | { readonly kind: "recorded" };

/**
 * Work out what a question holds that deleting it would lose.
 *
 * Whether the answer is on record is read from the marks, which hold the
 * status line as Lisa wrote it, and not from the status line as found: that
 * line may be the very one that was typed on. Only an entry that has lost
 * its marks is taken at the word of its status line.
 * @param entry - The entry's lines
 * @returns What the question holds
 */
function heldBy(entry: EntryAsFound): Held {
  const [marks] = entry.marks;
  const recorded =
    marks === undefined
      ? entry.statuses.some(status => status.value.trim() === STATUS_ABSORBED)
      : marks.marks.includes(lineMark(RECORDED_STATUS_LINE));
  if (recorded) return { kind: "recorded" };
  const typed = entry.answers.find(
    answer => normaliseInlineAnswer(answer.value) !== ""
  );
  return typed === undefined
    ? { kind: "nothing" }
    : { kind: "typed", line: typed.line };
}

/**
 * Say how to put right a question that cannot be put back line by line,
 * without giving up an answer it holds.
 * @param held - What the question holds
 * @param lead - How the sentence opens, for a question that is started over
 * @returns The sentences
 */
function wayOut(held: Held, lead: string): string {
  if (held.kind === "recorded") return KEEP_RECORDED_ANSWER;
  return held.kind === "typed"
    ? `${lead}, first keep a copy of the answer typed on line ${held.line}. Then ${START_OVER}. Type the answer on its new answer line.`
    : `${lead}, ${START_OVER}.`;
}

/**
 * Say how to put right a question that has lost its comment line of marks.
 *
 * A question that holds an answer is given the line to put back. It is made
 * from the lines as they stand, which is all there is to make it from, so
 * the message says what to make sure of first.
 * @param entry - The entry's lines
 * @param held - What the question holds
 * @returns The sentences
 */
function lostMarksWayOut(entry: EntryAsFound, held: Held): string {
  if (held.kind === "nothing") {
    return `To put the question right, ${START_OVER}.`;
  }
  const marks = entryMarksLine(entry.written.map(line => line.text));
  return `This question holds an answer, so do not delete it. Put this line back under its Status line instead: ${marks} It is made from the question's lines as they stand now. So first make sure that its "###" line spells the question's id exactly as ${AUDIT_REPORT_JSON_PATH} holds it, and that nothing was typed on any line but the answer line.`;
}

/**
 * Find the lines of an entry that are not as Lisa wrote them.
 *
 * The heading is held to more than its mark being among the entry's marks:
 * it has to be the heading of the id on the comment line, so the two cannot
 * come to name different questions.
 * @param entry - The entry's lines
 * @param marks - The comment line under the entry
 * @returns Which lines were typed on or added, and how many are gone
 */
function entryDifference(
  entry: EntryAsFound,
  marks: MarksLine
): EntryLineDifference {
  const difference = compareEntryLines(entry.written, marks.marks);
  const [heading] = entry.written;
  const renamed =
    heading !== undefined &&
    !difference.changed.includes(heading) &&
    lineMark(heading.text) !== lineMark(`${ENTRY_HEADING_START}${marks.id}`);
  return renamed
    ? { ...difference, changed: [heading, ...difference.changed] }
    : difference;
}

/**
 * Say which lines of an entry are not as Lisa wrote them.
 * @param entry - The entry's lines
 * @param file - The file's name, for the messages
 * @returns One problem per line that was typed on or added, or one for the
 *   entry when a line or its marks are gone
 */
export function writtenLineProblems(
  entry: EntryAsFound,
  file: string
): readonly string[] {
  const named = `The question "${entry.id}", which starts on line ${entry.heading},`;
  const held = heldBy(entry);
  const [first, ...more] = entry.marks;
  if (first === undefined) {
    return [
      `${file}: ${named} has lost the comment line that starts "${ENTRY_MARKS_START}". Lisa writes it under each question so that text typed on the wrong line is noticed. ${lostMarksWayOut(entry, held)}`,
    ];
  }
  const { changed, gone } = entryDifference(entry, first);
  const spareMarks =
    held.kind === "nothing"
      ? `Keep the one Lisa wrote, or ${START_OVER}.`
      : "Remove it and keep the first, which is the one that is read.";
  return [
    ...more.map(
      extra =>
        `${file} line ${extra.line} is a second comment line of marks for the question "${entry.id}". ${spareMarks}`
    ),
    ...changed.map(
      line =>
        `${file} line ${line.number} is not as Lisa wrote it: it was typed on, or added. Only the answer line is read, so what is typed there would be lost. ${HOW_TO_ANSWER} ${wayOut(held, "If the line cannot be put back")}`
    ),
    ...(gone > 0 && changed.length === 0
      ? [
          `${file}: ${named} has lost a line Lisa wrote. ${wayOut(held, "To put the question right")}`,
        ]
      : []),
  ];
}
