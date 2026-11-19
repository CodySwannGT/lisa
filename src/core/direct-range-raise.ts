/**
 * Raising a host's direct dependency ranges to a floor, keeping each range's
 * shape and upper bound (CodySwannGT/lisa#4932).
 *
 * Shared by the `overrides`/`resolutions` floors Lisa forces, whose `$name`
 * rewrite would otherwise widen, and by a template's `minimums`, which hold
 * only the host's own direct ranges.
 * @module core/direct-range-raise
 */
import semver from "semver";

import {
  asRecord,
  classifySelfReferenceRewrite,
  collectDirectDependencyNames,
  DIRECT_DEPENDENCY_SECTIONS,
  needsSelfReferenceRewrite,
  OVERRIDE_SECTIONS,
  RAISABLE_SECTIONS,
  rangeMinimum,
  SEMVER_OPTIONS,
} from "./override-floors.js";

/** One direct range raised to meet a floor Lisa forced. */
export interface DirectRangeRaise {
  /** Package name. */
  readonly name: string;
  /** The dependency section whose range was raised. */
  readonly section: (typeof DIRECT_DEPENDENCY_SECTIONS)[number];
  /** The host's direct range before the raise. */
  readonly from: string;
  /** The range it was raised to. */
  readonly to: string;
  /** Lisa's floor that required it. */
  readonly floorRange: string;
}

/**
 * Upper-bound comparators of one comparator set, e.g. `<8.0.0-0` for `^7.0.0`.
 * @param set - One `||`-free range
 * @returns The `<`/`<=` comparators, space-joined
 */
function upperBounds(set: string): string {
  return (new semver.Range(set, SEMVER_OPTIONS).set[0] ?? [])
    .filter(comparator => comparator.operator.startsWith("<"))
    .map(comparator => comparator.value)
    .join(" ");
}

/**
 * Whether two ranges admit exactly the same versions.
 * @param a - First range
 * @param b - Second range
 * @returns True when each is a subset of the other
 */
function sameVersions(a: string, b: string): boolean {
  return (
    semver.subset(a, b, SEMVER_OPTIONS) && semver.subset(b, a, SEMVER_OPTIONS)
  );
}

/**
 * Raise a comparator set that admits nothing at or above the floor, keeping its
 * shape: an exact pin becomes the floor's minimum exactly, and a tilde or caret
 * moves to the minimum. Any other shape is raised to a caret at the minimum.
 * @param set - The host's comparator set, as written
 * @param expanded - The same set as semver expands it
 * @param minimum - The floor's minimum version
 * @returns The raised set, or null when the minimum lies outside the set's own
 *   caret-compatible line, because the raise would then cross a major
 */
function raiseSetBelowFloor(
  set: string,
  expanded: string,
  minimum: string
): string | null {
  const lowest = semver.minVersion(expanded);
  if (
    lowest === null ||
    !semver.satisfies(minimum, `^${lowest.version}`, SEMVER_OPTIONS)
  )
    return null;
  if (semver.valid(set) !== null) return minimum;
  return `${/^[\^~]/u.exec(set)?.[0] ?? "^"}${minimum}`;
}

/**
 * Raise one `||`-free comparator set to a floor, keeping its upper bound.
 * @param set - The host's comparator set
 * @param floorRange - Lisa's floor, a single comparator set
 * @param minimum - The floor's minimum version
 * @returns The set unchanged when it satisfies the floor, null when no raise
 *   stays inside the set's major, else the set with only its minimum raised
 */
function raiseSet(
  set: string,
  floorRange: string,
  minimum: string
): string | null {
  // Expanded first, so a hyphen or x-range joins with the floor as comparators.
  const expanded = new semver.Range(set).range || "*";
  if (semver.subset(expanded, floorRange, SEMVER_OPTIONS)) return set;
  if (!semver.intersects(expanded, floorRange, SEMVER_OPTIONS))
    return raiseSetBelowFloor(set, expanded, minimum);
  const meet = `${expanded} ${floorRange}`;
  const operator = /^[\^~]/u.exec(set)?.[0];
  const candidates = [
    ...(operator === undefined ? [] : [`${operator}${minimum}`]),
    `>=${minimum} ${upperBounds(expanded)}`.trim(),
    meet,
  ];
  return candidates.find(candidate => sameVersions(candidate, meet)) ?? null;
}

