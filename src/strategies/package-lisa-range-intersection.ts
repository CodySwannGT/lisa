import semver from "semver";

/**
 * The release core an npm comparator opts into for prerelease matching.
 * @param comparator - Comparator from a parsed npm range.
 * @returns The release core for an explicit prerelease comparator.
 */
function prereleaseCore(comparator: semver.Comparator): string | null {
  if (comparator.value === "" || comparator.semver.prerelease.length === 0) {
    return null;
  }
  const { major, minor, patch } = comparator.semver;
  return `${major}.${minor}.${patch}`;
}

/**
 * Project a comparator onto stable releases, excluding any prerelease opt-in.
 * @param comparator - Comparator from a parsed npm range.
 * @returns A stable comparator, or null when it selects only a prerelease.
 */
function stableComparator(comparator: semver.Comparator): string | null {
  const core = prereleaseCore(comparator);
  if (core === null) return comparator.value;
  if (comparator.operator.startsWith(">")) return `>=${core}`;
  if (comparator.operator.startsWith("<")) return `<${core}`;
  return null;
}

/**
 * Remove duplicate and wildcard comparators from an intersection clause.
 * @param comparators - Already parsed or constructed comparator strings.
 * @returns A comparator set accepted by npm.
 */
function clause(comparators: readonly string[]): string {
  return [...new Set(comparators.filter(Boolean))].join(" ") || "*";
}

/**
 * Intersect two comparator sets under npm's prerelease rules.
 * @param left - The host's comparators for one arm of its range.
 * @param right - Lisa's comparators for one arm of its range.
 * @returns Stable and shared-prerelease clauses.
 */
function intersectClauses(
  left: readonly semver.Comparator[],
  right: readonly semver.Comparator[]
): string[] {
  const combined = [...left, ...right];
  const stable = combined.map(stableComparator);
  const stableArm = stable.every(value => value !== null)
    ? [clause(stable)]
    : [];
  const rightCores = new Set(right.map(prereleaseCore));
  const sharedCores = new Set(
    left
      .map(prereleaseCore)
      .filter(core => core !== null && rightCores.has(core))
  );
  const prereleaseArms = [...sharedCores].map(core =>
    clause([
      ...combined.map(comparator => comparator.value),
      `>=${core}-0`,
      `<${core}`,
    ])
  );
  return [...stableArm, ...prereleaseArms];
}

/**
 * Find every version npm admits in both valid ranges.
 * @param host - The host's dependency range.
 * @param forced - Lisa's dependency range.
 * @returns A range for the intersection, or null when it is empty.
 */
export function intersectDependencyRanges(
  host: string,
  forced: string
): string | null {
  const forcedSets = new semver.Range(forced).set;
  const validArms = new semver.Range(host).set
    .flatMap(left => forcedSets.flatMap(right => intersectClauses(left, right)))
    .filter(arm => semver.minVersion(arm) !== null);
  return validArms.length === 0 ? null : [...new Set(validArms)].join(" || ");
}
