/**
 * Telling whether lines added at a place in a shell hook are sure to be
 * reached.
 *
 * The call to a carrier is added at the end of a hook the repository owns. A
 * hook that leaves before its end takes the added lines with it: nothing
 * would run, every commit would pass, and the result would still say the
 * point is wired. So every line above the place is read, and the place is
 * refused when one of them can end the hook there:
 *
 * - `exec <program>`: the shell is replaced, so nothing after it runs. An
 *   `exec` that only redirects (`exec < /dev/tty`, `exec 3>&1`) replaces
 *   nothing and is accepted.
 * - any `exit`, with one exception: the last part of `|| exit <non-zero>`
 *   (`|| exit 1`, `|| exit $?`, `|| exit`). That one leaves only after a
 *   command failed and leaves with a failure, which is what the added lines
 *   do themselves when the hook above them failed.
 *
 * An `exit 1` inside an `if` is refused too. It would be safe, but proving
 * which exits are safe means following the shell's control flow, and a wrong
 * proof here is a commit that passes unchecked. Refusing costs a person one
 * paste; the result carries the lines to add by hand.
 *
 * ## What is read, and what is not
 *
 * This is not a shell. It reads words the way a shell splits them: quotes,
 * backslashes, comments and here-documents are followed, so `npm exec`, an
 * `exit` inside a quoted message and the body of a here-document are not
 * mistaken for commands. It does not follow a file the hook reads in (`.`),
 * `eval`, or a function called later; a hook that leaves through one of
 * those is not caught. Text it cannot place (a quote or a here-document
 * still open where the lines would go) is refused, because the added lines
 * would then be data and not commands.
 * @module controls/carrier-hook-reach
 */

/** Why lines added at a place might never run. */
export interface EarlyLeave {
  /** The line that can end the hook, counted from 1. */
  readonly line: number;
  /**
   * What is on it: an `exec` of a program, an `exit`, or `open` for a quote
   * or a here-document that is not closed above the place.
   */
  readonly word: "exec" | "exit" | "open";
}

/** One command of a script, split the way a shell splits it. */
interface Piece {
  /** What joins it to the command before: `||`, another operator, or none. */
  readonly after: string;
  /** Its words, quotes taken off. */
  readonly words: readonly string[];
  /** The line its first word is on, counted from 1. */
  readonly line: number;
}

/** A script read so far. */
interface Reading {
  /** The commands that are complete. */
  readonly pieces: readonly Piece[];
  /** The words of the command being read. */
  readonly words: readonly string[];
  /** What joins the command being read to the one before. */
  readonly after: string;
  /** The line being read, counted from 1. */
  readonly line: number;
  /** The line the command being read starts on. */
  readonly start: number;
  /** The first line a quote was left open on, or `null`. */
  readonly openAt: number | null;
}

/** One here-document that has been opened. */
interface HereDocument {
  /** The line that closes it. */
  readonly closer: string;
  /** Whether tabs in front of that line are ignored (`<<-`). */
  readonly tabs: boolean;
}

/** A script with the bodies of its here-documents blanked out. */
interface Blanked {
  /** The lines, a here-document's body replaced by empty lines. */
  readonly lines: readonly string[];
  /** The here-documents still open, the one being read first. */
  readonly closers: readonly HereDocument[];
}

/** The older spelling of a command substitution's delimiter. */
const TICK = "`";

/** A quoted span: nothing inside single quotes is special. */
const SINGLE_QUOTED = String.raw`'[^']*'`;

/** A quoted span in which a backslash still escapes. */
const DOUBLE_QUOTED = String.raw`"(?:[^"\\]|\\[\s\S])*"`;

/** One step of a word: `>&` and `<&` belong to a redirection. */
const WORD_PART = String.raw`[<>]&|[^\s'"\\;&|()${TICK}]|\\[^\n]|${SINGLE_QUOTED}|${DOUBLE_QUOTED}`;

/** A word. A `#` starts a comment only where a word would start. */
const WORD = String.raw`(?!#)(?:${WORD_PART})+`;

/**
 * One token of a script, in the order they are tried: a line continued onto
 * the next, a line break, a gap, a place where shell joins two commands, a
 * word, a comment, and last a quote or backslash that nothing closes.
 */
const TOKEN = new RegExp(
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

/** A quoted span or an escaped character inside a word. */
const QUOTED = new RegExp(
  String.raw`'([^']*)'|"((?:[^"\\]|\\[\s\S])*)"|\\([^\n])`,
  "gu"
);

/** The word that opens a here-document, and the word that closes it. */
const HERE_DOCUMENT = new RegExp(
  String.raw`(?<!<)<<(?!<)(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([^\s;&|<>()'"]+))`,
  "gu"
);

/** Words that stand in front of a command without being one. */
const PREFIXES = new Set([
  "!",
  "{",
  "if",
  "then",
  "elif",
  "else",
  "do",
  "while",
  "until",
  "time",
  "command",
  "builtin",
]);

/** A setting written in front of a command, such as `CI=1`. */
const ASSIGNMENT = /^[A-Za-z_]\w*=/u;

/** A redirection: `<`, `>`, `>>`, `2>&1`, `3<>file` and the like. */
const REDIRECTION = /^\d*(?:>>|<>|>\||[<>]&?)(.*)$/u;

/** The statuses an `exit` can be given that are never success. */
const NON_ZERO = /^(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-5])$/u;

