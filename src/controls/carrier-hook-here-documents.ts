/**
 * Setting the bodies of a shell hook's here-documents aside, for the reader
 * that decides whether lines added to the hook are reached
 * (`./carrier-hook-reach.ts`).
 *
 * The body of a here-document is data. Read as commands, an `exit 0` in a
 * message would look like a way out of the hook, and a lone quote in it
 * would throw off every quote after it. So the bodies are blanked out
 * before the hook is split into words, and the line count is kept.
 *
 * That makes this pass run before quotes are followed, and so it has to be
 * careful about `<<`. Taking one for a here-document that is not one blanks
 * out the lines under it, a real `exit 0` among them. Not taking one that is
 * reads its body as commands. Where a line leaves that open the line is
 * reported as in doubt, and the reader refuses the hook as not read.
 * @module controls/carrier-hook-here-documents
 */
import { QUOTED, TOKEN } from "./carrier-hook-words.js";

/** One here-document that has been opened. */
export interface HereDocument {
  /** The line that closes it. */
  readonly closer: string;
  /** Whether tabs in front of that line are ignored (`<<-`). */
  readonly tabs: boolean;
  /** The line that opened it, counted from 1. */
  readonly line: number;
}

/** A script with the bodies of its here-documents blanked out. */
export interface Blanked {
  /** The lines, a here-document's body replaced by empty lines. */
  readonly lines: readonly string[];
  /** The here-documents still open, the one being read first. */
  readonly closers: readonly HereDocument[];
  /**
   * The first line with a `<<` that cannot be told from one that opens a
   * here-document, or whose here-document cannot be followed; `null` when
   * there is none.
   */
  readonly doubt: number | null;
}

/** The word that opens a here-document, and the word that closes it. */
const HERE_DOCUMENT = new RegExp(
  String.raw`(?<!<)<<(?!<)(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([^\s;&|<>()'"]+))`,
  "gu"
);

/** The two signs that open a here-document, with or without its word. */
const HERE_OPERATOR = /(?<!<)<<(?!<)/gu;

/**
 * Arithmetic written on one line, with at most one pair of parentheses
 * inside another. A `<<` in it shifts a number and opens nothing.
 */
const ARITHMETIC = /\$\(\((?:[^()\n]|\([^()\n]*\))*\)\)/gu;

/** A line that is a comment from its first character on. */
const COMMENT_LINE = /^[ \t]*#/u;

/**
 * Where the quoted spans and the comment of one line are, read as if the
 * line stood alone.
 * @param line - The line
 * @returns Where each starts and ends
 */
function quotedOrComment(
  line: string
): ReadonlyArray<readonly [number, number]> {
  return [...line.matchAll(TOKEN)].flatMap(token => {
    const { comment, word } = token.groups ?? {};
    if (comment !== undefined) {
      return [[token.index, token.index + comment.length] as const];
    }
    return [...(word ?? "").matchAll(QUOTED)]
      .filter(quoted => quoted[3] === undefined)
      .map(
        quoted =>
          [
            token.index + quoted.index,
            token.index + quoted.index + quoted[0].length,
          ] as const
      );
  });
}

/**
 * The here-documents one line opens.
 *
 * A `<<` on a comment line or inside arithmetic opens none. One inside a
 * quote or after a `#` further along the line most likely opens none
 * either, but a line is read here before the quotes around it are, so that
 * is not certain. It is neither taken for a here-document nor passed over:
 * the line is reported.
 *
 * The same holds for a `<<` with no closing word that can be made out on
 * the line (it ends the line, or its closing word is a quote that runs on
 * to the next line), and for a closing word of nothing, which the first
 * empty line closes wherever that is.
 * @param line - The line
 * @param number - Its number, counted from 1
 * @returns The here-documents, and whether one of them is in doubt
 */
function openedBy(
  line: string,
  number: number
): { readonly opened: readonly HereDocument[]; readonly doubt: boolean } {
  if (COMMENT_LINE.test(line)) return { doubt: false, opened: [] };
  const plain = line.replaceAll(ARITHMETIC, found => " ".repeat(found.length));
  const spans = quotedOrComment(plain);
  const matches = [...plain.matchAll(HERE_DOCUMENT)];
  const opened = matches.map(match => ({
    closer: match[2] ?? match[3] ?? match[4] ?? "",
    line: number,
    tabs: match[1] === "-",
  }));
  const inDoubt = matches.some(match =>
    spans.some(([from, to]) => from < match.index && match.index < to)
  );
  return {
    doubt:
      inDoubt ||
      opened.some(each => each.closer === "") ||
      [...plain.matchAll(HERE_OPERATOR)].length > matches.length,
    opened,
  };
}

/**
 * Blank out the body of every here-document, keeping the line count.
 * @param text - The script
 * @returns Its lines, the here-documents nothing closed, and the first line
 *   it could not tell a here-document on
 */
export function withoutHereDocuments(text: string): Blanked {
  return text.split("\n").reduce<Blanked>(
    (so, line, index) => {
      const [open, ...later] = so.closers;
      if (open !== undefined) {
        const body = open.tabs ? line.replace(/^\t+/u, "") : line;
        return {
          ...so,
          closers: body === open.closer ? later : so.closers,
          lines: [...so.lines, ""],
        };
      }
      const { doubt, opened } = openedBy(line, index + 1);
      return {
        closers: opened,
        doubt: so.doubt ?? (doubt ? index + 1 : null),
        lines: [...so.lines, line],
      };
    },
    { closers: [], doubt: null, lines: [] }
  );
}
