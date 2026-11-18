/**
 * Splitting a shell hook into words the way a shell does, for the reader
 * that decides whether lines added to the hook are reached
 * (`./carrier-hook-reach.ts`).
 *
 * This is the part that follows quoting: single quotes, double quotes,
 * backslashes and comments, so that an `exit` inside a message is not taken
 * for a command. It is not a shell, and it is written to be wrong in one
 * direction only. Where a text can be read in more than one way it either
 * reads it the way that hides nothing, or leaves a mark the reader refuses
 * on: a quote nothing closes (a `stray` token), or a word shells read in two
 * ways ({@link TWO_WAYS}).
 * @module controls/carrier-hook-words
 */

/** The older spelling of a command substitution's delimiter. */
const TICK = "`";

/** How many command substitutions inside one another are followed. */
const SUBSTITUTION_DEPTH = 3;

/** A quoted span: nothing inside single quotes is special. */
const SINGLE_QUOTED = String.raw`'[^']*'`;

/**
 * A double-quoted span read without looking inside it: a backslash escapes,
 * and the next double quote ends it. Right whenever no command substitution
 * inside it holds a quote of its own.
 */
const DOUBLE_QUOTED_FLAT = String.raw`"(?:[^"\\]|\\[\s\S])*"`;

/**
 * A double-quoted span that holds no command substitution at all, and no
 * backtick, so nothing inside it can open a quote of its own.
 */
const DOUBLE_QUOTED_PLAIN = String.raw`"(?:[^"\\$${TICK}]|\\[\s\S]|\$(?!\())*"`;

/**
 * A double-quoted span whose command substitutions are followed.
 *
 * Inside `$( )` quoting starts again, so a double quote there does not end
 * the span around it. A substitution is followed only where reading it
 * leaves no doubt: written on one line, and holding no parenthesis of its
 * own, comment, backtick, here-document or `$'` quote. Each level is built
 * from the one below it, and every choice in it starts with a different
 * character, so a text is read one way or not at all.
 * @param depth - How many substitutions inside one another to follow
 * @returns The pattern
 */
function doubleQuoted(depth: number): string {
  const levels = Array.from({ length: depth }).reduce<{
    readonly quoted: string;
    readonly substitution: string | null;
  }>(
    below => {
      const inner = [
        String.raw`[^\n()'"\\#$<${TICK}]`,
        String.raw`<(?!<)`,
        String.raw`\\[^\n]`,
        String.raw`\$(?!['(])`,
        String.raw`'[^'\n]*'`,
        below.quoted,
        ...(below.substitution === null ? [] : [below.substitution]),
      ].join("|");
      const substitution = String.raw`\$\((?:${inner})*\)`;
      return {
        quoted: String.raw`"(?:[^"\\$${TICK}]|\\[\s\S]|\$(?!\()|${substitution})*"`,
        substitution,
      };
    },
    { quoted: DOUBLE_QUOTED_PLAIN, substitution: null }
  );
  return levels.quoted;
}

/**
 * A double-quoted span: with its substitutions followed where that can be
 * done for certain, and read without looking inside it otherwise.
 */
const DOUBLE_QUOTED = `(?:${doubleQuoted(SUBSTITUTION_DEPTH)}|${DOUBLE_QUOTED_FLAT})`;

/** One step of a word: `>&` and `<&` belong to a redirection. */
const WORD_PART = String.raw`[<>]&|[^\s'"\\;&|()${TICK}]|\\[^\n]|${SINGLE_QUOTED}|${DOUBLE_QUOTED}`;

/** A word. A `#` starts a comment only where a word would start. */
const WORD = String.raw`(?!#)(?:${WORD_PART})+`;

/**
 * One token of a script, in the order they are tried: a line continued onto
 * the next, a line break, a gap, a place where shell joins two commands, a
 * word, a comment, and last a quote or backslash that nothing closes.
 *
 * A character none of these takes in is in no token: a blank other than a
 * space or a tab outside quotes and comments. The reader checks for that.
 */
export const TOKEN = new RegExp(
  [
    String.raw`(?<continued>\\\n)`,
    String.raw`(?<newline>\n)`,
    String.raw`(?<gap>[ \t\r]+)`,
    String.raw`(?<operator>&&|\|\||;;|;|\||&|\(|\)|${TICK})`,
    `(?<word>${WORD})`,
    String.raw`(?<comment>#[^\n]*)`,
    String.raw`(?<stray>['"\\])`,
  ].join("|"),
  "gu"
);

/**
 * A quoted span or an escaped character inside a word: what is in single
 * quotes, a whole double-quoted span with its quotes, or the character a
 * backslash escapes.
 */
export const QUOTED = new RegExp(
  String.raw`'([^']*)'|(${DOUBLE_QUOTED})|\\([^\n])`,
  "gu"
);

/**
 * Put in front of a word that shells read in two ways, so that it is no
 * command and no status the reader knows. A character no hook holds.
 */
export const TWO_WAYS = "\u0000";

/**
 * Tell whether a word holds a dollar sign directly in front of a quote.
 *
 * Shells do not agree on what that is. In bash, ksh and zsh `$'exit'` and
 * `$"exit"` are the word `exit`, and `$''exit` is too; in dash each is a
 * dollar sign followed by a quoted text. So what such a word is cannot be
 * told from the hook's text.
 * @param raw - The word as it is written
 * @returns Whether the word is read differently by different shells
 */
function readTwoWays(raw: string): boolean {
  return raw
    .replaceAll(
      QUOTED,
      (_all, _single, _double, escaped: string | undefined) =>
        escaped === undefined ? TWO_WAYS : "x"
    )
    .includes(`$${TWO_WAYS}`);
}

/**
 * Take the quotes off a word.
 * @param raw - The word as it is written
 * @returns The word as the shell would hand it to a program, with what a
 *   substitution inside double quotes holds left as it is written. A word
 *   shells read in two ways has {@link TWO_WAYS} in front.
 */
export function unquoted(raw: string): string {
  const word = raw.replaceAll(
    QUOTED,
    (
      _all,
      single: string | undefined,
      double: string | undefined,
      escaped: string | undefined
    ) =>
      single ??
      double?.slice(1, -1).replaceAll(/\\([\s\S])/gu, "$1") ??
      escaped ??
      ""
  );
  return readTwoWays(raw) ? `${TWO_WAYS}${word}` : word;
}
