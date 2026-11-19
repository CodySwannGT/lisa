/**
 * Telling whether lines added at a place in a shell hook are sure to be
 * reached, and sure to decide how the hook ends.
 *
 * The call to a carrier is added at the end of a hook the repository owns. A
 * hook that leaves before its end takes the added lines with it: nothing
 * would run, every commit would pass, and the result would still say the
 * point is wired. So every line above the place is read, and the place is
 * refused when one of them can end the hook with success:
 *
 * - `exec <program>`: the shell is replaced, so nothing after it runs. An
 *   `exec` that only redirects (`exec < /dev/tty`, `exec 3>&1`) replaces
 *   nothing and is accepted.
 * - an `exit` that could leave with success. Two kinds cannot, and are
 *   accepted wherever they stand, inside an `if` included:
 *   - one with a written non-zero status (`exit 1`). Every way it leaves
 *     fails the hook, so git stops the commit itself.
 *   - the last part of `|| exit` with no status or with `$?` (`|| exit`,
 *     `|| exit $?`). It leaves only after a command failed, with that
 *     command's status.
 *
 *   Every other `exit` is refused: `exit 0`, one whose status is a variable,
 *   and one with no status or `$?` anywhere else, such as inside an `if`.
 *   That last one may be safe, but proving it means following the shell's
 *   control flow, and a wrong proof here is a commit that passes unchecked.
 *   Refusing costs a person one paste; the result carries the lines to add
 *   by hand.
 * - a `return`, judged exactly as an `exit` is. Outside every function a
 *   `return` ends a script run by dash, ksh or zsh (bash reports it and
 *   carries on), so `[ -n "$RUN_ALL" ] || return 0` leaves such a hook with
 *   success. One inside a function ends only that function, and is
 *   refused as well: where a function starts and ends is not followed, and
 *   telling a function's body from a `case` branch that opens with `{`
 *   takes more than the words of one command. An `exit` there is refused
 *   for its own reason: calling the function ends the hook. What a person
 *   is told about a refused `return` says both, since which of the two
 *   places it stands in is not known.
 * - a `trap` that can turn a failure into success once the hook is over.
 *   What a trap on `EXIT` (or `0`) runs is run after the added lines have
 *   failed, and an `exit 0` in it is the status git sees. So such a trap is
 *   refused when what it runs holds anything this list refuses, or cannot
 *   be read. The same holds for the conditions a shell raises itself: `ERR`
 *   and `ZERR` (after a command failed), `DEBUG` (before each command) and
 *   `RETURN`. A trap on a signal (`INT`, `TERM`, a number) is accepted: it
 *   runs when the hook is interrupted, not when it ends.
 *
 * One of these words with something the shell works out written into it
 * (`exit$1`, `$1exit`, `ex${x}it`) is taken for that word and refused: it is
 * the word itself whenever what the shell works out holds nothing.
 *
 * ## What is read, and what is not
 *
 * This is not a shell. It reads words the way a shell splits them: quotes,
 * backslashes, comments and here-documents are followed, so `npm exec`, an
 * `exit` inside a quoted message and the body of a here-document are not
 * mistaken for commands. A command substitution inside double quotes is
 * followed when it is written on one line, with its own quotes, so the
 * double quote in `"$(sed 's/"//g' file)"` does not end the outer quote; and
 * `<<` is not taken for a here-document inside `$(( ))` written on one line
 * or on a comment line.
 *
 * It does not follow a file the hook reads in (`.`), `eval`, a function
 * called later, a trap whose action is held in a variable, or a command
 * whose name a command substitution works out or completes (`$(printf exit)`,
 * `ex$(true)it`); a hook that leaves through one of those is not caught.
 *
 * Text it cannot place is refused as not read, naming the line it lost
 * track on:
 *
 * - a quote, a here-document or a parenthesis that is still open where the
 *   lines would go (the added lines would then be data, or run in a shell of
 *   their own, and not decide how the hook ends);
 * - a dollar sign directly in front of a quote, where the hook's text does
 *   not say what the word is: `$'it\'s'` is a quote left open to dash and a
 *   finished one to bash, and `$'exit' 0` is `exit 0` to bash, ksh and zsh
 *   and a program called `$exit` to dash. That is refused where the word
 *   names the command, or is given to `exit`, `return`, `exec` or `trap`. As
 *   a value (`IFS=$'\n'`) or an argument of another command it is accepted;
 * - a `<<` it cannot be sure about: inside a quote or after a `#` further
 *   along a line, with no closing word on its line, or with a closing word
 *   of nothing. Read as a here-document it would blank out the lines under
 *   it, an `exit 0` among them; read as text it would take a here-document's
 *   body for commands. Neither is guessed.
 * - a character no rule here takes in: a blank other than a space or a tab
 *   outside quotes and comments (a form feed, a no-break space), which a
 *   shell takes for part of a word.
 * @module controls/carrier-hook-reach
 */
