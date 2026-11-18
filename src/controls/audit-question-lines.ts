/**
 * Noticing a line of a question that is no longer as Lisa wrote it.
 *
 * A person answers a question on its answer line, and only that line is
 * read. Everything else in a question's entry is written again from the
 * record by the next passing check. So text a person typed anywhere else in
 * an entry (on the question, on a candidate, on the status, on a line they
 * added) used to be ignored and then erased, without a word.
 *
 * Reading the entry cannot tell such a line from one Lisa wrote: the record
 * may have changed since the entry was rendered, so there is nothing to
 * compare it with. The entry therefore carries its own reference. Under each
 * one, Lisa writes one comment line holding a short mark for each line of the
 * entry other than the answer line. The reader works out the same marks from
 * the lines it finds, and a line whose mark is not there was changed or
 * added. It is refused with its line number, like every other line that is
 * not in the written form.
 *
 * The comment is invisible where Markdown is rendered. A mark is the start of
 * a SHA-256 digest of the line with its white space evened out, so indenting
 * a line again does not count as changing it. The marks are not a seal
 * against tampering: they exist so that a person's words are never lost
 * silently, and anyone can work them out again.
 *
 * A leaf module on purpose, shared by the code that writes an entry and the
 * code that reads it so the two cannot drift apart.
 * @module controls/audit-question-lines
 */
import { createHash } from "node:crypto";

import { answerLineStart } from "./audit-questions-format.js";

/** What opens the comment line that holds an entry's marks. */
export const ENTRY_MARKS_START = "<!-- lisa:audit-question-lines:";

/** What closes it. */
const ENTRY_MARKS_END = "-->";

/** How many characters of the digest make one mark. */
const MARK_LENGTH = 8;

const MARK = /^[0-9a-f]{8}$/u;

/**
 * The mark of one line.
 * @param line - The line, as written or as found
 * @returns The mark: the same for the same words however they are spaced
 */
export function lineMark(line: string): string {
  return createHash("sha256")
    .update(line.replaceAll(/\s+/gu, " ").trim())
    .digest("hex")
    .slice(0, MARK_LENGTH);
}

/**
 * The comment line Lisa writes under an entry.
 * @param lines - The entry's lines, from its heading on
 * @returns The line holding a mark for each of them that is neither blank
 *   nor the answer line
 */
export function entryMarksLine(lines: readonly string[]): string {
  return [
    ENTRY_MARKS_START,
    ...lines
      .filter(line => line.trim() !== "" && !line.startsWith(answerLineStart()))
      .map(line => lineMark(line)),
    ENTRY_MARKS_END,
  ].join(" ");
}

/** One line of a file, with its number counted from 1. */
export interface NumberedLine {
  readonly text: string;
  readonly number: number;
}

/** How the lines found in an entry differ from the ones Lisa wrote. */
export interface EntryLineDifference {
  /** The lines whose mark the entry does not hold: typed on, or added. */
  readonly changed: readonly NumberedLine[];
  /** How many marks no line answers to: lines that are gone. */
  readonly gone: number;
}

/**
 * Compare the lines found in an entry with the marks written under it.
 * @param lines - The entry's lines other than its answer line
 * @param marks - The marks from the entry's comment line
 * @returns Which lines are not as written, and how many are gone
 */
export function compareEntryLines(
  lines: readonly NumberedLine[],
  marks: readonly string[]
): EntryLineDifference {
  const scan = lines.reduce<{
    readonly unmatched: readonly string[];
    readonly changed: readonly NumberedLine[];
  }>(
    (state, line) => {
      const at = state.unmatched.indexOf(lineMark(line.text));
      return at === -1
        ? { ...state, changed: [...state.changed, line] }
        : {
            ...state,
            unmatched: state.unmatched.filter((_mark, index) => index !== at),
          };
    },
    { unmatched: marks, changed: [] }
  );
  return { changed: scan.changed, gone: scan.unmatched.length };
}

/**
 * Read the marks off a comment line.
 * @param line - Any line of a file
 * @returns The marks, or `null` when the line is not a whole marks line
 */
export function entryMarksOf(line: string): readonly string[] | null {
  const text = line.trim();
  if (!text.startsWith(ENTRY_MARKS_START) || !text.endsWith(ENTRY_MARKS_END)) {
    return null;
  }
  const marks = text
    .slice(ENTRY_MARKS_START.length, -ENTRY_MARKS_END.length)
    .split(/\s+/u)
    .filter(mark => mark !== "");
  return marks.every(mark => MARK.test(mark)) ? marks : null;
}
