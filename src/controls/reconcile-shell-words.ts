/**
 * Splitting one line of shell into the words of each command on it.
 *
 * This is the first half of the reader behind `lisa controls reconcile`
 * (`./reconcile-hook-lines.ts` is the second): it is given a line and
 * returns the words of each piece of it, and it runs nothing.
 *
 * ## Where a line is split
 *
 * Wherever shell starts another command, outside quotes and outside a
 * command substitution: `&&`, `||`, `;`, a pipe (`|`, `|&`) and a lone `&`
 * that leaves the command before it running. Between `[[` and `]]` only `;`
 * splits, because `&&`, `||` and `|` are part of the test there.
 *
 * ## What is not a word of a command
 *
 * A redirect (`2>&1`, `>/dev/null`, `> out.log`, `< input`, `<<EOF`) says
 * where a command's output goes or its input comes from, and the program is
 * never handed it. {@link withoutRedirects} leaves it out, with the file it
 * names.
 *
 * ## Reading time
 *
 * A command substitution is read one way only. A `$` is read on its own
 * only where no whole substitution starts, so a quote that never closes is
 * given up on once, not once for every way of reading what is in it. Read
 * both ways, each substitution in such a quote doubled the time the line
 * took.
 * @module controls/reconcile-shell-words
 */

/** One word of a line, and where it starts. */
export interface Word {
  /** The word with its quotes taken off. */
  readonly text: string;
  /** The word as it is written. */
  readonly raw: string;
  /** Where it starts in the line. */
  readonly start: number;
}

/** The words of one command of a line. */
export interface Piece {
  readonly words: readonly Word[];
  /** Whether a pipe ends it, so that the next piece reads what it prints. */
  readonly piped: boolean;
}

/** The pieces of a line read so far. */
interface Pieces {
  readonly done: readonly Piece[];
  readonly current: readonly Word[];
  /** Whether a comment was reached, so the rest of the line is ignored. */
  readonly ended: boolean;
  /** Whether the words being read are between `[[` and `]]`. */
  readonly testing: boolean;
}

/** The older spelling of a command substitution's delimiter. */
const TICK = "`";

/** What follows the `$` of a command substitution: one level of brackets. */
const SUBSTITUTED = String.raw`\((?:[^()]|\([^()]*\))*\)`;

/** A command substitution, with one level of brackets inside it. */
const SUBSTITUTION = String.raw`\$${SUBSTITUTED}`;

/**
 * A `$` that starts no whole command substitution. Without the look ahead a
 * `$(…)` could be read two ways, and a quote that never closes would be
 * tried both ways for every substitution in it.
 */
const LONE_DOLLAR = String.raw`\$(?!${SUBSTITUTED})`;

/** What a double-quoted span holds: text, escapes and substitutions. */
const DOUBLE_QUOTED = String.raw`(?:[^"\\$]|\\.|${SUBSTITUTION}|${LONE_DOLLAR})*`;

/**
 * One token of a line: a gap, a place where shell starts another command, a
 * comment that runs to the end of the line, or a word. A quoted span and a
 * command substitution belong to the word they are in, spaces and all.
 */
const TOKEN = new RegExp(
  [
    String.raw`\s+|&&|\|\||\|&?|;+|#.*$`,
    String.raw`(?:[^\s'"\\;&|$${TICK}]|\\.|'[^']*'|"${DOUBLE_QUOTED}"|${SUBSTITUTION}|${LONE_DOLLAR}|${TICK}[^${TICK}]*${TICK}|&(?!&))+`,
  ].join("|"),
  "gu"
);

/** Where shell starts another command. */
const CHAIN = /^(?:&&|\|\||\|&?|;+|&)$/u;

/** A pipe: the command after it reads what the one before it prints. */
const PIPE = /^\|&?$/u;

/** The one chain that still splits between `[[` and `]]`. */
const SEMICOLONS = /^;+$/u;

/** A quoted span or an escaped character inside a word. */
const QUOTED = new RegExp(
  String.raw`'([^']*)'|"(${DOUBLE_QUOTED})"|\\(.)`,
  "gsu"
);

/**
 * A redirect: an optional file descriptor, the operator, and the file or
 * descriptor it names when that is written against it.
 */
const REDIRECT = /^(?:\d+|&)?(?:>>|>&|>|<<<|<<-|<<|<&|<>|<)(.*)$/u;

/**
 * Take the quotes off a word.
 * @param raw - The word as it is written
 * @returns The word as the shell would hand it to a program
 */
function unquoted(raw: string): string {
  return raw.replaceAll(
    QUOTED,
    (
      _all,
      single: string | undefined,
      double: string | undefined,
      escaped: string | undefined
    ) => single ?? double?.replaceAll(/\\(.)/gsu, "$1") ?? escaped ?? ""
  );
}

/**
 * Make a word from what is written at a place in a line.
 * @param raw - The word as it is written
 * @param start - Where it starts in the line
 * @returns The word
 */
export function wordAt(raw: string, start: number): Word {
  return { raw, start, text: unquoted(raw) };
}

/**
 * Split a line where shell starts another command, outside quotes.
 * @param text - The line
 * @returns The words of each piece, in order
 */
export function pieces(text: string): readonly Piece[] {
  const read = [...text.matchAll(TOKEN)].reduce<Pieces>(
    (so, match) => {
      const [raw] = match;
      if (so.ended || raw.trim() === "") return so;
      if (raw.startsWith("#")) return { ...so, ended: true };
      const splits = so.testing ? SEMICOLONS.test(raw) : CHAIN.test(raw);
      if (splits) {
        return {
          ...so,
          current: [],
          done: [...so.done, { piped: PIPE.test(raw), words: so.current }],
        };
      }
      return {
        ...so,
        current: [...so.current, wordAt(raw, match.index)],
        testing: raw === "[[" || (so.testing && raw !== "]]"),
      };
    },
    { current: [], done: [], ended: false, testing: false }
  );
  return [...read.done, { piped: false, words: read.current }];
}

/**
 * Leave the redirects out of some words.
 * @param words - The words of one piece
 * @returns The words a program is handed: every redirect is gone, and so is
 *   the word after an operator that has nothing written against it
 */
export function withoutRedirects(words: readonly Word[]): readonly Word[] {
  return words.filter((word, index) => {
    if (REDIRECT.test(word.raw)) return false;
    const before = index === 0 ? undefined : words[index - 1];
    return before === undefined || REDIRECT.exec(before.raw)?.[1] !== "";
  });
}