import { withoutHereDocuments } from "./carrier-hook-here-documents.js";
import { TOKEN, TWO_WAYS, unquoted } from "./carrier-hook-words.js";

/** Why lines added at a place might never run, or might not be heeded. */
export interface EarlyLeave {
  /** The line that can end the hook, counted from 1. */
  readonly line: number;
  /**
   * What is on it: an `exec` of a program, an `exit` or a `return` that can
   * leave with success, a `trap` that can turn a failure into success, or
   * `unread` for text the reader lost track on.
   */
  readonly word: EndingWord | "unread";
}

/** A word that can end a hook, or change how it ends. */
type EndingWord = "exec" | "exit" | "return" | "trap";

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
  /**
   * The lines of the parentheses that are open, the outermost first. A `)`
   * with none open is the end of a `case` pattern, and closes nothing.
   */
  readonly groups: readonly number[];
}

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

/** A signal a trap can name: a number that is not zero, or a name. */
const SIGNAL = /^(?:0*[1-9]\d*|(?:SIG)?[A-Z][A-Z0-9+-]*)$/iu;

/**
 * What a trap can name that is not a signal: the end of the hook, and the
 * conditions bash, ksh and zsh raise themselves while it runs.
 */
const SHELL_CONDITION = /^(?:SIG)?(?:EXIT|ERR|ZERR|DEBUG|RETURN)$/iu;

/**
 * Something the shell works out, written inside a word: `${code}`, `$code`,
 * `$1`, `$?`, and the dollar sign a word ends on when `$( )` follows it.
 * Whatever it works out to may be nothing at all.
 */
