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
 * Add a member to the end of a list or an object.
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
  if (last !== undefined) {
    const at = last.offset + last.length;
    const indentation = indentationAt(text, at);
    return spliced(
      text,
      at,
      at,
      endsItsLine(restOfLine(text, at))
        ? `,${style.eol}${indentation}${label}${overLines(value, indentation, style)}`
        : `, ${label}${onOneLine(value)}`
    );
  }
  const open = container.offset + 1;
  const close = container.offset + container.length - 1;
  const empty = text.slice(open, close).trim() === "";
  const indentation = indentationAt(text, container.offset);
  const inner = `${indentation}${style.unit}`;
  return empty && endsItsLine(restOfLine(text, close + 1))
    ? spliced(
        text,
        open,
        close,
        `${style.eol}${inner}${label}${overLines(value, inner, style)}${style.eol}${indentation}`
      )
    : spliced(text, open, open, `${label}${onOneLine(value)}`);
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
 * Take one item out of a list, with the comma that separated it.
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
  const end = node.offset + node.length;
  const previous = items[at - 1];
  const next = items[at + 1];
  if (previous !== undefined) {
    return spliced(text, previous.offset + previous.length, end, "");
  }
  if (next !== undefined) return spliced(text, node.offset, next.offset, "");
  // The only item: what is left between the brackets is whitespace, which
  // goes with it, unless the repository wrote something there (a comment).
  const open = list.offset + 1;
  const close = list.offset + list.length - 1;
  const alone =
    `${text.slice(open, node.offset)}${text.slice(end, close)}`.trim() === "";
  return alone
    ? spliced(text, open, close, "")
    : spliced(text, node.offset, end, "");
}
