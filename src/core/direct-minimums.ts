/**
 * Lisa's minimum versions for libraries a host chooses for itself
 * (CodySwannGT/lisa#4932).
 *
 * Lisa used to force a stack's standard libraries into every host. It no
 * longer installs them, but a host that lists one is still held at or above
 * the version Lisa used to force. A minimum touches only the host's own direct
 * ranges: it is never written to `overrides` or `resolutions`, because those
 * replace the range of every copy in the tree and would move a transitive
 * consumer of an older major onto a newer one. A host that does not list the
 * library is not changed at all.
 * @module core/direct-minimums
 */
import { raiseRangeMinimum } from "./direct-range-raise.js";
import {
  asRecord,
  classifySelfReferenceRewrite,
  RAISABLE_SECTIONS,
  suggestSatisfyingDirectRange,
} from "./override-floors.js";

/** A section Lisa may raise a direct range in. */
type RaisableSection = (typeof RAISABLE_SECTIONS)[number];

/** One direct range raised to meet a Lisa minimum. */
export interface DirectMinimumRaise {
  /** Dependency section holding the range. */
  readonly section: RaisableSection;
  /** Package name. */
  readonly name: string;
  /** The host's range before the raise. */
  readonly from: string;
  /** The range it was raised to. */
  readonly to: string;
  /** Lisa's minimum, as a range such as `>=4.6.6`. */
  readonly minimum: string;
}

/** One direct range below a Lisa minimum that no same-major raise reaches. */
export interface DirectMinimumConflict {
  /** Dependency section holding the range. */
  readonly section: RaisableSection;
  /** Package name. */
  readonly name: string;
  /** The host's range. */
  readonly directRange: string;
  /** Lisa's minimum, as a range such as `>=4.6.6`. */
  readonly minimum: string;
  /** A range verified to meet the minimum, or null when none was derived. */
  readonly suggestedDirectRange: string | null;
}

/**
 * Hold a host's direct ranges at or above Lisa's minimums.
 * @remarks
 * A range that meets the minimum, and one Lisa cannot read (`workspace:*`, a
 * git spec), is left exactly as written. A range below it has only its minimum
 * raised, inside its own major: `5.2.0` becomes the minimum exactly, `~7.50.0`
 * a tilde at it. A range whose raise would cross a major is a conflict, and the
 * caller refuses rather than move the host to another major behind its back.
 * `peerDependencies` are never read or rewritten: a peer range is the host's
 * promise to its own consumers, not what it installs.
 * @param pkg - Merged package.json, as the apply would persist it
 * @param minimums - Package name to minimum range, from the merged template
 * @returns The manifest with raised ranges, each raise, and each conflict
 */
export function applyDirectMinimums(
  pkg: Record<string, unknown>,
  minimums: Readonly<Record<string, string>>
): {
  readonly packageJson: Record<string, unknown>;
  readonly raises: readonly DirectMinimumRaise[];
  readonly conflicts: readonly DirectMinimumConflict[];
} {
  const judged = RAISABLE_SECTIONS.flatMap(section =>
    Object.entries(asRecord(pkg[section])).flatMap(([name, from]) => {
      const minimum = minimums[name];
      if (
        minimum === undefined ||
        typeof from !== "string" ||
        classifySelfReferenceRewrite(minimum, from) !== "widening"
      )
        return [];
      return [
        { section, name, from, minimum, to: raiseRangeMinimum(from, minimum) },
      ];
    })
  );
  const raises = judged.flatMap(({ to, ...rest }) =>
    to === null ? [] : [{ ...rest, to }]
  );
  const conflicts = judged.flatMap(({ to, section, name, from, minimum }) =>
    to === null
      ? [
          {
            section,
            name,
            directRange: from,
            minimum,
            suggestedDirectRange: suggestSatisfyingDirectRange(minimum),
          },
        ]
      : []
  );
  if (raises.length === 0) return { packageJson: pkg, raises, conflicts };
  const raisedSections = RAISABLE_SECTIONS.flatMap(section => {
    const here = raises.filter(raise => raise.section === section);
    return here.length === 0
      ? []
      : [
          [
            section,
            {
              ...asRecord(pkg[section]),
              ...Object.fromEntries(here.map(raise => [raise.name, raise.to])),
            },
          ] as const,
        ];
  });
  return {
    packageJson: { ...pkg, ...Object.fromEntries(raisedSections) },
    raises,
    conflicts,
  };
}

/**
 * Explain a refused minimum, naming the raise the host can make itself.
 * @param conflict - The conflict that stops the apply
 * @returns One operator-readable sentence
 */
export function describeDirectMinimumConflict(
  conflict: DirectMinimumConflict
): string {
  const remedy =
    conflict.suggestedDirectRange === null
      ? `Reconcile ${conflict.name} by hand.`
      : `Raise the direct dependency ${conflict.name} to ` +
        `${JSON.stringify(conflict.suggestedDirectRange)} when the host is ` +
        `ready for that major.`;
  return (
    `${conflict.section}.${conflict.name} is ` +
    `${JSON.stringify(conflict.directRange)}, below Lisa's minimum ` +
    `${JSON.stringify(conflict.minimum)}, and raising it would cross a major ` +
    `version, so Lisa is not changing it on the host's behalf. ${remedy}`
  );
}

/**
 * The note an apply prints for one raise.
 * @param raise - The raise made
 * @returns One operator-readable sentence
 */
export function describeDirectMinimumRaise(raise: DirectMinimumRaise): string {
  return (
    `Raised ${raise.section}.${raise.name} from ${JSON.stringify(raise.from)} ` +
    `to ${JSON.stringify(raise.to)} to meet Lisa's minimum ` +
    `${JSON.stringify(raise.minimum)}.`
  );
}