const WORKED_OUT = /\$(?:\{[^}]*\}|[A-Za-z_]\w*|[\d@*#?$!-]|$)/gu;

/** The first operand of a `trap` that sets nothing: it resets or lists. */
const NO_ACTION = /^(?:-|\d+)?$/u;

/**
 * Tell whether a word is one that can end a hook, or change how it ends.
 * @param word - The word, when there is one
 * @returns Whether it is `exec`, `exit`, `return` or `trap`
 */
function isEndingWord(word: string | undefined): word is EndingWord {
  return (
    word === "exec" || word === "exit" || word === "return" || word === "trap"
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
  if (operator === "(") {
    return { ...closed(so, operator), groups: [...so.groups, so.line] };
  }
  if (operator === ")") {
    return { ...closed(so, operator), groups: so.groups.slice(0, -1) };
  }
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
  // A setting is one whatever its value is, `IFS=$'\n'` included.
  const from = words.findIndex(
    word => !PREFIXES.has(word) && !ASSIGNMENT.test(word.replace(TWO_WAYS, ""))
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
 * Tell whether an `exit` or a `return` can only leave with a failure.
 *
 * A written non-zero status fails the hook wherever the word stands, so git
 * stops the commit itself and nothing passes unchecked. With no status, or
 * with `$?`, it carries the last status, which is a failure only as the last
 * part of `|| exit`.
 * @param piece - The piece whose command is `exit` or `return`
 * @param args - The words after it
 * @returns Whether every way it leaves is a failure
 */
function leavesFailed(piece: Piece, args: readonly string[]): boolean {
  const [status, ...more] = args;
  if (more.length > 0) return false;
  if (status !== undefined && NON_ZERO.test(status)) return true;
  return piece.after === "||" && (status === undefined || status === "$?");
}

/**
 * Tell whether a `trap` can turn a failure into success.
 *
 * It can when it sets an action for the end of the hook, or for a condition
 * the shell raises itself, and that action holds something that leaves with
 * success or cannot be read. A condition that is not known to be a signal
 * (one held in a variable) is taken for the end of the hook.
 * @param args - The words after `trap`
 * @returns Whether lines added below it might not decide how the hook ends
 */
function trapTakesOver(args: readonly string[]): boolean {
  const [action, ...conditions] = args[0] === "--" ? args.slice(1) : args;
  if (action === undefined || NO_ACTION.test(action)) return false;
  const whenItEnds = conditions.some(
    condition => SHELL_CONDITION.test(condition) || !SIGNAL.test(condition)
  );
  return whenItEnds && leaves(action).length > 0;
}

/**
 * Say what a command is when its words cannot be taken at their word.
 *
 * A command whose name shells read in two ways may be any ending word in
 * one of them: `$'exit' 0` is `exit 0` to bash. `exit$1`, `$1exit` and
 * `ex${x}it` are the word `exit` whenever what the shell works out holds
 * nothing, so each is taken for it, with a status nothing is known about.
 * And what an ending word is given has to be known as well: `exit $'1'` is
 * `exit 1` to bash only.
 * @param name - The command's name
 * @param args - The words after it
 * @returns What it is refused as, or `null` when its words can be trusted
 */
function inDoubt(
  name: string,
  args: readonly string[]
): EarlyLeave["word"] | null {
  if (name.startsWith(TWO_WAYS)) return "unread";
  const bare = name.replaceAll(WORKED_OUT, "");
  if (bare !== name && isEndingWord(bare)) return bare;
  return isEndingWord(name) && args.some(arg => arg.startsWith(TWO_WAYS))
    ? name
    : null;
}

/**
 * Say whether a command whose words can be trusted ends the script with
 * success, or undoes a failure.
 * @param piece - The command
 * @param name - Its name
 * @param args - The words after its name
 * @returns The word it does so with, or `null`
 */
function ending(
  piece: Piece,
  name: string,
  args: readonly string[]
): EndingWord | null {
  if (name === "exec") return replacesShell(args) ? name : null;
  if (name === "exit" || name === "return") {
    return leavesFailed(piece, args) ? null : name;
  }
  return name === "trap" && trapTakesOver(args) ? name : null;
}

/**
 * Say whether one command can end the script with success.
 * @param piece - The command
 * @returns Where and how, or nothing
 */
function leaveOf(piece: Piece): readonly EarlyLeave[] {
  const [name = "", ...args] = command(piece.words);
  const word = inDoubt(name, args) ?? ending(piece, name, args);
  return word === null ? [] : [{ line: piece.line, word }];
}

/**
 * Find every line of a script that can end it with success, and every place
 * the script could not be read.
 * @param text - The script
 * @returns The lines and what is on each, in no particular order
 */
function leaves(text: string): readonly EarlyLeave[] {
  const blanked = withoutHereDocuments(text);
  const source = blanked.lines.join("\n");
  const tokens = [...source.matchAll(TOKEN)];
  const reading = closed(
    tokens.reduce<Reading>(taken, {
      after: "",
      groups: [],
      line: 1,
      openAt: null,
      pieces: [],
      start: 1,
      words: [],
    }),
    ""
  );
  // Every character has to be in a token. One that is in none was passed
  // over, and what was passed over was not read: a blank that is neither a
  // space nor a tab, which a shell takes for part of a word.
  const read = tokens.reduce(
    (upTo, token) => (token.index === upTo ? upTo + token[0].length : upTo),
    0
  );
  const unread: readonly number[] = [
    ...(reading.openAt === null ? [] : [reading.openAt]),
    // Lines added inside a parenthesis that is still open would run in a
    // shell of their own, or not at all.
    ...reading.groups.slice(0, 1),
    ...(blanked.doubt === null ? [] : [blanked.doubt]),
    ...(read === source.length
      ? []
      : [source.slice(0, read).split("\n").length]),
    ...blanked.closers.slice(0, 1).map(open => open.line),
  ];
  return [
    ...reading.pieces.flatMap(leaveOf),
    ...unread.map(line => ({ line, word: "unread" as const })),
  ];
}

/**
 * Find the first line of a script that can end it before its last line, or
 * undo what its last lines decide.
 * @param text - The script, up to the place lines are added
 * @returns The line and what is on it, or `null` when lines added after the
 *   text are reached whenever everything in it passed, and their failure is
 *   the hook's
 */
export function earlyLeave(text: string): EarlyLeave | null {
  return (
    [...leaves(text)].sort((one, other) => one.line - other.line)[0] ?? null
  );
}
