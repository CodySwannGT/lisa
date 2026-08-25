/**
 * The roster of merge drivers a repository's `.gitattributes` asks for.
 *
 * Every consumer of this list exists because a merge driver has two halves in
 * two places and only one of them is committed: `.gitattributes` names WHICH
 * driver a path uses, while `merge.<name>.driver` — the command — is
 * machine-local, because git refuses to run a command a repository supplies.
 * A mapping whose driver is unregistered is not an error anywhere: git falls
 * back to its built-in text merge and says nothing. Declared, and inert.
 *
 * The roster is DERIVED rather than hardcoded on purpose. Lisa's first driver
 * (`lisa-learnings`) had a registration check that named it, so Lisa's second
 * driver would have been uncovered until somebody remembered to widen it. A
 * derived roster covers a new driver the day its mapping lands.
 *
 * @module scripts/lib/gitattributes-merge-drivers
 */

/**
 * Compare driver names for a stable, locale-independent roster order.
 * @param {string} left - First driver name
 * @param {string} right - Second driver name
 * @returns {number} Negative, zero, or positive per the usual comparator contract
 */
function compareNames(left, right) {
  return left.localeCompare(right, "en");
}

/** Built-in merge strategies, which need no registration. */
const BUILT_IN = new Set(["text", "binary", "union", "ours"]);

/**
 * Driver names named by a `.gitattributes` file's `merge=<name>` attributes.
 *
 * Built-in strategies (`text`, `binary`, `union`, `ours`) are excluded: they
 * need no registration, so reporting them unregistered would be noise that
 * teaches an operator to ignore the check.
 * @param {string} contents - Whole `.gitattributes` file contents
 * @returns {string[]} Sorted, de-duplicated custom driver names
 */
export function mergeDriversIn(contents) {
  const named = contents
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "" && !line.startsWith("#"))
    // The first field is the path pattern; every field after it is an attribute.
    .flatMap(line => line.split(/\s+/u).slice(1))
    .filter(attribute => attribute.startsWith("merge="))
    .map(attribute => attribute.slice("merge=".length))
    .filter(name => name !== "" && !BUILT_IN.has(name));
  return [...new Set(named)].sort(compareNames);
}
