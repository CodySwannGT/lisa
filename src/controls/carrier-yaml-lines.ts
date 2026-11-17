/**
 * Adding lines to a YAML file a hook manager owns, without rewriting it.
 *
 * Lefthook and the pre-commit framework each read one committed YAML file.
 * Parsing that file and writing it back would drop its comments and reflow
 * its text, which is a change to a file the repository owns. So lines are
 * added instead, at a place found by indentation, and everything else stays
 * byte for byte what it was.
 *
 * Indentation is not a parser, so nothing found this way is trusted on its
 * own. The result is parsed, and it is kept only when it means exactly what
 * the file meant before plus the one entry that was to be added. Anything
 * else is refused and the file is left alone.
 * @module controls/carrier-yaml-lines
 */
import { isDeepStrictEqual } from "node:util";

import { loadYaml } from "../utils/yaml.js";
import { findMarkedBlock } from "./carrier-script.js";

/** A file's lines, and how to put them back together. */
export interface YamlLines {
  /** The lines, without line endings and without a last empty item. */
  readonly lines: readonly string[];
  /** The line ending the file uses. */
  readonly eol: string;
}

/**
 * Split a file into lines, remembering its line ending.
 * @param text - The file's content
 * @returns The lines and the line ending
 */
export function splitLines(text: string): YamlLines {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const body = text.endsWith(eol) ? text.slice(0, -eol.length) : text;
  return { eol, lines: body === "" ? [] : body.split(eol) };
}

/**
 * Join lines back into a file that ends with a line ending.
 * @param lines - The lines
 * @param eol - The line ending
 * @returns The file's content
 */
export function joinLines(lines: readonly string[], eol: string): string {
  return lines.length === 0 ? "" : `${lines.join(eol)}${eol}`;
}

/**
 * Count the spaces a line starts with.
 * @param line - The line
 * @returns Its indentation
 */
export function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Tell whether a line holds YAML content.
 * @param line - The line
 * @returns False for a blank line and for a comment
 */
export function isContent(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== "" && !trimmed.startsWith("#");
}

/**
 * Indent a group of lines.
 * @param lines - The lines
 * @param spaces - How many spaces to put before each
 * @returns The lines, indented
 */
export function indented(
  lines: readonly string[],
  spaces: number
): readonly string[] {
  return lines.map(line => `${" ".repeat(spaces)}${line}`);
}

/** Where a key that opens a block is, or why it cannot be added to. */
export type KeyLine = number | "absent" | "inline";

/**
 * Find a key that opens a block: `key:` with nothing after it.
 * @param lines - The file's lines
 * @param key - The key
 * @param indent - The indentation the key must have
 * @param from - The first line to look at
 * @param to - The line to stop before
 * @returns The line's index, `absent`, or `inline` when the key's value is
 *   written on the same line
 */
export function keyLine(
  lines: readonly string[],
  key: string,
  indent: number,
  from = 0,
  to = lines.length
): KeyLine {
  const spellings = [`${key}:`, `"${key}":`, `'${key}':`];
  const index = lines.findIndex(
    (line, at) =>
      at >= from &&
      at < to &&
      isContent(line) &&
      indentOf(line) === indent &&
      spellings.some(spelling => line.trim().startsWith(spelling))
  );
  if (index === -1) return "absent";
  const line = lines[index]?.trim() ?? "";
  const rest = (
    spellings
      .filter(spelling => line.startsWith(spelling))
      .map(spelling => line.slice(spelling.length))[0] ?? ""
  ).trim();
  return rest === "" || rest.startsWith("#") ? index : "inline";
}

/**
 * Find where the block a line opens stops.
 * @param lines - The file's lines
 * @param start - The line that opens the block
 * @param indent - That line's indentation
 * @param stops - Whether a line at the opening indentation ends the block;
 *   by default every such line does
 * @returns The index of the first line after the block
 */
export function blockEnd(
  lines: readonly string[],
  start: number,
  indent: number,
  stops: (line: string) => boolean = () => true
): number {
  const end = lines.findIndex(
    (line, at) =>
      at > start &&
      isContent(line) &&
      (indentOf(line) < indent || (indentOf(line) === indent && stops(line)))
  );
  return end === -1 ? lines.length : end;
}

