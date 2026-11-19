/**
 * Reading what a person typed on the answer lines of a rendered report.
 *
 * What is read here becomes a recorded fact, so the reader is strict and it is
 * safe:
 *
 * - an answer is recognised in one place only: on the `Answer` line of a
 *   question entry, between the two marker lines;
 * - an answer line that is empty, or still holds the hint it was written
 *   with, is not an answer;
 * - text anywhere else in the file is never read as an answer;
 * - a block that is not in the written form is refused, with the file and the
 *   line named. Nothing is skipped silently, because a line that was skipped
 *   may be the one a person typed their answer on;
 * - the same goes for a line of an entry that is in the written form but is
 *   not as Lisa wrote it: text typed on the question, on a candidate or on
 *   the status, or a line added under the candidates. Each entry carries the
 *   marks of its own lines (`./audit-question-lines.ts`), and a line that
 *   does not match one is refused with its number. A mark is made from the
 *   words of a line, so a Markdown formatter run over the file changes none;
 * - a question's id is taken from the comment line under its entry, where
 *   Lisa wrote it beside the marks. The heading shows the same id to a
 *   person, but a formatter may spell it another way (`_private` becomes
 *   `\_private`), and an answer must never be filed under an id Lisa did not
 *   give;
 * - no refusal ever asks for an answer to be given up. A question that holds
 *   an answer is put right by restoring its lines, never by deleting it
 *   (`./audit-question-repair.ts`).
 *
 * The functions are pure: they take the text of a file and return what it
 * holds. `./audit-inline-answers-file.ts` does the reading from disk.
 * @module controls/audit-inline-answers
 */
import { entryMarksOf, type NumberedLine } from "./audit-question-lines.js";
import {
  locateRegion,
  numberedLines,
  strayAnswerLines,
  type QuestionRegion,
} from "./audit-question-region.js";
import {
  HOW_TO_ANSWER,
  writtenLineProblems,
  type LabelledValue,
  type MarksLine,
} from "./audit-question-repair.js";
import {
  ANSWER_PLACEHOLDER,
  ENTRY_LABEL,
  STATUS_ABSORBED,
  answerLineStart,
  normaliseInlineAnswer,
} from "./audit-questions-format.js";
import type { InlineEntry } from "./audit-report-types.js";
import { parseQuestionId } from "./question-ids.js";

/** What one file holds. */
export interface QuestionBlock {
  /** Every question entry of the block, in the order written. */
  readonly entries: readonly InlineEntry[];
  /** One line per thing wrong, each naming the file and the line. */
  readonly problems: readonly string[];
  /** Where the block is; `null` when the file has none, or a broken one. */
  readonly region: QuestionRegion | null;
}

/** How a file is read. */
export interface QuestionBlockOptions {
  /**
   * Whether Lisa renders the whole file. In such a file an answer line
   * outside the block means the markers were disturbed, and is refused. In a
   * file Lisa shares with others, everything outside the block is theirs and
   * is left unread.
   */
  readonly lisaRendered: boolean;
}

/** One labelled line of an entry. */
interface EntryField extends LabelledValue {
  readonly label: string;
}

/** An entry while its lines are being collected. */
interface EntryDraft {
  /** The id as the heading spells it, which a formatter may have changed. */
  readonly id: string;
  /** The number of the entry's heading line. */
  readonly heading: number;
  readonly fields: readonly EntryField[];
  /**
   * The lines Lisa wrote and nobody types on: the heading, every labelled
   * line but the answer, and the candidates.
   */
  readonly written: readonly NumberedLine[];
  /** Every comment line of marks found in the entry. */
  readonly marks: readonly MarksLine[];
}

/** What reading the lines of a block has collected so far. */
interface BlockScan {
  readonly drafts: readonly EntryDraft[];
  readonly problems: readonly string[];
}

const FIELD = /^- \*\*([^*]+)\*\*:(.*)$/u;
const ENTRY_HEADING = /^### (.+)$/u;
const SECTION_HEADING = /^## /u;
const SUB_BULLET = /^\s+- /u;
const KNOWN_LABELS: readonly string[] = Object.values(ENTRY_LABEL);

/**
 * Take one line into the entry it belongs to.
 * @param draft - The entry the line follows
 * @param line - The line
 * @returns The entry with the line placed, or `null` when the line is not
 *   part of an entry
 */
