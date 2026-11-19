/**
 * @file package-lisa-host-pins.ts
 * @description Phase 1 floor guard of the package-lisa apply: restore host
 * dependency pins that provably sit above Lisa's forced floor, and refuse when
 * neither range can be proven ahead.
 * @module strategies
 */
import semver from "semver";

import {
  asRecord,
  DIRECT_DEPENDENCY_SECTIONS,
  OVERRIDE_SECTIONS,
} from "../core/override-floors.js";
import { JsonMergeError } from "../errors/index.js";
import type { PackageJsonPlan } from "./package-lisa-types.js";

/**
 * Every section whose forced values are a version FLOOR rather than an
 * assignment, and which therefore may never be merged downwards.
 * @remarks
 * `overrides`/`resolutions` alone was the original list, and it left the hole
 * this exists to close: `overrides.tar` is `"$tar"`, npm's self-reference, so
 * its effective floor IS `dependencies.tar`. Guarding only the override
 * sections preserved a `$tar` that had quietly come to mean something weaker —
 * the protection intact and hollow at the same time, with a test asserting the
 * override survived passing either way.
 */
const FLOOR_SECTIONS = [
  ...DIRECT_DEPENDENCY_SECTIONS,
  ...OVERRIDE_SECTIONS,
] as const;

/** What Phase 1's value and the host's value mean for one dependency. */
type PinVerdict = "template" | "host" | "incomparable";

/** A host pin kept over Lisa's, with both ranges for the operator note. */
interface PreservedPin {
  readonly section: string;
  readonly name: string;
  readonly hostRange: string;
  readonly forcedRange: string;
}

/**
 * Restore host dependency pins that sit ABOVE Lisa's template.
 * @remarks
 * Every `force` pin exists to push a project PAST a CVE, so it is a security
 * FLOOR — not an assignment. Phase 1 applies it with `deepMerge`, where Lisa's
 * value wins unconditionally, and that is only correct while the template is the
 * higher of the two. The moment a host raises a pin beyond the template (or the
 * template simply lags a fresh advisory), the same "security write" silently
 * walks the host BACKWARDS into the vulnerable range it had already escaped.
 *
 * This is not hypothetical: a caller repo in the portfolio pinned at
 * `dependencies.tar >=7.5.21` was reverted to `>=7.5.19` on every `bun install`,
 * readmitting the two releases GHSA-r292-9mhp-454m covers. A floor can only be
 * right by coincidence when it is written as an overwrite.
 *
 * The decision is deliberately narrow, because Lisa must be able to PROVE the
 * host is ahead — the same standard `preserveIfHostAhead` holds the file lane
 * to, applied to the strictly easier case where a semver range makes "ahead"
 * decidable rather than merely suspected:
 *
 * - Host floor not above Lisa's: Lisa is raising, which is the whole point of
 *   the mechanism. Phase 1 stands.
 * - Host floor above Lisa's AND the host range is a subset of Lisa's: the host
 *   admits only versions Lisa allows, so it is provably the stricter of the
 *   two. Keep the host.
 * - Host floor above Lisa's and neither range contains the other: both sides
 *   carry a constraint the other drops. Lisa cannot decide it, so it REFUSES
 *   and names both rather than picking one — silently picking one is how a
 *   lowered floor shipped in the first place.
 *
 * A value that cannot be parsed — npm's `"$name"` self-references, git URLs,
 * `workspace:*` — is left as Phase 1 produced it, so this can only ever RAISE
 * a pin or stop.
 * @param projectJson - The host package.json as it was before Phase 1.
 * @param afterForce - The result of Phase 1's force merge.
 * @param fileName - Basename used in error messages.
 * @throws {JsonMergeError} when a host pin is higher but the two ranges are
 *   incomparable.
 * @returns `afterForce` with host-side higher pins restored, plus notes.
 */