/**
 * Raise only the minimum of a host's range to a floor, keeping every upper
 * bound and every alternative already above the floor: `^7.0.0 || ^8.0.0`
 * becomes `^7.70.0 || ^8.0.0` under `>=7.70.0`, and `*` becomes `>=7.70.0`.
 * @param range - The host's direct range
 * @param floorRange - Lisa's floor
 * @returns The raised range, verified to satisfy the floor, or null when no
 *   raise is provable
 */
export function raiseRangeMinimum(
  range: string,
  floorRange: string
): string | null {
  const minimum = rangeMinimum(floorRange);
  if (
    minimum === null ||
    floorRange.includes("||") ||
    semver.validRange(range, SEMVER_OPTIONS) === null
  )
    return null;
  const sets = range
    .split("||")
    .map(set => set.trim())
    .flatMap(set => {
      const raised = raiseSet(set === "" ? "*" : set, floorRange, minimum);
      return raised === null ? [] : [raised];
    });
  const raised = sets.join(" || ");
  return sets.length > 0 &&
    classifySelfReferenceRewrite(floorRange, raised) === "safe"
    ? raised
    : null;
}

/**
 * Raise a host's direct ranges to meet a floor Lisa itself forced into
 * `overrides`/`resolutions`, where the `$name` rewrite would otherwise widen.
 * @remarks
 * Each section is judged on its own. A range that already satisfies the floor
 * is left exactly as written, prereleases included. A range below it has only
 * its minimum raised, so the host keeps its upper bound and any alternative
 * already above the floor. `peerDependencies` are never rewritten. A floor the
 * host wrote, a range Lisa cannot read (`workspace:*`, a git spec) and a raise
 * that cannot be proven are left for {@link auditSelfReferenceRewrites} to
 * refuse as before.
 * @param pkg - Merged package.json, as the apply would persist it
 * @param lisaForce - The applied template's `force` section
 * @returns The manifest with raised direct ranges, and each raise made
 */
export function raiseDirectRangesToLisaFloors(
  pkg: Record<string, unknown>,
  lisaForce: Readonly<Record<string, unknown>>
): {
  readonly packageJson: Record<string, unknown>;
  readonly raises: readonly DirectRangeRaise[];
} {
  const directDeps = collectDirectDependencyNames(pkg);
  const floors = new Map(
    OVERRIDE_SECTIONS.flatMap(section =>
      Object.entries(asRecord(pkg[section])).flatMap(([name, value]) =>
        needsSelfReferenceRewrite(directDeps, name, value) &&
        asRecord(lisaForce[section])[name] === value
          ? [[name, value as string] as const]
          : []
      )
    )
  );
  const raises = RAISABLE_SECTIONS.flatMap(section =>
    Object.entries(asRecord(pkg[section])).flatMap(([name, from]) => {
      const floorRange = floors.get(name);
      if (
        floorRange === undefined ||
        typeof from !== "string" ||
        classifySelfReferenceRewrite(floorRange, from) !== "widening"
      )
        return [];
      const to = raiseRangeMinimum(from, floorRange);
      return to === null ? [] : [{ name, section, from, to, floorRange }];
    })
  );
  if (raises.length === 0) return { packageJson: pkg, raises: [] };
  const raisedSections = RAISABLE_SECTIONS.flatMap(section =>
    raises.some(raise => raise.section === section)
      ? [
          [
            section,
            {
              ...asRecord(pkg[section]),
              ...Object.fromEntries(
                raises
                  .filter(raise => raise.section === section)
                  .map(raise => [raise.name, raise.to])
              ),
            },
          ] as const,
        ]
      : []
  );
  return {
    packageJson: { ...pkg, ...Object.fromEntries(raisedSections) },
    raises,
  };
}
