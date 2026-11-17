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
 *   may be the one a person typed their answer on.
 *
 * The functions are pure: they take the text of a file and return what it
 * holds. `./audit-inline-answers-file.ts` does the reading from disk.
 * @module controls/audit-inline-answers
 */
import {
  ANSWER_PLACEHOLDER,
  ENTRY_LABEL,
  QUESTIONS_END,
  QUESTIONS_START,
  STATUS_ABSORBED,
  answerLineStart,
  normaliseInlineAnswer,
} from "./audit-questions-format.js";
import type { InlineEntry } from "./audit-report-types.js";
import { parseQuestionId } from "./question-ids.js";

/** Where the block of questions sits in a file. */
export interface QuestionRegion {
  /** Index of the opening marker line, counted from 0. */
  readonly start: number;
  /** Index of the closing marker line, counted from 0. */
  readonly end: number;
}

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

/** One line of a file, with its number counted from 1. */
interface NumberedLine {
  readonly text: string;
  readonly number: number;
}

/** One labelled line of an entry. */
interface EntryField {
  readonly label: string;
  readonly value: string;
  readonly line: number;
}

/** An entry while its lines are being collected. */
interface EntryDraft {
  readonly id: string;
  /** The number of the entry's heading line. */
  readonly heading: number;
  readonly fields: readonly EntryField[];
}

/** What reading the lines of a block has collected so far. */
interface BlockScan {
  readonly drafts: readonly EntryDraft[];
  readonly problems: readonly string[];
}

/** What walking the marker lines of a file has established so far. */
interface MarkerScan {
  readonly state: "before" | "inside" | "after";
  readonly start: number;
  readonly end: number;
  readonly problems: readonly string[];
}

const FIELD = /^- \*\*([^*]+)\*\*:(.*)$/u;
const ENTRY_HEADING = /^### (.+)$/u;
const SECTION_HEADING = /^## /u;
const SUB_BULLET = /^\s+- /u;
const KNOWN_LABELS: readonly string[] = Object.values(ENTRY_LABEL);

/** What every refusal of a stray line tells the person to do. */
const HOW_TO_ANSWER = `Type the answer on the line that starts "${answerLineStart()}", and leave every other line as it was.`;

/**
 * Split a file into numbered lines, without the line breaks.
 * @param text - The file's content
 * @returns Each line, a carriage return at its end removed
 */
function numberedLines(text: string): readonly NumberedLine[] {
  return text.split("\n").map((line, index) => ({
    text: line.endsWith("\r") ? line.slice(0, -1) : line,
    number: index + 1,
  }));
}

/**
 * Find the block's two marker lines, and refuse anything but one whole block.
 * @param lines - The file's lines
 * @param file - The file's name, for the messages
 * @returns Where the block is, or what is wrong with the markers
 */
function locateRegion(
  lines: readonly NumberedLine[],
  file: string
): { readonly region: QuestionRegion | null; readonly problems: string[] } {
  const never = (line: number): string =>
    `${file} line ${line} closes a questions block that was never opened. Put back the line "${QUESTIONS_START}" above the questions.`;
  const second = (line: number): string =>
    `${file} line ${line} opens a second questions block. A file holds one: remove the copy.`;
  const scanned = lines.reduce<MarkerScan>(
    (scan, line, index) => {
      const marker = line.text.trim();
      if (marker !== QUESTIONS_START && marker !== QUESTIONS_END) return scan;
      const opens = marker === QUESTIONS_START;
      if (scan.state === "before" && opens) {
        return { ...scan, state: "inside", start: index };
      }
      if (scan.state === "inside" && !opens) {
        return { ...scan, state: "after", end: index };
      }
      return {
        ...scan,
        problems: [
          ...scan.problems,
          opens ? second(line.number) : never(line.number),
        ],
      };
    },
    { state: "before", start: -1, end: -1, problems: [] }
  );
  const problems = [
    ...scanned.problems,
    ...(scanned.state === "inside"
      ? [
          `${file} line ${scanned.start + 1} opens the questions block, but nothing closes it. Put back the line "${QUESTIONS_END}" under the last question.`,
        ]
      : []),
  ];
  return {
    region:
      problems.length === 0 && scanned.state === "after"
        ? { start: scanned.start, end: scanned.end }
        : null,
    problems,
  };
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
    return {
      ...scan,
      drafts: [
        ...scan.drafts,
        { id: (heading[1] ?? "").trim(), heading: line.number, fields: [] },
      ],
    };
  }
  const current = scan.drafts.at(-1);
  const field = FIELD.exec(line.text);
  if (current !== undefined && field !== null) {
    const placed: EntryField = {
      label: (field[1] ?? "").trim(),
      value: field[2] ?? "",
      line: line.number,
    };
    return {
      ...scan,
      drafts: [
        ...scan.drafts.slice(0, -1),
        { ...current, fields: [...current.fields, placed] },
      ],
    };
  }
  const underCandidates =
    SUB_BULLET.test(line.text) &&
    current?.fields.at(-1)?.label === ENTRY_LABEL.candidates;
  return underCandidates
    ? scan
    : {
        ...scan,
        problems: [
          ...scan.problems,
          `${file} line ${line.number} is not part of a question. ${HOW_TO_ANSWER}`,
        ],
      };
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
): { readonly entry: InlineEntry | null; readonly problems: string[] } {
  const named = `The question "${draft.id}", which starts on line ${draft.heading},`;
  const of = (label: string): readonly EntryField[] =>
    draft.fields.filter(field => field.label === label);
  const [question] = of(ENTRY_LABEL.question);
  const [answer, ...moreAnswers] = of(ENTRY_LABEL.answer);
  const problems = [
    ...(parseQuestionId(draft.id) === null
      ? [
          `${file} line ${draft.heading}: "${draft.id}" is not the id of a question. Put the heading back as Lisa wrote it.`,
        ]
      : []),
    ...(earlier.includes(draft.id)
      ? [
          `${file} line ${draft.heading} repeats the question "${draft.id}". Keep one entry for it, with the answer on its answer line.`,
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
        `${file} line ${extra.line} is a second answer line for the question "${draft.id}". Keep one answer line for each question.`
    ),
  ];
  return {
    problems,
    entry:
      problems.length > 0 || question === undefined || answer === undefined
        ? null
        : {
            id: draft.id,
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
 * Refuse an answer line that sits outside the block of a file Lisa renders.
 * @param lines - The file's lines
 * @param region - Where the block is, when there is one
 * @param file - The file's name, for the messages
 * @returns One problem per such line
 */
function strayAnswerLines(
  lines: readonly NumberedLine[],
  region: QuestionRegion | null,
  file: string
): readonly string[] {
  return lines
    .filter(
      (line, index) =>
        (region === null || index < region.start || index > region.end) &&
        line.text.trimStart().startsWith(answerLineStart())
    )
    .map(
      line =>
        `${file} line ${line.number} is an answer line outside the questions block, so it cannot be matched to a question. Move the answer onto the answer line of its question, between "${QUESTIONS_START}" and "${QUESTIONS_END}".`
    );
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
      scanned.drafts.slice(0, index).map(earlier => earlier.id),
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
