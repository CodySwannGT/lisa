/**
 * Putting one value into JSON text, or taking one out, without changing
 * another byte of it.
 *
 * A settings file a coding agent reads belongs to the repository. Adding an
 * entry to it must leave everything the repository wrote exactly as it was:
 * a neighbouring entry written on one line stays on one line. A JSON editor
 * that formats what it writes does not hold that. It formats whole lines,
 * so an entry added to a line reflows whatever else is on it, and one such
 * editor loses a bracket taking the last entry out of a list written on one
 * line. So the two edits this needs are made here by position: the text is
 * parsed only to find where a value starts and ends, and the new text is
 * spliced in between.
 *
 * What is added is written in the style of the place it goes to:
 *
 * - after a value that ends its line, on a line of its own, indented like
 *   that line, and spread over lines in the file's own indentation;
 * - after a value that shares its line with what follows, on that same
 *   line, written on one line;
 * - into a list or an object that is empty, spread over lines when the
 *   brackets stand at the end of their line, on one line otherwise.
 *
 * ## Comments
 *
 * A comment is the repository's, and none is removed or moved:
 *
 * - What is added goes after everything the repository wrote in the list,
 *   so after a comment that follows the last value, on its line or under
 *   it. The comma the new value needs is written directly after the value
 *   before it, in front of such a comment.
 * - What is taken out is the item and one comma. A comment between the item
 *   and a neighbour stays where it is.
 *
 * What does change beside the item is whitespace that only the item needed:
 * the line it stood alone on goes with it, and where it shared a line, the
 * blanks on one side of it.
 *
 * The caller checks that the new text means what it should before using it.
 * @module controls/carrier-json-place
 */
import {
  findNodeAtLocation,
  parseTree,
  type JSONPath,
  type Node,
} from "jsonc-parser";

import { isJsonObject } from "../sync/json-path.js";

/** A comment that runs to the end of its line, the line break left out. */
const LINE_COMMENT = String.raw`//[^\r\n]*`;

/** A comment between two marks, up to the first mark that closes it. */
const BLOCK_COMMENT = String.raw`/\*(?:[^*]|\*(?!/))*\*/`;

/**
 * A comment or a comma, for reading text that holds nothing else but
 * whitespace. A comma written inside a comment is part of the comment.
 */
const COMMENT_OR_COMMA = new RegExp(`${LINE_COMMENT}|${BLOCK_COMMENT}|,`, "gu");

/**
 * Whitespace and comments, then a comma. A line comment has to reach the end
 * of its line, so that the comma found is never one written inside it.
 */
const UP_TO_COMMA = new RegExp(
  String.raw`^(?:[ \t\r\n]+|${LINE_COMMENT}(?=[\r\n]|$)|${BLOCK_COMMENT})*,`,
  "u"
);

/** How a file is written, so that what is added is written the same way. */
interface Style {
  /** One step of indentation. */
  readonly unit: string;
  /** The line break. */
  readonly eol: string;
}

/**
 * Tell whether nothing else of the file follows a value on its line: only a
 * comma, a comment, or nothing at all.
 * @param rest - What is left of the line after the value
 * @returns Whether a value added after it belongs on a line of its own
 */
function endsItsLine(rest: string): boolean {
  const left = rest.trim();
  const afterComma = left.startsWith(",") ? left.slice(1).trimStart() : left;
  return afterComma === "" || afterComma.startsWith("//");
}

/**
 * Read how a file is written.
 * @param text - The file's content
 * @returns Its indentation step and its line break
 */
function styleOf(text: string): Style {
  return {
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    unit: /^([ \t]+)\S/mu.exec(text)?.[1] ?? "  ",
  };
}

/**
 * Parse text to find where its values are.
 * @param text - The file's content
 * @returns The root value, or `undefined` when there is none
 */
function treeOf(text: string): Node | undefined {
  return parseTree(text, [], { allowTrailingComma: true });
}

/**
 * The whitespace a line starts with.
 * @param text - The file's content
 * @param offset - A place on the line
 * @returns The line's indentation
 */
function indentationAt(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/u.exec(text.slice(start))?.[0] ?? "";
}

/**
 * What is left of a line after a place on it.
 * @param text - The file's content
 * @param offset - The place
 * @returns The text up to the line break, without a carriage return
 */
function restOfLine(text: string, offset: number): string {
  const end = text.indexOf("\n", offset);
  return text.slice(offset, end === -1 ? text.length : end).replace(/\r$/u, "");
}

/**
 * Write a value on one line, the way a person writes a short one.
 * @param value - The value
 * @returns For example `{ "matcher": "Write", "hooks": [] }`
 */
