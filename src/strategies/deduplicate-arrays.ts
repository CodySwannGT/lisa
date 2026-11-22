/**
 * @file deduplicate-arrays.ts
 * @description The array union both JSON-governing strategies apply to their
 * `merge` sections: Lisa's items first, then the project's unique additions.
 * @module strategies
 */

/**
 * Concatenate two arrays and drop every later duplicate, preserving order.
 * @remarks
 * Equality is `JSON.stringify` equality, so objects and arrays with the same
 * content count as duplicates — which is what lets a list of package names
 * with version specifiers deduplicate. The first occurrence of each value wins.
 * @param firstItems - Items that come first (Lisa's)
 * @param laterItems - Items appended when not already present (the project's)
 * @returns The order-preserving union of both arrays
 */
export function deduplicateArrays(
  firstItems: readonly unknown[],
  laterItems: readonly unknown[]
): unknown[] {
  const combined = [...firstItems, ...laterItems];
  const keys = combined.map(item => JSON.stringify(item));
  // Built from the reversed pairs so the EARLIEST index of each key is the one
  // the Map keeps: a later entry for the same key overwrites an earlier one.
  const firstIndex = new Map(
    keys.map((key, index) => [key, index] as const).reverse()
  );
  return keys.flatMap((key, index) =>
    firstIndex.get(key) === index ? [combined[index]] : []
  );
}
