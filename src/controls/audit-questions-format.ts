/**
 * The written form of a question a person answers inline.
 *
 * It is the form `/lisa:agent-ready` uses for the gaps it lists in
 * `wiki/gaps.md`, so an operator learns one convention: a heading that is the
 * question's stable id, a bulleted `Question`, and an `Answer` line to type
 * on. The audit adds the candidate answers it found, and writes its entries
 * between two marker lines so its block can be told from everything else in a
 * file it shares.
 *
 * Both the code that writes the form and the code that reads it take every
 * word of it from here, so the two cannot drift apart. A leaf module on
 * purpose.
 * @module controls/audit-questions-format
 */

/** The line that opens the block of questions. */
export const QUESTIONS_START = "<!-- lisa:audit-questions:start -->";

/** The line that closes the block of questions. */
export const QUESTIONS_END = "<!-- lisa:audit-questions:end -->";

/** What stands on an answer line until a person types over it. */
export const ANSWER_PLACEHOLDER = "_(human fills in)_";

/** The labels of an entry's lines. */
export const ENTRY_LABEL = {
  question: "Question",
  candidates: "Candidates",
  looked: "Where the audit looked",
  answer: "Answer",
  status: "Status",
} as const;

/** The status of a question nobody has answered. */
export const STATUS_OPEN = "open";

/** The status of a question whose answer is on record. */
export const STATUS_ABSORBED = "absorbed";

/** What a `Candidates` line says when the audit found none. */
export const NO_CANDIDATES = "none found";

/** The folder a repository keeps its knowledge wiki in. */
export const WIKI_FOLDER = "wiki";

/** The wiki file that lists what only a person can answer. */
export const WIKI_GAPS_PATH = `${WIKI_FOLDER}/gaps.md`;

/**
 * The start of an answer line, as an operator is told to look for it.
 * @returns The bullet and label, up to and including the colon
 */
export function answerLineStart(): string {
  return `- **${ENTRY_LABEL.answer}**:`;
}

/**
 * The hint at the start of a line, in any spelling of its emphasis: `_` or
 * `*`, single or doubled, escaped or not, in any letter case. An editor that
 * reformats Markdown rewrites `_(…)_` as `*(…)*` or `\_(…)\_`, and the line
 * still holds only the hint. The marks after the hint must be the ones
 * before it, so the emphasis of an answer typed right beside the hint is
 * left alone. The hint with no emphasis at all is recognised only when it is
 * the whole line (see {@link isPlaceholderAnswer}): beside an answer, bare
 * brackets may be the answer's own.
 */
const LEADING_HINT = /^((?:\\?[_*]){1,3})\(\s*human\s+fills\s+in\s*\)\1/iu;

/** The hint at the end of a line, in any spelling of its emphasis. */
const TRAILING_HINT = /((?:\\?[_*]){1,3})\(\s*human\s+fills\s+in\s*\)\1$/iu;

/**
 * What people write to say an answer is still to come. None of them is an
 * answer, so none is ever recorded as one.
 */
const PLACEHOLDER_WORDS: readonly string[] = [
  "tbd",
  "tbc",
  "tba",
  "todo",
  "n/a",
  "human fills in",
];

/** What may stand around a word without being part of it. */
const WRAPPING: ReadonlySet<string> = new Set([
  "_",
  "*",
  "\\",
  "(",
  ")",
  "[",
  "]",
  ".",
  " ",
  "\t",
]);

/**
 * Take the emphasis marks, brackets and full stops off both ends of a text.
 * @param text - Any text
 * @returns What is left; empty when the text is nothing else
 */
function unwrapped(text: string): string {
  const characters = [...text];
  const isWord = (character: string): boolean => !WRAPPING.has(character);
  const first = characters.findIndex(isWord);
  if (first === -1) return "";
  const afterLast =
    characters.length - [...characters].reverse().findIndex(isWord);
  return characters.slice(first, afterLast).join("");
}

/**
 * Tell whether a text only stands in for an answer: "TBD", "n/a", a question
 * mark, a dash, or the hint written without its brackets.
 * @param text - What is left of an answer line once the hint is taken off
 * @returns Whether it says nothing a person could be held to
 */
export function isPlaceholderAnswer(text: string): boolean {
  const bare = unwrapped(text).toLowerCase();
  return !/[\p{L}\p{N}]/u.test(bare) || PLACEHOLDER_WORDS.includes(bare);
}

/**
 * Reduce what stands on an answer line to the answer itself.
 *
 * The hint is taken off either end, in any spelling, so an answer typed
 * beside it instead of over it still counts, and what is left is trimmed.
 * Nothing inside the answer is changed. A line that then holds only a
 * placeholder holds no answer.
 * @param text - Everything after the answer label
 * @returns The answer, or an empty string when the line holds none
 */
export function normaliseInlineAnswer(text: string): string {
  const trimmed = text.trim();
  const leading = LEADING_HINT.exec(trimmed);
  if (leading !== null) {
    return normaliseInlineAnswer(trimmed.slice(leading[0].length));
  }
  const trailing = TRAILING_HINT.exec(trimmed);
  if (trailing !== null) {
    return normaliseInlineAnswer(trimmed.slice(0, trailing.index));
  }
  return isPlaceholderAnswer(trimmed) ? "" : trimmed;
}

/**
 * Tell whether text is an answer exactly as the reader would hand it back:
 * one line, with nothing to trim, no hint left on it, and more than a
 * placeholder.
 * @param text - Candidate answer
 * @returns Whether reading it from an answer line would return it unchanged
 */
export function isInlineAnswer(text: string): boolean {
  return (
    text !== "" && !/[\n\r]/u.test(text) && normaliseInlineAnswer(text) === text
  );
}
