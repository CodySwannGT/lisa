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
 * Reduce what stands on an answer line to the answer itself.
 *
 * The hint is taken off either end, so an answer typed beside it instead of
 * over it still counts, and what is left is trimmed. Nothing inside the answer
 * is changed.
 * @param text - Everything after the answer label
 * @returns The answer, or an empty string when the line holds none
 */
export function normaliseInlineAnswer(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith(ANSWER_PLACEHOLDER)) {
    return normaliseInlineAnswer(trimmed.slice(ANSWER_PLACEHOLDER.length));
  }
  return trimmed.endsWith(ANSWER_PLACEHOLDER)
    ? normaliseInlineAnswer(trimmed.slice(0, -ANSWER_PLACEHOLDER.length))
    : trimmed;
}

/**
 * Tell whether text is an answer exactly as the reader would hand it back:
 * one line, with nothing to trim and no hint left on it.
 * @param text - Candidate answer
 * @returns Whether reading it from an answer line would return it unchanged
 */
export function isInlineAnswer(text: string): boolean {
  return (
    text !== "" && !/[\n\r]/u.test(text) && normaliseInlineAnswer(text) === text
  );
}
