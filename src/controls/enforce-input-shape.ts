/**
 * Reading a result file one step of the enforce run handed over, and holding
 * it to a shape.
 *
 * `lisa controls install-carriers` and `lisa controls protect` print their
 * result and keep nothing, and the ticket flow is carried out by an agent.
 * The enforce step saves each result in a file outside the repository and
 * names the files to `lisa controls enforce-report`. A file an agent saved
 * can be absent, empty because the command behind it failed, or not what it
 * should be, so nothing in one is believed before it has been read here.
 *
 * A shape is a list of {@link FieldRule}: one key, what it must hold, and how
 * to say so. Keys a shape does not list are left alone, so a newer command
 * that prints more is still read.
 * @module controls/enforce-input-shape
 */
import { readFile } from "node:fs/promises";

import { isJsonObject } from "../sync/json-path.js";

/** A JSON object whose keys have not been checked yet. */
export type JsonObject = Readonly<Record<string, unknown>>;

/** One key of a shape, and what it must hold. */
export interface FieldRule {
  readonly key: string;
  /** Whether a value is acceptable under the key. */
  readonly holds: (value: unknown) => boolean;
  /** What the key must hold, to follow the words "must be". */
  readonly expected: string;
}

/** A parsed document, or the one line saying why there is none. */
export type DocumentRead =
  | { readonly problem: null; readonly document: JsonObject }
  | { readonly problem: string };

/**
 * Tell whether a value is a string with something in it.
 * @param value - Any value
 * @returns Whether it is a non-blank string
 */
export function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Tell whether a value is a string or `null`.
 * @param value - Any value
 * @returns Whether it is one of the two
 */
export function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Build a check that a value is one of some words.
 * @param words - The words allowed
 * @returns The check
 */
export function oneOf(words: readonly unknown[]): (value: unknown) => boolean {
  return value => words.includes(value);
}

/**
 * Say which words a key accepts.
 * @param words - The words allowed
 * @returns The words, quoted and joined
 */
export function listed(words: readonly unknown[]): string {
  return `one of ${words.map(word => JSON.stringify(word)).join(", ")}`;
}

/**
 * Hold one object to a shape.
 * @param value - The value that should be the object
 * @param rules - The shape
 * @param where - What the object is, to start each line with
 * @returns One line per key that does not hold what it must
 */
export function shapeProblems(
  value: unknown,
  rules: readonly FieldRule[],
  where: string
): readonly string[] {
  if (!isJsonObject(value)) return [`${where} must be a JSON object.`];
  return rules
    .filter(rule => !rule.holds(value[rule.key]))
    .map(rule => `${where}: "${rule.key}" must be ${rule.expected}.`);
}

/**
 * Hold every item of a list to a shape.
 * @param value - The value that should be the list
 * @param rules - The shape of one item
 * @param where - What the list is, to start each line with
 * @returns One line per problem; one line when the value is not a list
 */
export function listProblems(
  value: unknown,
  rules: readonly FieldRule[],
  where: string
): readonly string[] {
  if (!Array.isArray(value)) return [`${where} must be a list.`];
  return value.flatMap((item: unknown, index) =>
    shapeProblems(item, rules, `${where}, item ${index + 1}`)
  );
}

/**
 * Read a result file and parse it.
 * @param file - The path the operator or the skill gave
 * @param what - What the file holds, for example `The carriers result`
 * @param producedBy - The command or flow that should have written it
 * @returns The parsed object, or the one line saying why there is none
 */
export async function readResultFile(
  file: string,
  what: string,
  producedBy: string
): Promise<DocumentRead> {
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) {
    return {
      problem: `${what} could not be read from ${file}. Save what ${producedBy} printed in that file, then run this again.`,
    };
  }
  if (text.trim() === "") {
    return {
      problem: `${what} at ${file} is empty: ${producedBy} printed nothing, which means it stopped with an error. Run it again, read what it says, and save its result.`,
    };
  }
  try {
    const document: unknown = JSON.parse(text);
    return isJsonObject(document)
      ? { document, problem: null }
      : {
          problem: `${what} at ${file} does not hold a JSON object. Save exactly what ${producedBy} printed.`,
        };
  } catch (error) {
    return {
      problem: `${what} at ${file} is not valid JSON (${error instanceof Error ? error.message : String(error)}). Save exactly what ${producedBy} printed, with nothing added.`,
    };
  }
}
