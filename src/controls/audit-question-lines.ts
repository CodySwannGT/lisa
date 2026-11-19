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
 * one, Lisa writes one comment line holding the question's id and a short
 * mark for each line of the entry other than the answer line. The reader
 * works out the same marks from the lines it finds, and a line whose mark is
 * not there was changed or added. It is refused with its line number, like
 * every other line that is not in the written form.
 *
 * ## What a mark is made from
 *
 * A mark is the start of a SHA-256 digest of the words of a line: the line
 * with everything taken out that a Markdown formatter puts in, takes out or
 * swaps without changing a word ({@link wordsOf}). Without that, a formatter
 * run over the file made every line holding such a character read as typed
 * on. Prettier, for one, writes `*` as `\*`, `__name__` as `**name**`,
 * `*word*` as `_word_`, doubled backticks around code as single ones, a `+`
 * or `*` bullet as `-`, and `1)` as `1.`.
 *
 * The cost is stated plainly: a person who only adds or removes a `\`, a
 * `*`, a `_` or a backtick on a line Lisa wrote, or changes how it is spaced
 * or bulleted, is not noticed. Any other character they type is.
 *
 * Two things a formatter can do are still refused, because undoing them
 * would mean reading a question some other way than line by line: wrapping a
 * long line onto a second one (Prettier does so only when told to, with
 * `proseWrap`), and writing out a character reference (`&#42;` as `\*`).
 *
 * ## Why the id is on the comment line
 *
 * The heading of an entry is the question's id, and a formatter rewrites the
 * heading like any other line: `_private` becomes `\_private`. The heading
 * still has the mark Lisa gave it, but it no longer spells the id. A
 * formatter leaves a comment alone, so the id is written there as well, and
 * that is the one the reader takes. Only what would break the line itself is
 * written out there as `%` and its bytes: white space, `%`, `<` and `>`.
 *
 * The comment is invisible where Markdown is rendered. The marks are not a
 * seal against tampering: they exist so that a person's words are never lost
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

/** What opens the heading line of an entry, before the question's id. */
export const ENTRY_HEADING_START = "### ";

/** What stands before the id on the comment line. */
const ID_LABEL = "id=";

/** How many characters of the digest make one mark. */
const MARK_LENGTH = 8;

const MARK = /^[0-9a-f]{8}$/u;

/** The characters a formatter adds, drops or swaps around words. */
const EMPHASIS_AND_ESCAPES = /[\\*_`]/gu;

/** Every list marker a line opens with: bullets, and numbers. */
const LEADING_LIST_MARKERS = /^(?:(?:[-+*]|\d+[.)]) )+/u;

/**
 * The characters of an id that are written as they are on the comment line:
 * every printable ASCII character but the space, which ends a word of the
 * line, `%`, which opens a written-out character, and `<` and `>`, which
 * could close the comment early.
 *
 * As much as possible is left as it is on purpose. A refusal may quote this
 * line, and whatever takes credential-shaped values out of a message has to
 * be able to see one that was typed over a heading.
 */
const PLAIN_IN_ID = /^[!-$&-;=?-~]$/u;

/**
 * Put every run of white space as one space, and none at either end.
 * @param text - Any text
 * @returns The text, evenly spaced
 */
function evenlySpaced(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

/**
 * Write the list markers a line opens with in one spelling: every bullet as
 * `-`, and every number with a full stop after it.
 * @param markers - The markers, each followed by one space
 * @returns The same markers, spelled one way
 */
function oneSpelling(markers: string): string {
  return markers.replaceAll(/[+*]/gu, "-").replaceAll(")", ".");
}

/**
 * Reduce a line to its words: what is left when everything a Markdown
 * formatter may change without changing a word is taken out.
 * @param line - The line, as written or as found
 * @returns The line evenly spaced, its opening list markers in one spelling,
 *   and without any `\`, `*`, `_` or backtick
 */
function wordsOf(line: string): string {
  return evenlySpaced(
    evenlySpaced(line)
      .replace(LEADING_LIST_MARKERS, oneSpelling)
      .replaceAll(EMPHASIS_AND_ESCAPES, "")
  );
}

/**
 * The mark of one line.
 * @param line - The line, as written or as found
 * @returns The mark: the same for the same words, however a formatter has
 *   spaced, bulleted, emphasised or escaped them
 */
export function lineMark(line: string): string {
  return createHash("sha256")
    .update(wordsOf(line))
    .digest("hex")
    .slice(0, MARK_LENGTH);
}

/**
 * Write an id so that it is one word of the comment line and cannot close
 * the comment: printable ASCII as it is, and white space, `%`, `<`, `>` and
 * every other character as `%` and its bytes.
 * @param id - A question's id
 * @returns The id, as it stands on the comment line
 */
function writtenId(id: string): string {
  return [...id]
    .map(character =>
      PLAIN_IN_ID.test(character)
        ? character
        : [...new TextEncoder().encode(character)]
            .map(byte => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
            .join("")
    )
    .join("");
}

/**
 * Read an id back off the comment line.
 * @param written - What stands after the id label
 * @returns The id, or `null` when it is empty or not in the written form
 */
function readId(written: string): string | null {
  try {
    const id = decodeURIComponent(written);
    return id !== "" && writtenId(id) === written ? id : null;
  } catch {
    return null;
  }
}

/**
 * The comment line Lisa writes under an entry.
 * @param lines - The entry's lines, from its heading on
 * @returns The line holding the id from the heading, then a mark for each
 *   line that is neither blank nor the answer line
 */
export function entryMarksLine(lines: readonly string[]): string {
  const heading = lines[0] ?? "";
  const id = heading.startsWith(ENTRY_HEADING_START)
    ? heading.slice(ENTRY_HEADING_START.length).trim()
    : "";
  return [
    ENTRY_MARKS_START,
    `${ID_LABEL}${writtenId(id)}`,
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

/** What the comment line under an entry holds. */
export interface EntryMarks {
  /** The question's id, as Lisa wrote it in the heading. */
  readonly id: string;
  /** One mark for each line Lisa wrote, the heading's first. */
  readonly marks: readonly string[];
}

/**
 * Read the id and the marks off a comment line.
 * @param line - Any line of a file
 * @returns What the line holds, or `null` when it is not a whole marks line
 */
export function entryMarksOf(line: string): EntryMarks | null {
  const text = line.trim();
  if (!text.startsWith(ENTRY_MARKS_START) || !text.endsWith(ENTRY_MARKS_END)) {
    return null;
  }
  const [first = "", ...marks] = text
    .slice(ENTRY_MARKS_START.length, -ENTRY_MARKS_END.length)
    .split(/\s+/u)
    .filter(word => word !== "");
  const id = first.startsWith(ID_LABEL)
    ? readId(first.slice(ID_LABEL.length))
    : null;
  return id !== null && marks.every(mark => MARK.test(mark))
    ? { id, marks }
    : null;
}