export function preserveHigherHostPins(
  projectJson: Record<string, unknown>,
  afterForce: Record<string, unknown>,
  fileName: string
): PackageJsonPlan {
  return FLOOR_SECTIONS.reduce<PackageJsonPlan>(
    (plan, section) => {
      const forcedSection = asRecord(plan.packageJson[section]);
      const preserved = collectPreservedPins(
        section,
        asRecord(projectJson[section]),
        forcedSection,
        fileName
      );
      if (preserved.length === 0) {
        return plan;
      }
      return {
        packageJson: {
          ...plan.packageJson,
          [section]: {
            ...forcedSection,
            ...Object.fromEntries(
              preserved.map(pin => [pin.name, pin.hostRange])
            ),
          },
        },
        notes: [...plan.notes, ...preserved.map(formatPreservedPinNote)],
      };
    },
    { packageJson: afterForce, notes: [] }
  );
}

/**
 * Find every host pin in one section that must survive Phase 1's force merge.
 * @param section - Section name, used in notes and error messages
 * @param hostSection - The host's entries for this section, pre-merge
 * @param forcedSection - The entries Phase 1 produced for this section
 * @param fileName - Basename used in error messages
 * @throws {JsonMergeError} on the first incomparable pin
 * @returns Pins whose host value must be restored
 */
function collectPreservedPins(
  section: string,
  hostSection: Record<string, unknown>,
  forcedSection: Record<string, unknown>,
  fileName: string
): readonly PreservedPin[] {
  return Object.entries(hostSection).flatMap(([name, hostValue]) => {
    const forcedValue = forcedSection[name];
    const verdict = classifyHostPin(hostValue, forcedValue);
    if (verdict === "template") {
      return [];
    }
    const pin: PreservedPin = {
      section,
      name,
      hostRange: hostValue as string,
      forcedRange: forcedValue as string,
    };
    if (verdict === "incomparable") {
      throw new JsonMergeError(fileName, formatIncomparablePinMessage(pin));
    }
    return [pin];
  });
}

/**
 * Decide what to do with one dependency where host and template disagree.
 * @param hostValue - The host's range for this dependency.
 * @param forcedValue - The range Phase 1 wrote for the same dependency.
 * @returns Which side wins, or `incomparable` when neither can be proven ahead.
 */
function classifyHostPin(hostValue: unknown, forcedValue: unknown): PinVerdict {
  if (typeof hostValue !== "string" || typeof forcedValue !== "string") {
    return "template";
  }
  const hostFloor = rangeFloor(hostValue);
  const forcedFloor = rangeFloor(forcedValue);
  if (
    hostFloor === null ||
    forcedFloor === null ||
    !semver.gt(hostFloor, forcedFloor)
  ) {
    return "template";
  }
  return rangeContains(forcedValue, hostValue) ? "host" : "incomparable";
}

/**
 * npm's exclusive-ceiling convention: the lowest possible prerelease of the
 * excluded version, so that no prerelease of it is admitted.
 */
const CEILING_PRERELEASE_SENTINEL = "-0";

/**
 * Rewrite a range's bare `<X.Y.Z` ceilings into npm's `<X.Y.Z-0` form.
 * @remarks
 * `semver` desugars `^5.0.1` to `>=5.0.1 <6.0.0-0` — the `-0` sentinel excludes
 * every prerelease of the ceiling. A hand-written `>=5.0.9 <6.0.0` carries no
 * sentinel, and since `6.0.0-0 < 6.0.0`, its interval is strictly the taller of
 * the two: it contains the points `6.0.0-0` and `6.0.0-alpha.1` that the caret
 * form excludes. `semver.subset` is pure interval algebra, so it answers `false`
 * for `subset(">=5.0.9 <6.0.0", "^5.0.1")` — correctly, for the intervals as
 * literally written. That is not a `semver` defect and there is nothing upstream
 * to wait for.
 *
 * It is still the wrong answer to the question this module is asking. Those
 * extra points are not versions any install can select: `satisfies` excludes
 * prereleases unless a comparator names the same `major.minor.patch` with its
 * own prerelease tag, so `6.0.0-alpha.1` satisfies NEITHER range. The two
 * spellings admit exactly the same installable versions, and the disagreement is
 * an artifact of which spelling the operator reached for — which is precisely
 * the symptom: `^5.0.9` was accepted while the identical interval written as
 * `>=5.0.9 <6.0.0` was refused, telling the operator the guard was broken rather
 * than the range wrong.
 *
 * `includePrerelease: true` does not fix it — it widens BOTH sides, so the
 * ceilings stay unequal and the subset test still fails. Putting both sides into
 * one convention is what makes them comparable.
 *
 * Only a bare `<` ceiling is rewritten. `<=X.Y.Z` is left alone because it
 * genuinely admits `X.Y.Z` itself, and a ceiling that already carries a
 * prerelease tag already says what it means. A range with no `<` comparator at
 * all — an unbounded `>=5.0.9`, or `*` — comes back untouched and stays
 * incomparable, which is the bite that protects a hardened floor.
 * @param range - An npm version range.
 * @returns The same range with bare exclusive ceilings carrying the sentinel.
 */
