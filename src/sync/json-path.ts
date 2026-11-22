/**
 * Dot-path helpers for reading and immutably updating nested JSON values.
 *
 * Used by the config-sync engine to address settings inside
 * `.lisa.config.json` (e.g. `quality.testCoverage.global.statements`) and
 * inside mirrored artifact files (e.g. the `thresholds` key of
 * `stryker.conf.json`).
 * @module sync/json-path
 */

/** Any JSON-compatible value. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A JSON object record (non-array, non-null). */
export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * Check whether a value is a plain (non-array) JSON object.
 * @param value - Candidate value
 * @returns True when the value is a plain JSON object record
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the value at a dot path inside a JSON object.
 * @param root - Object to read from
 * @param dotPath - Dot-separated key path (empty string returns the root)
 * @returns The value at the path, or undefined when any segment is missing
 */
export function getAtPath(
  root: unknown,
  dotPath: string
): JsonValue | undefined {
  if (dotPath === "") {
    return root as JsonValue;
  }
  const segments = dotPath.split(".");
  return segments.reduce<unknown>(
    (node, segment) =>
      isJsonObject(node)
        ? (node as Record<string, unknown>)[segment]
        : undefined,
    root
  ) as JsonValue | undefined;
}

/**
 * Return a copy of a JSON object with the value at a dot path replaced.
 * Missing intermediate objects are created; existing siblings are preserved.
 * The input object is never mutated.
 * @param root - Object to copy
 * @param dotPath - Dot-separated key path (empty string replaces the root)
 * @param value - Value to write at the path
 * @returns A new object with the update applied
 */
export function setAtPath(
  root: JsonObject,
  dotPath: string,
  value: JsonValue
): JsonObject {
  if (dotPath === "") {
    if (!isJsonObject(value)) {
      throw new Error(
        "setAtPath: replacing the document root requires an object value"
      );
    }
    return value;
  }
  const dotIndex = dotPath.indexOf(".");
  const head = dotIndex === -1 ? dotPath : dotPath.slice(0, dotIndex);
  const rest = dotIndex === -1 ? "" : dotPath.slice(dotIndex + 1);
  if (rest === "") {
    return { ...root, [head]: value };
  }
  const child = root[head];
  const childObject = isJsonObject(child) ? child : {};
  return { ...root, [head]: setAtPath(childObject, rest, value) };
}

/**
 * Compare two JSON-compatible values for structural equality, independent of
 * object key insertion order.
 * @param a - First value
 * @param b - Second value
 * @returns True when the values are structurally equal
 */
export function jsonEquals(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((entry, i) => jsonEquals(entry, b[i]))
    );
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every(key => Object.hasOwn(b, key) && jsonEquals(a[key], b[key]))
    );
  }
  return a === b;
}

/**
 * Fill missing keys of a JSON value from a fallback, recursively. Present
 * values always win over the fallback; only absent object keys are filled.
 * Arrays and scalars are taken wholesale from whichever side is present.
 * @param value - The preferred value (may be undefined)
 * @param fallback - Values used only where `value` has gaps
 * @returns The value with gaps filled from the fallback
 */
export function fillMissing(
  value: JsonValue | undefined,
  fallback: JsonValue
): JsonValue {
  if (value === undefined) {
    return fallback;
  }
  if (isJsonObject(value) && isJsonObject(fallback)) {
    const keys = new Set([...Object.keys(fallback), ...Object.keys(value)]);
    const entries = Array.from(keys).map((key): [string, JsonValue] => {
      const own = Object.hasOwn(value, key) ? value[key] : undefined;
      const fill = Object.hasOwn(fallback, key) ? fallback[key] : undefined;
      if (own === undefined) {
        return [key, fill as JsonValue];
      }
      if (fill === undefined) {
        return [key, own];
      }
      return [key, fillMissing(own, fill)];
    });
    return Object.fromEntries(entries);
  }
  return value;
}