/**
 * Blank out the body of every here-document, keeping the line count.
 * @param text - The script
 * @returns Its lines, and the here-documents nothing closed
 */
function withoutHereDocuments(text: string): Blanked {
  return text.split("\n").reduce<Blanked>(
    (so, line) => {
      const [open, ...later] = so.closers;
      if (open !== undefined) {
        const body = open.tabs ? line.replace(/^\t+/u, "") : line;
        return {
          closers: body === open.closer ? later : so.closers,
          lines: [...so.lines, ""],
        };
      }
      const opened = [...line.matchAll(HERE_DOCUMENT)].map(match => ({
        closer: match[2] ?? match[3] ?? match[4] ?? "",
        tabs: match[1] === "-",
      }));
      return { closers: opened, lines: [...so.lines, line] };
    },
    { closers: [], lines: [] }
  );
}

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
    ) => single ?? double?.replaceAll(/\\([\s\S])/gu, "$1") ?? escaped ?? ""
  );
}

/**
 * Close the command being read.
 * @param so - The script read so far
 * @param after - What joins the next command to this one
 * @returns The reading with the command added, when it has any word
 */
function closed(so: Reading, after: string): Reading {
  return {
    ...so,
    after,
    pieces:
      so.words.length === 0
        ? so.pieces
        : [...so.pieces, { after: so.after, line: so.start, words: so.words }],
    words: [],
  };
}

/**
 * Read one more token of a script.
 * @param so - The script read so far
 * @param match - The token
 * @returns The reading with the token taken in
 */
function taken(so: Reading, match: RegExpMatchArray): Reading {
  const { continued, newline, operator, stray, word } = match.groups ?? {};
  if (continued !== undefined) return { ...so, line: so.line + 1 };
  if (newline !== undefined) return { ...closed(so, ""), line: so.line + 1 };
  if (operator !== undefined) return closed(so, operator);
  if (stray !== undefined) return { ...so, openAt: so.openAt ?? so.line };
  if (word === undefined) return so;
  return {
    ...so,
    line: so.line + word.split("\n").length - 1,
    start: so.words.length === 0 ? so.line : so.start,
    words: [...so.words, unquoted(word)],
  };
}

/**
 * The words of a command after the ones shell lets stand in front of it.
 * @param words - The words of one piece
 * @returns The command and its arguments; empty when there is no command
 */
function command(words: readonly string[]): readonly string[] {
  const from = words.findIndex(
    word => !PREFIXES.has(word) && !ASSIGNMENT.test(word)
  );
  return from === -1 ? [] : words.slice(from);
}

/**
 * Tell whether an `exec` hands over to a program.
 * @param args - The words after `exec`
 * @returns Whether anything is left once its redirections are set aside
 */
function replacesShell(args: readonly string[]): boolean {
  const left = args.reduce<{ readonly skip: boolean; readonly kept: number }>(
    (so, arg) => {
      if (so.skip) return { kept: so.kept, skip: false };
      const match = REDIRECTION.exec(arg);
      if (match === null) return { kept: so.kept + 1, skip: false };
      // `< file` is two words: the file is the redirection's, not a program.
      return { kept: so.kept, skip: match[1] === "" };
    },
    { kept: 0, skip: false }
  );
  return left.kept > 0;
}

/**
 * Tell whether an `exit` leaves only after a failure, with a failure.
 * @param piece - The piece whose command is `exit`
 * @param args - The words after `exit`
 * @returns Whether it is the last part of `|| exit <non-zero>`
 */
function leavesFailed(piece: Piece, args: readonly string[]): boolean {
  const [status, ...more] = args;
  return (
    piece.after === "||" &&
    more.length === 0 &&
    (status === undefined || status === "$?" || NON_ZERO.test(status))
  );
}

/**
 * Say whether one command can end the script.
 * @param piece - The command
 * @returns Where and how, or nothing
 */
function leaveOf(piece: Piece): readonly EarlyLeave[] {
  const [name, ...args] = command(piece.words);
  if (name === "exec" && replacesShell(args)) {
    return [{ line: piece.line, word: "exec" }];
  }
  return name === "exit" && !leavesFailed(piece, args)
    ? [{ line: piece.line, word: "exit" }]
    : [];
}

/**
 * Find the first line of a script that can end it before its last line.
 * @param text - The script, up to the place lines are added
 * @returns The line and what is on it, or `null` when lines added after the
 *   text are reached whenever everything in it passed
 */
export function earlyLeave(text: string): EarlyLeave | null {
  const blanked = withoutHereDocuments(text);
  const reading = closed(
    [...blanked.lines.join("\n").matchAll(TOKEN)].reduce<Reading>(taken, {
      after: "",
      line: 1,
      openAt: null,
      pieces: [],
      start: 1,
      words: [],
    }),
    ""
  );
  const open: readonly number[] = [
    ...(reading.openAt === null ? [] : [reading.openAt]),
    ...(blanked.closers.length === 0 ? [] : [blanked.lines.length]),
  ];
  const leaves: readonly EarlyLeave[] = [
    ...reading.pieces.flatMap(leaveOf),
    ...open.map(line => ({ line, word: "open" as const })),
  ];
  return [...leaves].sort((one, other) => one.line - other.line)[0] ?? null;
}