function normalizeRangeCeilings(range: string): string {
  return new semver.Range(range).set
    .map(comparators =>
      comparators.map(comparator => formatCeiling(comparator)).join(" ")
    )
    .join(" || ");
}

/**
 * Render one comparator, adding the prerelease sentinel to a bare `<` ceiling.
 * @param comparator - A single parsed comparator from a range's comparator set.
 * @returns The comparator's source text, or its sentinel-carrying equivalent.
 */
function formatCeiling(comparator: semver.Comparator): string {
  const version = comparator.semver;
  if (
    comparator.operator !== "<" ||
    version === undefined ||
    version === null ||
    version.prerelease.length > 0
  ) {
    return comparator.value;
  }
  return `<${version.major}.${version.minor}.${version.patch}${CEILING_PRERELEASE_SENTINEL}`;
}

/**
 * Decide whether every version one range admits is admitted by another.
 * @remarks
 * Both sides are put into one ceiling convention first — see
 * {@link normalizeRangeCeilings} — so that a caret and the compound range that
 * desugars to the same interval reach the same verdict. Normalizing can only
 * LOWER a bare ceiling, so it can only turn a `false` into a `true`; the
 * direction is safe here because this branch KEEPS a host pin whose floor is
 * already proven higher, and keeping a higher floor can never lower one.
 *
 * A value `semver` cannot parse at all — `"$name"` self-references, `npm:`
 * aliases, `workspace:`, `file:` and git specs — throws here and is reported as
 * "does not contain", exactly as before.
 * @param outer - The wider candidate range.
 * @param inner - The narrower candidate range.
 * @returns True when `inner` admits nothing `outer` forbids.
 */
function rangeContains(outer: string, inner: string): boolean {
  try {
    return semver.subset(
      normalizeRangeCeilings(inner),
      normalizeRangeCeilings(outer)
    );
  } catch {
    return false;
  }
}

/**
 * Format the operator-visible explanation for a preserved host pin.
 * @param pin - The pin that was kept, with both ranges
 * @returns Human-readable note for apply output
 */
function formatPreservedPinNote(pin: PreservedPin): string {
  return (
    `Kept host ${pin.section}.${pin.name} ${JSON.stringify(pin.hostRange)}: ` +
    `it admits only versions Lisa's ${JSON.stringify(pin.forcedRange)} allows ` +
    `and starts higher, so applying the template would lower the host's floor.`
  );
}

/**
 * Format the refusal for a host pin Lisa cannot prove itself ahead of.
 * @param pin - The pin that could not be decided, with both ranges
 * @returns Human-readable error message naming both ranges
 */
function formatIncomparablePinMessage(pin: PreservedPin): string {
  return (
    `${pin.section}.${pin.name} cannot be merged: the host range ` +
    `${JSON.stringify(pin.hostRange)} starts above Lisa's ` +
    `${JSON.stringify(pin.forcedRange)}, but neither range contains the other, ` +
    `so each admits versions the other forbids and Lisa cannot prove which is ` +
    `correct. Overwriting the host here is how a hardened floor gets silently ` +
    `lowered, so this apply stops instead. Reconcile the two by hand: pick one ` +
    `range in the host package.json that satisfies both constraints, or raise ` +
    `Lisa's template pin to cover the host's.`
  );
}

/**
 * Resolve the lowest version a range admits.
 * @param range - An npm version range.
 * @returns The minimum version, or null when the range is not comparable.
 */
function rangeFloor(range: string): string | null {
  try {
    return semver.minVersion(range)?.version ?? null;
  } catch {
    return null;
  }
}
