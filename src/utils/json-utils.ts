import { readFile, writeFile } from "node:fs/promises";
import merge from "lodash.merge";
import { JsonParseError } from "../errors/index.js";

/**
 * Read and parse a JSON file
 * @param filePath Path to JSON file to read
 * @returns Parsed JSON data
 */
export async function readJson<T = unknown>(filePath: string): Promise<T> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new JsonParseError(filePath, error);
    }
    throw error;
  }
}

/**
 * Read JSON file, returning null if file doesn't exist or is invalid
 * @param filePath Path to JSON file to read
 * @returns Parsed JSON data or null if file doesn't exist or is invalid
 */
export async function readJsonOrNull<T = unknown>(
  filePath: string
): Promise<T | null> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return null;
  }
}

/**
 * Write object as JSON to a file
 * @param filePath Path to file to write
 * @param data Data to serialize as JSON
 * @param spaces Number of spaces for indentation (default 2)
 */
export async function writeJson(
  filePath: string,
  data: unknown,
  spaces = 2
): Promise<void> {
  const content = JSON.stringify(data, null, spaces);
  await writeFile(filePath, `${content}\n`, "utf-8");
}

/**
 * Check if a file contains valid JSON
 * @param filePath Path to file to check
 * @returns True if file contains valid JSON
 */
export async function isValidJson(filePath: string): Promise<boolean> {
  try {
    await readJson(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deep merge two objects (Lisa values take precedence on conflicts)
 * Uses lodash.merge for deep merging
 * @param base Base object (project values)
 * @param override Override object with precedence (Lisa values)
 * @returns Merged object with Lisa values winning conflicts
 */
export function deepMerge<T extends object>(base: T, override: T): T {
  // Create a new object to avoid mutating inputs
  return merge({}, base, override) as T;
}

/**
 * Deep merge two JSON objects while preserving array entries from both sides.
 * Scalar conflicts still use override-wins semantics.
 * @param base Base object (project values)
 * @param override Override object with precedence (Lisa values)
 * @returns Merged object with arrays concatenated and deduplicated
 */
export function deepMergeWithArrayUnion<T extends object>(
  base: T,
  override: T
): T {
  return mergeJsonValues(base, override) as T;
}

/**
 * Merge two JSON-compatible values.
 * @param base Lower-precedence value
 * @param override Higher-precedence value
 * @returns Merged JSON-compatible value
 */
function mergeJsonValues(base: unknown, override: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(override)) {
    // The override side is normalized before the union so that dedupe can see
    // through to equality. Concatenating raw override elements let an
    // already-normalized base element and its unnormalized twin both survive —
    // deeply unequal, so nothing collapsed them — and the array grew by one on
    // every `lisa apply`.
    return dedupeArray([...base, ...override.map(cloneOverrideValue)]);
  }

  if (isJsonObject(base) && isJsonObject(override)) {
    return mergeJsonObjects(base, override);
  }

  return cloneOverrideValue(override);
}

/**
 * Clone a value arriving from the override side, normalizing arrays as the
 * union path would.
 *
 * Only the override is normalized. A base-only value is the host's own data and
 * is preserved verbatim — deduping it would mean Lisa silently rewriting
 * configuration it was never asked to touch, which is a worse defect than the
 * one this fixes.
 *
 * Without this, an override array containing duplicates was cloned verbatim on
 * the first merge and deduped by the second, because only then did both sides
 * hold an array. The same template against the same host produced two different
 * files on consecutive `lisa apply` runs.
 * @param value Value taken from the higher-precedence object
 * @returns A deep clone whose arrays are deduped at every depth
 */
function cloneOverrideValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return dedupeArray(value.map(cloneOverrideValue));
  }

  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        cloneOverrideValue(entry),
      ])
    );
  }

  return value;
}

/**
 * Merge two JSON object records without mutating either input.
 * @param base Lower-precedence object
 * @param override Higher-precedence object
 * @returns Merged object
 */
function mergeJsonObjects(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const keys = new Set([...Object.keys(base), ...Object.keys(override)]);

  return Object.fromEntries(
    Array.from(keys).map(key => {
      const value = Object.hasOwn(override, key)
        ? Object.hasOwn(base, key)
          ? mergeJsonValues(base[key], override[key])
          : cloneOverrideValue(override[key])
        : cloneJsonValue(base[key]);
      return [key, value];
    })
  );
}

/**
 * Remove duplicate JSON array entries while preserving first occurrence order.
 * Uses structural equality so key order does not affect deduplication.
 * @param items Array entries to deduplicate
 * @returns Deduplicated array
 */
function dedupeArray(items: unknown[]): unknown[] {
  return items.reduce<unknown[]>(
    (deduped, item) =>
      deduped.some(existing => isDeepEqualJsonValue(existing, item))
        ? deduped
        : [...deduped, cloneJsonValue(item)],
    []
  );
}

/**
 * Compare two JSON-compatible values for structural equality, independent of
 * object key insertion order.
 * @param a First value
 * @param b Second value
 * @returns True when the values are structurally equal
 */
function isDeepEqualJsonValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((entry, index) => isDeepEqualJsonValue(entry, b[index]))
    );
  }

  if (isJsonObject(a) && isJsonObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every(
        key => Object.hasOwn(b, key) && isDeepEqualJsonValue(a[key], b[key])
      )
    );
  }

  return a === b;
}

/**
 * Check whether a value is a non-array JSON object.
 * @param value Candidate value
 * @returns True when the value is a plain JSON object record
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Clone JSON-compatible values so merge results do not retain input references.
 * @param value JSON-compatible value
 * @returns Cloned JSON-compatible value
 */
function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }

  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)])
    );
  }

  return value;
}