function extendDraft(draft: EntryDraft, line: NumberedLine): EntryDraft | null {
  const marks = entryMarksOf(line.text);
  if (marks !== null) {
    return {
      ...draft,
      marks: [...draft.marks, { ...marks, line: line.number }],
    };
  }
  const field = FIELD.exec(line.text);
  if (field !== null) {
    const label = (field[1] ?? "").trim();
    const placed: EntryField = {
      label,
      value: field[2] ?? "",
      line: line.number,
    };
    // The answer line is where a person types, and a line with a label that
    // is not part of a question is refused by name: neither is compared.
    const compared =
      label !== ENTRY_LABEL.answer && KNOWN_LABELS.includes(label);
    return {
      ...draft,
      fields: [...draft.fields, placed],
      written: compared ? [...draft.written, line] : draft.written,
    };
  }
  const underCandidates =
    SUB_BULLET.test(line.text) &&
    draft.fields.at(-1)?.label === ENTRY_LABEL.candidates;
  return underCandidates
    ? { ...draft, written: [...draft.written, line] }
    : null;
}

/**
 * Take one line of the block into the scan.
 * @param scan - What has been collected so far
 * @param line - The next line of the block
 * @param file - The file's name, for the messages
 * @returns The scan with the line placed, or refused
 */
function placeLine(
  scan: BlockScan,
  line: NumberedLine,
  file: string
): BlockScan {
  if (line.text.trim() === "" || SECTION_HEADING.test(line.text)) return scan;
  const heading = ENTRY_HEADING.exec(line.text);
  if (heading !== null) {
    const opened: EntryDraft = {
      id: (heading[1] ?? "").trim(),
      heading: line.number,
      fields: [],
      written: [line],
      marks: [],
    };
    return { ...scan, drafts: [...scan.drafts, opened] };
  }
  const current = scan.drafts.at(-1);
  const extended = current === undefined ? null : extendDraft(current, line);
  return extended === null
    ? {
        ...scan,
        problems: [
          ...scan.problems,
          `${file} line ${line.number} is not part of a question. ${HOW_TO_ANSWER}`,
        ],
      }
    : { ...scan, drafts: [...scan.drafts.slice(0, -1), extended] };
}

/**
 * The id of an entry: the one Lisa wrote on the comment line under it. The
 * heading's spelling stands in only for an entry that has lost that line,
 * which is refused for the loss.
 * @param draft - The entry's lines
 * @returns The id
 */
function idOf(draft: EntryDraft): string {
  return draft.marks[0]?.id ?? draft.id;
}

/**
 * Hand the lines of an entry that is in the written form to the code that
 * holds them to their marks.
 * @param draft - The entry's lines
 * @param file - The file's name, for the messages
 * @returns What is wrong with the lines Lisa wrote, if anything
 */
function heldToMarks(draft: EntryDraft, file: string): readonly string[] {
  const of = (label: string): readonly EntryField[] =>
    draft.fields.filter(field => field.label === label);
  return writtenLineProblems(
    {
      id: idOf(draft),
      heading: draft.heading,
      written: draft.written,
      marks: draft.marks,
      statuses: of(ENTRY_LABEL.status),
      answers: of(ENTRY_LABEL.answer),
    },
    file
  );
}

/**
 * Check one collected entry and turn it into what a person left.
 * @param draft - The entry's lines
 * @param earlier - The ids of the entries before it
 * @param file - The file's name, for the messages
 * @returns The entry, or what is wrong with it
 */
