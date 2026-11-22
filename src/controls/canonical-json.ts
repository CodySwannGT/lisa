/**
 * One way to write a JSON value, so the same value is always the same text.
 *
 * A generated file that is compared byte for byte, and a digest taken over
 * one, both need object keys in an order that does not depend on how the
 * value was built or on the machine it was built on. Keys are ordered by code
 * unit, which every machine agrees on; a locale-aware comparison does not.
 *
 * ## Why the text is written here and not by the language's own writer
 *
 * A JavaScript object lists its keys in its own order: keys that look like
 * array indexes (`"9"`, `"10"`) first, by their numeric value, and every
 * other key after them in the order it was added. So an object rebuilt with
 * its keys sorted by code unit still writes `"9"` before `"10"`, which is
 * numeric order and not code-unit order. {@link canonicalText} and
 * {@link canonicalFileText} therefore write the text themselves, key by key,
 * and the order is code-unit order whatever a key looks like.
 * @module controls/canonical-json
 */

/** The indent of a generated file, at each depth. */
const FILE_INDENT = "  ";

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
 * Write one JSON value as text, with the keys of every object in code-unit
 * order.
 *
 * It writes what `JSON.stringify` writes for the same value with its keys in
 * that order: the same spacing, the same escapes, a member with no value
 * left out of an object and written `null` in a list.
 * @param value - Any JSON value
 * @param indent - What one level of depth is indented by; empty for one line
 * @param margin - The indent of the line the value starts on
 * @returns The text, or `undefined` for a value JSON has no way to write
 */
function written(
  value: unknown,
  indent: string,
  margin: string
): string | undefined {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) as string | undefined;
  }
  const inner = `${margin}${indent}`;
  const [open, between, close, colon] =
    indent === ""
      ? ["", ",", "", ":"]
      : [`\n${inner}`, `,\n${inner}`, `\n${margin}`, ": "];
  if (Array.isArray(value)) {
    const items = value.map(item => written(item, indent, inner) ?? "null");
    return items.length === 0
      ? "[]"
      : `[${open}${items.join(between)}${close}]`;
  }
  const members = Object.entries(value)
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .flatMap(([key, item]) => {
      const text = written(item, indent, inner);
      return text === undefined
        ? []
        : [`${JSON.stringify(key)}${colon}${text}`];
    });
  return members.length === 0
    ? "{}"
    : `{${open}${members.join(between)}${close}}`;
}

/**
 * A JSON value as one line of text that is the same for equal values: object
 * keys in code-unit order at every depth, no spaces, lists in their own
 * order.
 * @param value - Any JSON value
 * @returns Its canonical text. A value that is not there at all (`undefined`)
 *   gives the word `undefined`, which no JSON value is written as, so it is
 *   never taken for `null`.
 */
export function canonicalText(value: unknown): string {
  return String(written(value, "", ""));
}

/**
 * A JSON value as the text of a generated file: object keys in code-unit
 * order at every depth, two-space indent, one trailing newline. The same
 * value always gives the same bytes.
 * @param value - Any JSON value
 * @returns The file content
 */
export function canonicalFileText(value: unknown): string {
  return `${String(written(value, FILE_INDENT, ""))}\n`;
}
