/**
 * Finding the command inside one piece of a line of shell.
 *
 * A piece (`./reconcile-shell-words.ts`) is what stands between two places
 * where shell starts another command. The command in it is rarely the whole
 * piece. Shell writes things around it, and each of them hid a command from
 * `lisa controls reconcile` or made one unrecognisable until it was taken
 * off here:
 *
 * | Written | What is taken off | Left |
 * | --- | --- | --- |
 * | `if ! npm test` | the words shell puts in front | `npm test` |
 * | `{ npm test` | the bracket that opens a group | `npm test` |
 * | `( npx eslint . )`, `(npx eslint .)` | the brackets of a subshell | `npx eslint .` |
 * | `ruff check . )` | the bracket that closes a group opened earlier | `ruff check .` |
 * | `npx lint-staged 2>&1` | the redirect | `npx lint-staged` |
 * | `*.py) ruff check .` | the `case` label | `ruff check .` |
 * | `case "$1" in *.py) ruff check .` | the head of a `case` written on one line, then the label | `ruff check .` |
 * | `check() { npm test`, `function check { npm test` | the name a function is defined under | `npm test` |
 * | `command npm test`, `command -p npm test` | `command`, which only says not to look for a function of that name | `npm test` |
 *
 * `command -v node` and `command -V node` run nothing: they ask whether a
 * program is there, so nothing is left of them.
 *
 * ## Telling a closing bracket from a `case` label
 *
 * Both are a word that ends in `)` with nothing in it that opens one. After
 * a command of several words it can only close a group. After one word it
 * closes a group when the line has one open, and is a label when it has
 * none. Brackets are counted within one line.
 *
 * Nothing here decides whether what is left starts a program: that is
 * `./reconcile-hook-lines.ts`.
 * @module controls/reconcile-shell-command
 */
import {
  withoutRedirects,
  wordAt,
  type Piece,
  type Word,
} from "./reconcile-shell-words.js";

/** The command of a piece, and how the line stands after it. */
export interface PieceCommand {
  /** The command's words; none when the piece holds no command. */
  readonly words: readonly Word[];
  /** How many round brackets the line has open after the piece. */
  readonly depth: number;
}

/** Words that stand in front of a command without being one. */
const PREFIXES = new Set([
  "!",
  "if",
  "then",
  "elif",
  "else",
  "while",
  "until",
  "do",
  "exec",
  "time",
]);

/** The brackets that open a group of commands. */
const OPENERS = new Set(["{", "("]);

/** A word that only closes groups: `)`, `))` or `}`. */
const CLOSERS = /^(?:\)+|\})$/u;

/** A setting written in front of a command, such as `CI=1`. */
const ASSIGNMENT = /^[A-Za-z_]\w*=/u;

/** A word that names a function being defined, such as `check()`. */
const FUNCTION_NAME = /^[A-Za-z_][\w-]*\(\)$/u;

/** The word that says a function is being defined. */
const FUNCTION = "function";

/** The word that runs a program and never a function of the same name. */
const COMMAND = "command";

/** An option that makes `command` say where a program is, and run nothing. */
const PROBE_OPTION = /^-[A-Za-z]*[vV]/u;

/** An option of `command` that is still followed by the program to run. */
const COMMAND_OPTION = /^-[p-]$/u;

/**
 * Tell whether a word is a `case` label: a pattern closed by a bracket that
 * nothing in the word opened.
 * @param word - The word
 * @returns Whether it reads as a label
 */
function isLabel(word: Word): boolean {
  return word.raw.endsWith(")") && !word.raw.includes("(");
}

/**
 * Tell whether a word stands in front of a command without being one.
 * @param word - The word
 * @param last - Whether it is the last word of its piece
 * @returns Whether to look past it for the command
 */
function isPrefix(word: Word, last: boolean): boolean {
  return (
    PREFIXES.has(word.raw) ||
    OPENERS.has(word.raw) ||
    ASSIGNMENT.test(word.raw) ||
    (!last && isLabel(word))
  );
}

/**
 * Count how often a character is written in a word.
 * @param word - The word
 * @param character - The character
 * @returns The count
 */
function count(word: Word, character: string): number {
  return word.raw.split(character).length - 1;
}

/**
 * Count the closing round brackets a word ends with.
 *
 * The word is cut at every `)`, and each bracket at its end leaves an empty
 * part behind it. Nothing here calls itself, so a word that ends in any
 * number of brackets is counted without running out of stack.
 * @param raw - The word as it is written
 * @returns How many `)` stand at its end
 */
function closingEnd(raw: string): number {
  const parts = raw.split(")");
  const lastWritten = parts.reduce(
    (last, part, index) => (part === "" ? last : index),
    0
  );
  return parts.length - 1 - lastWritten;
}

/**
 * Count the words at the start of some words that stand in front of a
 * command.
 * @param words - Some words of a piece
 * @returns How many of the first words are not the command
 */
function prefixCount(words: readonly Word[]): number {
  const at = words.findIndex(
    (word, index) => !isPrefix(word, index === words.length - 1)
  );
  return at === -1 ? words.length : at;
}

/**
 * Count the words at the start of some words that name a function being
 * defined: `check()`, `check ()`, `function check`, `function check()`.
 * @param words - Some words of a piece
 * @returns How many words the name takes; 0 when no function is defined
 */
function definitionLength(words: readonly Word[]): number {
  const keyword = words[0]?.raw === FUNCTION ? 1 : 0;
  const name = words[keyword];
  if (name === undefined) return keyword;
  if (FUNCTION_NAME.test(name.raw)) return keyword + 1;
  if (words[keyword + 1]?.raw === "()") return keyword + 2;
  return keyword === 1 ? 2 : 0;
}

