/**
 * One way to write a JSON value, so the same value is always the same text.
 *
 * A generated file that is compared byte for byte, and a digest taken over
 * one, both need object keys in an order that does not depend on how the
 * value was built or on the machine it was built on. Keys are ordered by code
 * unit, which every machine agrees on; a locale-aware comparison does not.
 * @module controls/canonical-json
 */

/**
 * Compare two strings by code unit, the same on every machine.
 * @param left - First string
 * @param right - Second string
 * @returns Negative, zero or positive
 */
export function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * The same JSON value with the keys of every object in code-unit order.
 * Lists keep their order: the order of a list is part of what it says.
 * @param value - Any JSON value
 * @returns The value, key-ordered at every depth
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => canonicalize(item));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, item]) => [key, canonicalize(item)])
  );
}

/**
 * A JSON value as one line of text that is the same for equal values.
 * @param value - Any JSON value
 * @returns Its canonical text
 */
export function canonicalText(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