function onOneLine(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${(value as readonly unknown[]).map(onOneLine).join(", ")}]`;
  }
  if (!isJsonObject(value)) return JSON.stringify(value);
  const members = Object.entries(value).map(
    ([key, member]) => `${JSON.stringify(key)}: ${onOneLine(member)}`
  );
  return members.length === 0 ? "{}" : `{ ${members.join(", ")} }`;
}

/**
 * Write a value over several lines, in a file's own indentation.
 * @param value - The value
 * @param indentation - The indentation of the line it starts on
 * @param style - How the file is written
 * @returns The value, every line after the first indented
 */
function overLines(value: unknown, indentation: string, style: Style): string {
  return JSON.stringify(value, null, style.unit)
    .split("\n")
    .join(`${style.eol}${indentation}`);
}

/**
 * Put text into a file at one place.
 * @param text - The file's content
 * @param from - Where the text goes
 * @param to - Where what it replaces ends; `from` when it replaces nothing
 * @param added - The text
 * @returns The new content
 */
function spliced(
  text: string,
  from: number,
  to: number,
  added: string
): string {
  return `${text.slice(0, from)}${added}${text.slice(to)}`;
}

/**
 * What follows the last value of a list or an object, up to the bracket
 * that closes it: nothing but whitespace, comments and at most one comma.
 */
interface Tail {
  /** Where its comma is, or `null` when it has none. */
  readonly comma: number | null;
  /**
   * Where the last thing the repository wrote in it ends: its last comment
   * or its comma, whichever is later. Where the tail starts when it has
   * neither.
   */
  readonly end: number;
}

/**
 * Read what stands between a place and the bracket that closes its list.
 *
 * Only whitespace, comments and a comma can stand there, so a comment is
 * told from a comma without reading strings: there are none.
 * @param text - The file's content
 * @param from - Where the last value ends, or where an empty list opens
 * @param close - Where the closing bracket is
 * @returns Where its comma is and where what the repository wrote ends
 */
function tailOf(text: string, from: number, close: number): Tail {
  const tokens = [...text.slice(from, close).matchAll(COMMENT_OR_COMMA)];
  const comma = tokens.find(token => token[0] === ",");
  const last = tokens.at(-1);
  return {
    comma: comma === undefined ? null : from + comma.index,
    end: last === undefined ? from : from + last.index + last[0].length,
  };
}

/**
 * Put the first member into a list or an object that holds nothing, not
 * even a comment.
 * @param text - The file's content
 * @param container - The list or the object
 * @param member - The member, written both ways
 * @param member.flat - Written on one line
 * @param member.spread - Spread over lines, one step inside the brackets
 * @returns The new content: spread over lines when the brackets stand at the
 *   end of their line, on one line otherwise
 */
function intoEmpty(
  text: string,
  container: Node,
  member: { readonly flat: string; readonly spread: string }
): string {
  const { eol, unit } = styleOf(text);
  const open = container.offset + 1;
  const close = container.offset + container.length - 1;
  const indentation = indentationAt(text, container.offset);
  return endsItsLine(restOfLine(text, close + 1))
    ? spliced(
        text,
        open,
        close,
        `${eol}${indentation}${unit}${member.spread}${eol}${indentation}`
      )
    : spliced(text, open, open, member.flat);
}

/**
 * Add a member to the end of a list or an object, after everything the
 * repository wrote in it.
 *
 * A comment that follows the last value stays where it is and the member
 * goes after it. The comma the member needs is written directly after the
 * value before it, which is the one place it cannot land inside a comment.
 * A list whose last value already has a comma after it keeps that habit:
 * the member is written with one too.
 * @param text - The file's content
 * @param container - The list or the object
 * @param label - What stands in front of the value: a key, or nothing
 * @param value - The value
 * @returns The new content
 */
function withMember(
  text: string,
  container: Node,
  label: string,
  value: unknown
): string {
  const style = styleOf(text);
  const last = container.children?.at(-1);
  const open = container.offset + 1;
  const close = container.offset + container.length - 1;
  const inner = `${indentationAt(text, container.offset)}${style.unit}`;
  if (last === undefined && text.slice(open, close).trim() === "") {
    return intoEmpty(text, container, {
      flat: `${label}${onOneLine(value)}`,
      spread: `${label}${overLines(value, inner, style)}`,
    });
  }
  // With no value yet, what the list holds is a comment of the repository's.
  const from = last === undefined ? open : last.offset + last.length;
  const tail = tailOf(text, from, close);
  const depth = last === undefined ? inner : indentationAt(text, from);
  const commas = {
    after: last !== undefined && tail.comma !== null ? "," : "",
    before: last !== undefined && tail.comma === null ? "," : "",
  };
  const member =
    restOfLine(text, tail.end).trim() === ""
      ? `${style.eol}${depth}${label}${overLines(value, depth, style)}`
      : ` ${label}${onOneLine(value)}`;
  return `${text.slice(0, from)}${commas.before}${text.slice(from, tail.end)}${member}${commas.after}${text.slice(tail.end)}`;
}

/**
 * Add a value to the end of a list, creating the list and the keys that lead
 * to it when the file does not have them.
 * @param text - The file's content: an object
 * @param path - The keys that lead to the list
 * @param value - The value to add
 * @returns The new content, or `null` when the place cannot be found
 */
export function withAppended(
  text: string,
  path: readonly string[],
  value: unknown
): string | null {
  const root = treeOf(text);
  if (root === undefined) return null;
  // The deepest part of the path the file already has, and the keys it lacks.
  const reached = path.reduce<{
    readonly node: Node;
    readonly missing: readonly string[];
  }>(
    (so, key) => {
      const next =
        so.missing.length === 0
          ? findNodeAtLocation(so.node, [key])
          : undefined;
      return next === undefined
        ? { missing: [...so.missing, key], node: so.node }
        : { missing: [], node: next };
    },
    { missing: [], node: root }
  );
  const [key, ...deeper] = reached.missing;
  if (key === undefined) {
    return reached.node.type === "array"
      ? withMember(text, reached.node, "", value)
      : null;
  }
  if (reached.node.type !== "object") return null;
  const nested = deeper.reduceRight<unknown>(
    (inner, each) => ({ [each]: inner }),
    [value]
  );
  return withMember(text, reached.node, `${JSON.stringify(key)}: `, nested);
}

/**
 * Find the comma that follows a place, when only whitespace and comments
 * stand between the two.
 * @param text - The file's content
 * @param from - The place: where a value ends
 * @returns Where the comma is, or `null` when something else comes first
 */
function commaAfter(text: string, from: number): number | null {
  const gap = UP_TO_COMMA.exec(text.slice(from));
  return gap === null ? null : from + gap[0].length - 1;
}

/**
 * Take a stretch out of a file, with the whitespace that only it needed.
 *
 * A stretch that stood alone on its lines takes those lines with it. One
 * that shared a line gives up the blanks on one side, so two things are not
 * left with a double gap between them. Nothing else on the line moves.
 * @param text - The file's content
 * @param from - Where the stretch starts
 * @param to - Where it ends
 * @returns The new content
 */
function cut(text: string, from: number, to: number): string {
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const lineBreak = text.indexOf("\n", to);
  const lineEnd = lineBreak === -1 ? text.length : lineBreak;
  const before = text.slice(lineStart, from);
  const after = text.slice(to, lineEnd);
  if (before.trim() === "" && after.trim() === "") {
    return spliced(text, lineStart, Math.min(lineEnd + 1, text.length), "");
  }
  // What follows is something to keep (a comment, the next item): it moves
  // up to where the stretch started. With nothing but a closing bracket
  // after, the blanks in front go instead.
  const kept = after.trimStart();
  const closes = kept.startsWith("]") || kept.startsWith("}");
  return closes && before.trim() !== ""
    ? spliced(text, from - (before.length - before.trimEnd().length), to, "")
    : spliced(text, from, to + (after.length - kept.length), "");
}

/**
 * Take one item out of a list that keeps other items, or a comment.
 *
 * The comma that goes with it is the one after it when it has one, and
 * otherwise the one that separated it from the item before.
 * @param text - The file's content
 * @param node - The item
 * @param previous - The item before it, when there is one
 * @returns The new content
 */
function withoutItemAndComma(
  text: string,
  node: Node,
  previous: Node | undefined
): string {
  const end = node.offset + node.length;
  const following = commaAfter(text, end);
  if (following !== null) {
    // A comment between the item and its comma stays: the comma goes alone.
    return text.slice(end, following).trim() === ""
      ? cut(text, node.offset, following + 1)
      : cut(spliced(text, following, following + 1, ""), node.offset, end);
  }
  const preceding =
    previous === undefined
      ? null
      : commaAfter(text, previous.offset + previous.length);
  const without = cut(text, node.offset, end);
  // The comma stands before the item, so taking the item out did not move it.
  return preceding === null
    ? without
    : spliced(without, preceding, preceding + 1, "");
}

/**
 * Take one item out of a list, with one comma and nothing else.
 *
 * A comment between the item and its neighbour is the repository's and
 * stays where it is.
 * @param text - The file's content
 * @param target - Where the item is
 * @returns The new content; the same content when nothing is there
 */
export function withoutItem(text: string, target: JSONPath): string {
  const root = treeOf(text);
  const node =
    root === undefined ? undefined : findNodeAtLocation(root, target);
  const list = node?.parent;
  const items = list?.children ?? [];
  const at = node === undefined ? -1 : items.indexOf(node);
  if (node === undefined || list === undefined || at === -1) return text;
  // The only item: when nothing but whitespace and its comma is left between
  // the brackets they go too. Anything else there is the repository's (a
  // comment), and stays.
  const open = list.offset + 1;
  const close = list.offset + list.length - 1;
  const left = `${text.slice(open, node.offset)}${text.slice(node.offset + node.length, close)}`;
  return items.length === 1 && left.replace(",", "").trim() === ""
    ? spliced(text, open, close, "")
    : withoutItemAndComma(text, node, items[at - 1]);
}
