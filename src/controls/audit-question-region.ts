/**
 * Finding the block of questions in a file.
 *
 * The audit's questions stand between two marker lines, so that its block can
 * be told from everything else in a file it shares. This module finds that
 * block, and refuses anything but one whole block: a marker with no partner,
 * a second block, or, in a file Lisa renders whole, an answer line that has
 * ended up outside the markers. Reading what the block holds is
 * `./audit-inline-answers.ts`.
 *
 * Pure: it takes the lines of a file and returns where the block is.
 * @module controls/audit-question-region
 */
import type { NumberedLine } from "./audit-question-lines.js";
import {
  QUESTIONS_END,
  QUESTIONS_START,
  answerLineStart,
} from "./audit-questions-format.js";

/** Where the block of questions sits in a file. */
export interface QuestionRegion {
  /** Index of the opening marker line, counted from 0. */
  readonly start: number;
  /** Index of the closing marker line, counted from 0. */
  readonly end: number;
}

/** What walking the marker lines of a file has established so far. */
interface MarkerScan {
  readonly state: "before" | "inside" | "after";
  readonly start: number;
  readonly end: number;
  readonly problems: readonly string[];
}

/**
 * Split a file into numbered lines, without the line breaks.
 * @param text - The file's content
 * @returns Each line, a carriage return at its end removed
 */
export function numberedLines(text: string): readonly NumberedLine[] {
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
export function locateRegion(
  lines: readonly NumberedLine[],
  file: string
): {
  readonly region: QuestionRegion | null;
  readonly problems: readonly string[];
} {
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
 * Refuse an answer line that sits outside the block of a file Lisa renders.
 * @param lines - The file's lines
 * @param region - Where the block is, when there is one
 * @param file - The file's name, for the messages
 * @returns One problem per such line
 */
export function strayAnswerLines(
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