/**
 * Count the words in front of the command of a piece: the words shell puts
 * there, and the name of a function when the piece defines one.
 * @param words - The words of a piece, redirects left out
 * @returns How many words to look past
 */
function leading(words: readonly Word[]): number {
  const before = prefixCount(words);
  const defined = before + definitionLength(words.slice(before));
  return defined + prefixCount(words.slice(defined));
}

/**
 * Take `command` off the front of a command.
 * @param words - The command's words
 * @returns The program `command` runs, with its arguments; nothing when it
 *   only asks whether a program is there
 */
function unwrapped(words: readonly Word[]): readonly Word[] {
  const [first, second] = words;
  if (first?.raw !== COMMAND) return words;
  if (second !== undefined && PROBE_OPTION.test(second.raw)) return [];
  const rest = words.slice(1);
  const at = rest.findIndex(word => !COMMAND_OPTION.test(word.raw));
  return at === -1 ? [] : rest.slice(at);
}

/**
 * Count the words at the end of a piece that only close groups.
 * @param words - The words of a piece
 * @returns How many of its last words are `)` or `}`
 */
function closersAtEnd(words: readonly Word[]): number {
  return words.reduceRight(
    (found, word, index) =>
      found === words.length - 1 - index && CLOSERS.test(word.raw)
        ? found + 1
        : found,
    0
  );
}

/**
 * Take the bracket a subshell is written against off a command's first word.
 * @param words - The command's words
 * @param depth - How many round brackets are open before the command
 * @returns The words without it, and how many are open now
 */
function opened(words: readonly Word[], depth: number): PieceCommand {
  const [first] = words;
  const opens =
    first !== undefined &&
    first.raw.startsWith("(") &&
    !first.raw.startsWith("()");
  return opens
    ? {
        depth: depth + 1,
        words: [wordAt(first.raw.slice(1), first.start + 1), ...words.slice(1)],
      }
    : { depth, words };
}

/**
 * Take the brackets written against a command's last word off it.
 * @param words - The command's words
 * @param depth - How many round brackets are open at the command
 * @returns The words without them, and how many are open now; no words when
 *   the one word there is turns out to be a `case` label
 */
function closed(words: readonly Word[], depth: number): PieceCommand {
  const last = words.at(-1);
  if (last === undefined) return { depth, words };
  const written = closingEnd(last.raw);
  const unmatched = Math.max(count(last, ")") - count(last, "("), 0);
  // After several words a closing bracket can only close a group. After one
  // word it closes a group only when one is open.
  const closes = Math.min(
    written,
    unmatched,
    words.length > 1 ? written : depth
  );
  if (closes === 0) {
    return { depth, words: words.length === 1 && isLabel(last) ? [] : words };
  }
  return {
    depth: Math.max(depth - closes, 0),
    words: [
      ...words.slice(0, -1),
      wordAt(last.raw.slice(0, -closes), last.start),
    ],
  };
}

/**
 * Find the command of a piece: leave out its redirects, the words shell
 * puts in front of a command, and the brackets of the groups it is in.
 * @param piece - The words of one piece of a line
 * @param depth - How many round brackets the line has open before the piece
 * @returns The command's words, and how many round brackets are open now
 */
export function commandOfPiece(
  piece: readonly Word[],
  depth: number
): PieceCommand {
  const kept = withoutRedirects(piece);
  const from = leading(kept);
  const front = kept.slice(0, from);
  const open = depth + front.filter(word => word.raw === "(").length;
  const body = kept.slice(from);
  const closers = closersAtEnd(body);
  const shut = body
    .slice(body.length - closers)
    .reduce((sum, word) => sum + count(word, ")"), 0);
  const inside = body.slice(0, body.length - closers);
  // `((` starts arithmetic, which runs no program.
  if (inside[0]?.raw.startsWith("((") === true) return { depth, words: [] };
  const start = opened(inside, open);
  const end = closed(start.words, start.depth);
  return {
    depth: Math.max(end.depth - shut, 0),
    words: unwrapped(end.words),
  };
}

/**
 * Take the head of a `case` off a piece that holds one, as in
 * `case "$1" in *.py) ruff check .`, so that what follows is read as the
 * first arm.
 * @param words - The words of one piece
 * @returns The words without `case`, the word it tests and `in`; the words
 *   in front of them are kept
 */
export function withoutCaseHead(words: readonly Word[]): readonly Word[] {
  const at = prefixCount(words);
  return words[at]?.raw === "case" && words[at + 2]?.raw === "in"
    ? [...words.slice(0, at), ...words.slice(at + 3)]
    : words;
}

/**
 * Tell whether a piece could be one pattern of a `case` label that lists
 * several: one word that ends at a `|`.
 * @param piece - A piece of a line
 * @returns Whether it has that shape
 */
function isPatternPiece(piece: Piece): boolean {
  const [word, more] = piece.words;
  return (
    piece.piped &&
    word !== undefined &&
    more === undefined &&
    !word.raw.startsWith("(")
  );
}

/**
 * Say of each piece of a line whether it is one pattern of a `case` label
 * that lists several, as in `*.py|*.pyi) ruff check .`.
 *
 * The line is gone through once, from its end, so the time taken grows with
 * the number of pieces and not with its square.
 * @param all - Every piece of the line
 * @returns For each piece, whether it and every piece up to a label is one
 *   word that ends at a `|`
 */
export function casePatterns(all: readonly Piece[]): readonly boolean[] {
  return all.reduceRight<readonly boolean[]>((flags, piece, at) => {
    const [following] = all[at + 1]?.words ?? [];
    const labelled = following !== undefined && isLabel(following);
    return [isPatternPiece(piece) && (labelled || flags[0] === true), ...flags];
  }, []);
}