function readDraft(
  draft: EntryDraft,
  earlier: readonly string[],
  file: string
): {
  readonly entry: InlineEntry | null;
  readonly problems: readonly string[];
} {
  const id = idOf(draft);
  const named = `The question "${id}", which starts on line ${draft.heading},`;
  const of = (label: string): readonly EntryField[] =>
    draft.fields.filter(field => field.label === label);
  const [question] = of(ENTRY_LABEL.question);
  const [answer, ...moreAnswers] = of(ENTRY_LABEL.answer);
  const malformed = [
    ...(parseQuestionId(id) === null
      ? [
          `${file} line ${draft.heading}: "${id}" is not the id of a question. Put the heading back as Lisa wrote it.`,
        ]
      : []),
    ...(earlier.includes(id)
      ? [
          `${file} line ${draft.heading} repeats the question "${id}". Keep one entry for it, with the answer on its answer line.`,
        ]
      : []),
    ...draft.fields
      .filter(field => !KNOWN_LABELS.includes(field.label))
      .map(
        field =>
          `${file} line ${field.line} has the label "${field.label}", which is not part of a question. ${HOW_TO_ANSWER}`
      ),
    ...(question === undefined
      ? [
          `${file}: ${named} has no question line. Put back the line that starts "- **${ENTRY_LABEL.question}**:".`,
        ]
      : []),
    ...(answer === undefined
      ? [
          `${file}: ${named} has no answer line. Put back the line "${answerLineStart()} ${ANSWER_PLACEHOLDER}" under it, then type the answer on it.`,
        ]
      : []),
    ...moreAnswers.map(
      extra =>
        `${file} line ${extra.line} is a second answer line for the question "${id}". Keep one answer line for each question.`
    ),
  ];
  // An entry that is not in the written form is refused for that alone. One
  // that is in the form is then held to the marks of its own lines.
  const problems = malformed.length > 0 ? malformed : heldToMarks(draft, file);
  return {
    problems,
    entry:
      problems.length > 0 || question === undefined || answer === undefined
        ? null
        : {
            id,
            question: question.value.trim(),
            answer: normaliseInlineAnswer(answer.value) || null,
            answered: of(ENTRY_LABEL.status).some(
              status => status.value.trim() === STATUS_ABSORBED
            ),
            file,
            line: answer.line,
          },
  };
}

/**
 * Read the block of questions a file holds.
 * @param text - The file's content
 * @param file - The file's name, relative to the repository root
 * @param options - How the file is read
 * @returns The entries a person left, or everything wrong with the block
 */
export function parseQuestionBlock(
  text: string,
  file: string,
  options: QuestionBlockOptions
): QuestionBlock {
  const lines = numberedLines(text);
  const located = locateRegion(lines, file);
  const stray =
    options.lisaRendered && located.problems.length === 0
      ? strayAnswerLines(lines, located.region, file)
      : [];
  if (located.region === null) {
    return {
      entries: [],
      problems: [...located.problems, ...stray],
      region: null,
    };
  }
  const scanned = lines
    .slice(located.region.start + 1, located.region.end)
    .reduce<BlockScan>((scan, line) => placeLine(scan, line, file), {
      drafts: [],
      problems: [],
    });
  const read = scanned.drafts.map((draft, index) =>
    readDraft(
      draft,
      scanned.drafts.slice(0, index).map(earlier => idOf(earlier)),
      file
    )
  );
  const problems = [
    ...scanned.problems,
    ...read.flatMap(result => result.problems),
    ...stray,
  ];
  return {
    entries:
      problems.length === 0
        ? read.flatMap(result => (result.entry === null ? [] : [result.entry]))
        : [],
    problems,
    region: located.region,
  };
}

/**
 * Bring the entries of several files together, each question once.
 *
 * A question may be answered in either file it is written to. An answer wins
 * over an empty line, and an answered entry that was emptied wins over an
 * open one. Two different answers to one question are refused, because
 * choosing between them is not Lisa's to do.
 * @param entries - The entries of every file read
 * @returns Each question once, or the answers that contradict each other
 */
export function mergeInlineEntries(entries: readonly InlineEntry[]): {
  readonly entries: readonly InlineEntry[];
  readonly problems: readonly string[];
} {
  const ids = [...new Set(entries.map(entry => entry.id))];
  const merged = ids.map(id => {
    const written = entries.filter(entry => entry.id === id);
    const [first, ...others] = written.filter(entry => entry.answer !== null);
    const clash = others.find(other => other.answer !== first?.answer);
    return {
      entry: first ?? written.find(entry => entry.answered) ?? written[0],
      problem:
        first === undefined || clash === undefined
          ? null
          : `${first.file} line ${first.line} and ${clash.file} line ${clash.line} give different answers to "${first.question}". Keep the one that is right, empty the other answer line, then run this again.`,
    };
  });
  return {
    entries: merged.flatMap(({ entry }) =>
      entry === undefined ? [] : [entry]
    ),
    problems: merged.flatMap(({ problem }) =>
      problem === null ? [] : [problem]
    ),
  };
}
