/**
 * The roster of merge drivers a repository's `.gitattributes` asks for.
 *
 * A merge driver has two halves and only one of them is committed:
 * `.gitattributes` names WHICH driver a path uses, while `merge.<name>.driver`
 * — the command — is machine-local, because git refuses to run a command a
 * repository supplies. A mapping whose driver is unregistered is an error
 * nowhere: git falls back to its built-in text merge and says nothing.
 *
 * Deriving the roster rather than hardcoding it is the point. Lisa's first
 * driver had a registration check that named it, so Lisa's second driver would
 * have been uncovered until somebody widened it — the same "declared, and
 * inert" shape the checks exist to catch.
 *
 * This is duplicated, deliberately, in
 * `scripts/lib/gitattributes-merge-drivers.mjs`, which runs from `postinstall`
 * before any TypeScript build exists and therefore cannot import this module. A
 * unit test asserts the two agree on the repository's real `.gitattributes`, so
 * they cannot drift.
 * @module core/gitattributes-merge-drivers
 */

/**
 * Built-in merge strategies, which need no registration.
 *
 * Reporting one of these as unregistered would be noise, and noise is how a
 * check teaches an operator to stop reading it.
 */
const BUILT_IN_STRATEGIES: ReadonlySet<string> = new Set([
  "text",
  "binary",
  "union",
  "ours",
]);

/** Prefix of the attribute that names a driver. */
const MERGE_ATTRIBUTE = "merge=";

/**
 * Compare driver names for a stable, locale-independent roster order.
 * @param left - First driver name
 * @param right - Second driver name
 * @returns Negative, zero, or positive per the usual comparator contract
 */
function compareNames(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

/**
 * Custom driver names named by a `.gitattributes` file.
 * @param contents - Whole `.gitattributes` file contents
 * @returns Sorted, de-duplicated custom driver names
 */
export function mergeDriversInAttributes(contents: string): readonly string[] {
  const named = contents
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "" && !line.startsWith("#"))
    // The first field is the path pattern; every field after it is an attribute.
    .flatMap(line => line.split(/\s+/u).slice(1))
    .filter(attribute => attribute.startsWith(MERGE_ATTRIBUTE))
    .map(attribute => attribute.slice(MERGE_ATTRIBUTE.length))
    .filter(name => name !== "" && !BUILT_IN_STRATEGIES.has(name));
  return [...new Set(named)].sort(compareNames);
}