/**
 * Find the first line holding content in a range.
 * @param lines - The file's lines
 * @param from - The first line to look at
 * @param to - The line to stop before
 * @returns Its index, or -1 when the range holds none
 */
export function firstContent(
  lines: readonly string[],
  from: number,
  to: number
): number {
  return lines.findIndex(
    (line, at) => at >= from && at < to && isContent(line)
  );
}

/**
 * Find where to add lines at the end of a block: after its last line of
 * content, before any blank lines and comments that trail it.
 * @param lines - The file's lines
 * @param from - The first line of the block's body
 * @param to - The line to stop before
 * @returns The index to insert at
 */
export function afterLastContent(
  lines: readonly string[],
  from: number,
  to: number
): number {
  const last = lines
    .map((line, at) => (at >= from && at < to && isContent(line) ? at : -1))
    .reduce((highest, at) => Math.max(highest, at), from - 1);
  return last + 1;
}

/**
 * Put lines into a file at an index.
 * @param lines - The file's lines
 * @param at - The index to insert at
 * @param added - The lines to add
 * @returns The file's lines with the added ones in place
 */
export function insertedAt(
  lines: readonly string[],
  at: number,
  added: readonly string[]
): readonly string[] {
  return [...lines.slice(0, at), ...added, ...lines.slice(at)];
}

/**
 * Parse a YAML file into a mapping.
 * @param text - The file's content
 * @returns The mapping; empty for an empty file; `null` when the file is not
 *   valid YAML or its top level is not a mapping
 */
export function parseMapping(
  text: string
): Readonly<Record<string, unknown>> | null {
  try {
    const parsed = loadYaml(text);
    if (parsed === null || parsed === undefined) return {};
    return typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Readonly<Record<string, unknown>>)
      : null;
  } catch {
    return null;
  }
}

/** A manager's file with the carrier added, or why it was not. */
export type ManagerFileEdit =
  | {
      readonly problem: null;
      /** The file's new content. */
      readonly text: string;
      /** Whether the entry was already right, added, or replaced. */
      readonly state: "present" | "added" | "replaced";
    }
  | { readonly problem: string };

/** A file with this command's earlier lines set aside, or why it is unusable. */
export type BareFile =
  | {
      readonly problem: null;
      /** The file's lines, without the marked block. */
      readonly lines: readonly string[];
      /** The line ending the file uses. */
      readonly eol: string;
      /** What those lines mean. */
      readonly document: Readonly<Record<string, unknown>>;
      /** Whether a marked block was there, and is being replaced. */
      readonly replacing: boolean;
    }
  | { readonly problem: string };

/**
 * Set aside the lines an earlier run wrote between its markers, and read
 * what is left.
 * @param text - The file's content
 * @param name - What the marked block is called
 * @returns The remaining lines and what they mean, or why the file cannot be
 *   added to
 */
export function withoutMarkedBlock(text: string, name: string): BareFile {
  const { eol, lines } = splitLines(text);
  const block = findMarkedBlock(lines, name);
  if (block.problem !== null) return { problem: block.problem };
  const bare = block.found
    ? [...lines.slice(0, block.start), ...lines.slice(block.end + 1)]
    : lines;
  const document = parseMapping(joinLines(bare, eol));
  return document === null
    ? { problem: "it is not a YAML mapping this command can read" }
    : { document, eol, lines: bare, problem: null, replacing: block.found };
}

/**
 * Keep an edit only when the file then means exactly what it should.
 * @param bare - The file before the edit
 * @param next - The file's lines after it, or `null` when no place was found
 * @param expected - What the file must mean afterwards
 * @param refusal - What to say when the edit is not kept
 * @returns The edit, or the refusal
 */
export function verifiedEdit(
  bare: Extract<BareFile, { readonly problem: null }>,
  next: readonly string[] | null,
  expected: Readonly<Record<string, unknown>>,
  refusal: string
): ManagerFileEdit {
  const text = next === null ? null : joinLines(next, bare.eol);
  return text !== null && isDeepStrictEqual(parseMapping(text), expected)
    ? { problem: null, state: bare.replacing ? "replaced" : "added", text }
    : { problem: refusal };
}
