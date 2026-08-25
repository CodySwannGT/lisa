/**
 * @file Shared vocabulary for npm `$name` override self-references and the
 * security floors they can silently resolve downwards.
 * @description
 * An `overrides`/`resolutions` entry written `"$name"` means "whatever the
 * direct dependency says". Lisa's templates force floors into those same two
 * sections, so when a floored package is ALSO a direct dependency, the apply
 * normalizes the forced literal to `$name` — and if the host's direct range
 * starts below the floor, that rewrite would readmit exactly the versions the
 * floor exists to exclude. `lisa apply` refuses rather than perform it.
 *
 * The refusal is correct. What it was missing is a way to be seen coming, and a
 * remedy the operator can actually follow. Both halves are here, in ONE place,
 * because they must agree by construction:
 *
 * - {@link classifySelfReferenceRewrite} is the single predicate. The apply's
 *   guard and `lisa doctor` both call it, so doctor can never report clean on a
 *   manifest the apply is about to refuse, nor cry wolf on one it accepts.
 * - {@link suggestSatisfyingDirectRange} runs its own suggestion back through
 *   that same predicate before returning it. Advice that has not been tested
 *   against the guard is how CodySwannGT/lisa#3191 happened — an operator who
 *   did what the refusal told them was refused a second time, which reads as
 *   the guard being broken rather than the range being wrong. A suggestion that
 *   does not verify is withheld, not printed hopefully.
 *
 * Nothing here rewrites a host range or lowers a floor. Raising a dependency is
 * a version decision with its own blast radius; this module names the raise and
 * the operator makes it.
 * @module core/override-floors
 */
import semver from "semver";

/** package.json sections whose keys are treated as direct dependencies. */
export const DIRECT_DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/** package.json sections that carry npm-style version overrides. */
export const OVERRIDE_SECTIONS = ["overrides", "resolutions"] as const;

/** One of the two npm override sections. */
export type OverrideSection = (typeof OVERRIDE_SECTIONS)[number];

/**
 * What rewriting one literal override to `"$name"` would do to its floor.
 *
 * `unprovable` and `widening` are kept apart because they are different
 * operator problems: the first is a range Lisa cannot parse on either side (a
 * git spec, `workspace:*`, an alias), the second is an ordinary semver range
 * that genuinely starts lower than the floor.
 */
export type SelfReferenceVerdict = "safe" | "unprovable" | "widening";

/** One override whose `$name` rewrite would resolve below Lisa's floor. */
export interface SelfReferenceFloorConflict {
  /** Override section carrying the entry. */
  readonly section: OverrideSection;
  /** Package name. */
  readonly name: string;
  /** Literal override range in the merged manifest — Lisa's floor. */
  readonly floorRange: string;
  /** Direct dependency range `$name` would resolve to. */
  readonly directRange: string;
  /** Why the rewrite is refused. */
  readonly verdict: Exclude<SelfReferenceVerdict, "safe">;
  /**
   * A direct range that has been VERIFIED to satisfy the guard, or null when
   * none could be derived. Never a guess.
   */
  readonly suggestedDirectRange: string | null;
}

/**
 * What one pass over a merged manifest actually looked at, alongside what it
 * found.
 *
 * The counts are not decoration. A check that inspected nothing and a check
 * that inspected everything and found nothing produce the same empty conflict
 * list, and only the counts tell them apart — so every caller reports them and
 * refuses to call zero inspected a pass.
 */
export interface OverrideFloorAudit {
  /** Every top-level entry across `overrides` and `resolutions`. */
  readonly overridesInspected: number;
  /** Those the `$name` normalization guard actually judges. */
  readonly rewritesJudged: number;
  /** Those the guard would refuse. */
  readonly conflicts: readonly SelfReferenceFloorConflict[];
  /** Those the guard would perform, in the order they were read. */
  readonly rewritable: readonly SelfReferenceCandidate[];
}

/** One override the `$name` normalization guard judges. */
export interface SelfReferenceCandidate {
  /** Override section carrying the entry. */
  readonly section: OverrideSection;
  /** Package name. */
  readonly name: string;
  /** Literal override range in the merged manifest. */
  readonly floorRange: string;
  /** Direct dependency range `$name` would resolve to. */
  readonly directRange: string;
}

/**
 * Narrow an unknown value to a plain object record, returning {} otherwise.
 * @param value - Candidate value
 * @returns The value as a record, or an empty record when it is not a plain object
 */
export function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Collect the names of every direct dependency declared across a package.json's
 * dependency sections.
 * @param pkg - Merged package.json object
 * @returns Set of direct dependency names
 */
export function collectDirectDependencyNames(
  pkg: Record<string, unknown>
): Set<string> {
  return new Set(
    DIRECT_DEPENDENCY_SECTIONS.flatMap(section =>
      Object.keys(asRecord(pkg[section]))
    )
  );
}

/**
 * Collect direct dependency ranges by package name.
 * @param pkg - Merged package.json object
 * @returns Package name to string range map
 */
export function collectDirectDependencyRanges(
  pkg: Record<string, unknown>
): ReadonlyMap<string, string> {
  return new Map(
    DIRECT_DEPENDENCY_SECTIONS.flatMap(section =>
      Object.entries(asRecord(pkg[section])).flatMap(([name, value]) =>
        typeof value === "string" ? [[name, value] as const] : []
      )
    )
  );
}

/**
 * Decide whether an override/resolution entry is a candidate for npm `$name`
 * normalization at all.
 * @param directDeps - Direct dependency names in the merged package
 * @param name - Override/resolution key
 * @param value - Override/resolution value
 * @returns True when the entry is a literal direct-dependency collision
 */
export function needsSelfReferenceRewrite(
  directDeps: ReadonlySet<string>,
  name: string,
  value: unknown
): boolean {
  return (
    directDeps.has(name) &&
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("$")
  );
}

/**
 * The one predicate behind both the apply's refusal and doctor's report.
 * @remarks
 * Deliberately plain `semver.subset`, with no ceiling normalization. The
 * normalizing variant used by the host-pin branch (`rangeContains` in the
 * package-lisa strategy) can only turn a refusal into an acceptance, and this
 * branch is the one that decides whether a security floor may be resolved
 * DOWNWARDS — so it keeps the stricter reading. Any range that reaches a
 * `widening` verdict here still has a followable way out, because
 * {@link suggestSatisfyingDirectRange} is verified against this same function.
 * @param floorRange - The literal override range being replaced
 * @param directRange - The direct dependency range `$name` would resolve to
 * @returns Whether the rewrite is safe, unprovable, or widening
 */
export function classifySelfReferenceRewrite(
  floorRange: string,
  directRange: string
): SelfReferenceVerdict {
  if (!semver.validRange(floorRange) || !semver.validRange(directRange)) {
    return "unprovable";
  }
  return semver.subset(directRange, floorRange) ? "safe" : "widening";
}

/**
 * Derive a direct dependency range that satisfies the floor, and PROVE it does
 * before handing it to an operator.
 * @remarks
 * The natural suggestion is a caret at the floor's minimum version, because
 * that is what a person writes and what the one already-fixed instance of this
 * defect was fixed with. It is not always right: measured, `^1.18.0` is not a
 * subset of a bounded floor `>=1.18.0 <1.19.0`, and `^0.0.0` is not a subset of
 * `*`. So the caret is a CANDIDATE, tested against
 * {@link classifySelfReferenceRewrite} and discarded when it fails, falling
 * back to the floor range verbatim — which is a subset of itself for any range
 * semver can parse.
 *
 * A floor semver cannot parse yields null. Printing an untested range would be
 * the #3191 failure exactly: advice that sends the operator back into the same
 * refusal.
 * @param floorRange - The literal override range acting as the floor
 * @returns A range verified to satisfy the guard, or null when none exists
 */
export function suggestSatisfyingDirectRange(
  floorRange: string
): string | null {
  const minimum = rangeMinimum(floorRange);
  const candidates =
    minimum === null ? [floorRange] : [`^${minimum}`, floorRange];
  return (
    candidates.find(
      candidate =>
        classifySelfReferenceRewrite(floorRange, candidate) === "safe"
    ) ?? null
  );
}

/**
 * Lowest version a range admits, without throwing on an unparseable range.
 * @param range - An npm version range
 * @returns The minimum version, or null when the range is not comparable
 */
function rangeMinimum(range: string): string | null {
  try {
    return semver.minVersion(range)?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Judge every `$name`-rewrite candidate in a merged manifest, collecting ALL
 * conflicts rather than stopping at the first.
 * @remarks
 * The apply throws on the first conflict, which is right for an apply — it is
 * about to write a file and must not. A report has the opposite obligation: an
 * operator who fixes the one package named and re-runs, only to be handed the
 * next one, is being drip-fed a list Lisa already had in full.
 * @param pkg - Merged package.json, as the apply would persist it
 * @returns What was inspected and every conflict found
 */
export function auditSelfReferenceRewrites(
  pkg: Record<string, unknown>
): OverrideFloorAudit {
  const directDeps = collectDirectDependencyNames(pkg);
  const directRanges = collectDirectDependencyRanges(pkg);
  const entries = OVERRIDE_SECTIONS.flatMap(section =>
    Object.entries(asRecord(pkg[section])).map(
      ([name, value]) => [section, name, value] as const
    )
  );
  const judged = entries.flatMap(([section, name, value]) => {
    if (!needsSelfReferenceRewrite(directDeps, name, value)) {
      return [];
    }
    const directRange = directRanges.get(name);
    return directRange === undefined
      ? []
      : [{ section, name, floorRange: value as string, directRange }];
  });
  const verdicts = judged.map(candidate => ({
    candidate,
    verdict: classifySelfReferenceRewrite(
      candidate.floorRange,
      candidate.directRange
    ),
  }));
  return {
    overridesInspected: entries.length,
    rewritesJudged: judged.length,
    conflicts: verdicts.flatMap(({ candidate, verdict }) =>
      verdict === "safe"
        ? []
        : [
            {
              ...candidate,
              verdict,
              suggestedDirectRange: suggestSatisfyingDirectRange(
                candidate.floorRange
              ),
            },
          ]
    ),
    rewritable: verdicts.flatMap(({ candidate, verdict }) =>
      verdict === "safe" ? [candidate] : []
    ),
  };
}

/**
 * The remedy sentence, shared by the apply's refusal and doctor's report so an
 * operator is never told two different things about the same conflict.
 * @param conflict - The conflict to describe
 * @returns One operator-readable sentence naming the exact raise to make
 */
export function describeSelfReferenceRemedy(
  conflict: SelfReferenceFloorConflict
): string {
  if (conflict.suggestedDirectRange === null) {
    return (
      `Lisa could not derive a direct range that satisfies the floor ` +
      `${JSON.stringify(conflict.floorRange)}, so it is not guessing one. ` +
      `Reconcile ${conflict.name} by hand, or raise Lisa's template pin.`
    );
  }
  return (
    `Raise the direct dependency ${conflict.name} from ` +
    `${JSON.stringify(conflict.directRange)} to ` +
    `${JSON.stringify(conflict.suggestedDirectRange)}, which Lisa has ` +
    `verified satisfies the floor ${JSON.stringify(conflict.floorRange)}.`
  );
}
