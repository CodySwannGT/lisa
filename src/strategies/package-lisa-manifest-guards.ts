/**
 * @file package-lisa-manifest-guards.ts
 * @description Override normalization and installability guards the
 * package-lisa strategy runs on every manifest before it is persisted.
 * @module strategies
 */
import {
  asRecord,
  auditSelfReferenceRewrites,
  collectDirectDependencyNames,
  describeSelfReferenceRemedy,
  DIRECT_DEPENDENCY_SECTIONS,
  OVERRIDE_SECTIONS,
  type SelfReferenceCandidate,
  type SelfReferenceFloorConflict,
} from "../core/override-floors.js";
import { JsonMergeError } from "../errors/index.js";
import type {
  PackageJsonPlan,
  ResolvedPackageLisaTemplate,
} from "./package-lisa-types.js";

/**
 * Rewrite literal `overrides`/`resolutions` entries into npm's `"$name"`
 * self-reference form when the overridden package is also a direct dependency.
 * @remarks
 * npm rejects a manifest with `EOVERRIDE` when an `overrides`/`resolutions` key
 * that is also a direct dependency carries a literal version instead of the
 * `"$name"` self-reference — e.g. a security remediation force-bumping
 * `prettier` in `overrides` while `prettier` stays a direct devDependency. npm
 * runs this validation before doing anything, so the broken manifest fails every
 * `npx`/`npm` invocation in the project directory (including plugin MCP servers
 * spawned via `npx`), not just installs. Normalizing to `$name` — the same form
 * Lisa's own templates use (e.g. `"vite": "$vite"`) — resolves the override
 * against the direct dependency and satisfies npm, healing a hand-injected or
 * agent-injected override on the next apply without touching the project by hand.
 *
 * Only top-level string entries are rewritten: those are what trigger EOVERRIDE.
 * Existing `$name` references and nested (parent-scoped) override objects are
 * left untouched. Overrides for packages that are NOT direct dependencies are
 * also left as literals — those are legitimate transitive pins.
 * @param pkg - Merged package.json about to be persisted
 * @param fileName - Basename used in error messages
 * @throws {JsonMergeError} when a rewrite would make the effective override wider
 *   than the literal constraint it replaced.
 * @returns Planned package.json plus operator-visible notes.
 */
export function planSelfReferencingOverrideNormalization(
  pkg: Record<string, unknown>,
  fileName: string
): PackageJsonPlan {
  const audit = auditSelfReferenceRewrites(pkg);
  const refused = audit.conflicts[0];
  if (refused !== undefined) {
    throw new JsonMergeError(fileName, formatSelfReferenceRefusal(refused));
  }
  if (audit.rewritable.length === 0) {
    return { packageJson: pkg, notes: [] };
  }
  const sections = OVERRIDE_SECTIONS.flatMap(section => {
    const rewrites = audit.rewritable.filter(
      rewrite => rewrite.section === section
    );
    if (rewrites.length === 0) {
      return [];
    }
    const normalized = Object.fromEntries(
      Object.entries(asRecord(pkg[section])).map(([name, value]) =>
        rewrites.some(rewrite => rewrite.name === name)
          ? [name, `$${name}`]
          : [name, value]
      )
    );
    return [[section, normalized] as const];
  });
  return {
    packageJson: { ...pkg, ...Object.fromEntries(sections) },
    notes: audit.rewritable.map(formatSelfReferenceRewriteNote),
  };
}

/**
 * Explain a refused `$name` rewrite, ending with a remedy Lisa has TESTED.
 * @remarks
 * The old message ended "Pin the direct dependency to <the override> or choose
 * a direct range that is no wider" — advice naming no concrete range which, for
 * a bounded floor, is not satisfiable by the obvious reading of it. An operator
 * who follows a refusal's own instructions and is refused a second time
 * concludes the guard is broken rather than the range wrong
 * (CodySwannGT/lisa#3191), which is how a correct security control gets routed
 * around. The replacement names ONE range and has run it back through the same
 * predicate that produced the refusal.
 * @param conflict - The conflict that stopped the apply
 * @returns Human-readable refusal naming both ranges and the verified raise
 */
function formatSelfReferenceRefusal(
  conflict: SelfReferenceFloorConflict
): string {
  const remedy = describeSelfReferenceRemedy(conflict);
  if (conflict.verdict === "unprovable") {
    return (
      `${conflict.section}.${conflict.name} cannot be rewritten to ` +
      `"$${conflict.name}" because Lisa cannot prove the direct dependency ` +
      `range ${JSON.stringify(conflict.directRange)} is no wider than the ` +
      `literal override ${JSON.stringify(conflict.floorRange)}. ${remedy}`
    );
  }
  return (
    `${conflict.section}.${conflict.name} would widen if rewritten to ` +
    `"$${conflict.name}": the literal override ` +
    `${JSON.stringify(conflict.floorRange)} would resolve to direct ` +
    `dependency range ${JSON.stringify(conflict.directRange)}. ${remedy}`
  );
}

/**
 * Format the operator-visible explanation for a safe `$name` rewrite.
 * @param rewrite - Rewrite metadata
 * @returns Human-readable note for apply output
 */
function formatSelfReferenceRewriteNote(
  rewrite: SelfReferenceCandidate
): string {
  return (
    `Normalized ${rewrite.section}.${rewrite.name}: replaced literal ` +
    `${JSON.stringify(rewrite.floorRange)} with "$${rewrite.name}" ` +
    `resolving to direct dependency range ` +
    `${JSON.stringify(rewrite.directRange)}.`
  );
}

/**
 * Recursively collect every `$name` reference found in a single JSON value. npm
 * overrides/resolutions use a `"$name"` string value to mean "resolve to the
 * version of the direct dependency `name`", and the reference may appear at any
 * nesting depth (npm allows nested override objects).
 * @param value - JSON value to scan
 * @returns Referenced package names (without the leading `$`), possibly with dups
 */
function collectRefsFromValue(value: unknown): readonly string[] {
  if (typeof value === "string") {
    const match = /^\$(.+)$/.exec(value);
    return match?.[1] !== undefined ? [match[1]] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectRefsFromValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(collectRefsFromValue);
  }
  return [];
}

/**
 * Collect the distinct `$name` references across the given sections (typically
 * overrides and resolutions).
 * @param sections - Values to scan
 * @returns Set of referenced package names (without the leading `$`)
 */
export function collectDollarReferences(
  sections: readonly unknown[]
): Set<string> {
  return new Set(sections.flatMap(collectRefsFromValue));
}

/**
 * Collect top-level literal override keys that may later normalize to `$name`.
 * @param sections - Override/resolution sections to inspect
 * @returns Set of package names with non-empty literal string entries
 */
export function collectLiteralOverrideNames(
  sections: readonly unknown[]
): Set<string> {
  return new Set(
    sections.flatMap(section => {
      const entries = asRecord(section);
      return Object.entries(entries).flatMap(([name, value]) =>
        typeof value === "string" && value.length > 0 && !value.startsWith("$")
          ? [name]
          : []
      );
    })
  );
}

/**
 * Fail the apply when the merged package.json carries a `$name` self-reference
 * in overrides/resolutions without the backing direct dependency. Writing such
 * a file leaves a dangling $ref that passes local checks but breaks `npm ci` in
 * CI only. Throwing here surfaces the misconfiguration at apply time instead.
 * @param pkg - Merged package.json about to be written
 * @param fileName - Basename used in the error message
 * @throws {JsonMergeError} when any `$name` reference lacks a matching direct dep
 */
function assertNoDanglingDollarRefs(
  pkg: Record<string, unknown>,
  fileName: string
): void {
  const referenced = collectDollarReferences([pkg.overrides, pkg.resolutions]);
  if (referenced.size === 0) {
    return;
  }
  const directDeps = collectDirectDependencyNames(pkg);
  const missing = Array.from(referenced).filter(name => !directDeps.has(name));
  if (missing.length === 0) {
    return;
  }
  const refs = missing.map(name => `$${name}`).join(", ");
  const isPlural = missing.length > 1;
  throw new JsonMergeError(
    fileName,
    `Dangling ${refs} in overrides/resolutions: a "$name" self-reference ` +
      `requires "name" to be a direct dependency, but ${missing.join(", ")} ` +
      `${isPlural ? "are" : "is"} not present in ` +
      `dependencies/devDependencies. Add a force.devDependencies entry for ` +
      `${isPlural ? "each" : "it"} in package.lisa.json, or drop the reference.`
  );
}

/**
 * Fail the apply when a dependency section carries an unsubstituted `$name`
 * placeholder instead of a version range.
 * @remarks
 * `$name` is real npm syntax, but only as an `overrides`/`resolutions` value,
 * where it means "resolve to the version of the direct dependency `name`".
 * A dependency section is not one of those places: npm reads the value as a
 * literal dist-tag and refuses the whole manifest before doing any work —
 * `EINVALIDTAGNAME: Invalid tag name "$tar" of package "tar@$tar"`. Every
 * `npm`/`npx` in the project directory fails from then on, including the
 * plugin MCP servers Lisa spawns via `npx`.
 *
 * So a `$name` here is never a self-reference npm will resolve; it is a
 * placeholder something failed to substitute. Throwing at apply time keeps the
 * failure attached to the thing that caused it, instead of leaving an
 * uninstallable manifest for whoever runs the next install to discover.
 *
 * This also catches the reference-to-a-reference case the dangling-$ref guard
 * cannot: that check is presence-only, so `dependencies.tar = "$tar"` reads as
 * a valid backing dependency for `overrides.tar = "$tar"` even though npm can
 * resolve neither. Only dependency sections are inspected — `scripts` values
 * like `$npm_execpath` are shell variables and are left alone.
 * @param pkg - Merged package.json about to be written
 * @param fileName - Basename used in the error message
 * @throws {JsonMergeError} when any dependency section value is a `$name` token
 */
function assertNoUnsubstitutedDollarTokens(
  pkg: Record<string, unknown>,
  fileName: string
): void {
  const offenders = DIRECT_DEPENDENCY_SECTIONS.flatMap(section =>
    Object.entries(asRecord(pkg[section])).flatMap(([name, value]) =>
      typeof value === "string" && value.startsWith("$")
        ? [`${section}.${name} = ${JSON.stringify(value)}`]
        : []
    )
  );
  if (offenders.length === 0) {
    return;
  }
  const isPlural = offenders.length > 1;
  throw new JsonMergeError(
    fileName,
    `Unsubstituted placeholder${isPlural ? "s" : ""} in dependency ` +
      `${isPlural ? "sections" : "section"}: ${offenders.join(", ")}. ` +
      `A "$name" value is only valid inside overrides/resolutions, where npm ` +
      `resolves it to the version of the direct dependency "name". In ` +
      `dependencies/devDependencies/optionalDependencies/peerDependencies npm ` +
      `reads it as a literal version tag and rejects the whole manifest with ` +
      `EINVALIDTAGNAME, so every npm and npx command in the project fails. ` +
      `Replace ${isPlural ? "each placeholder" : "the placeholder"} with a real ` +
      `version range.`
  );
}

/**
 * Refuse to persist a package.json npm could not install. Single choke point:
 * every path that writes a manifest runs this, so a new writer cannot pick up
 * one half of the validation and miss the other.
 * @param pkg - Merged package.json about to be written
 * @param fileName - Basename used in error messages
 * @throws {JsonMergeError} when the manifest carries an unresolvable `$name`
 */
export function assertManifestIsInstallable(
  pkg: Record<string, unknown>,
  fileName: string
): void {
  assertNoUnsubstitutedDollarTokens(pkg, fileName);
  assertNoDanglingDollarRefs(pkg, fileName);
}

/**
 * Count the literal version floors a resolved template would write.
 *
 * A `$name` entry is not counted: it carries no floor of its own, so it can
 * never be the thing a host range resolves below.
 * @param template - Fully resolved package.lisa.json template
 * @returns Number of literal entries across force.overrides and force.resolutions
 */
export function countTemplateFloors(
  template: ResolvedPackageLisaTemplate
): number {
  return OVERRIDE_SECTIONS.reduce(
    (total, section) =>
      total +
      Object.values(asRecord(template.force[section])).filter(
        value => typeof value === "string" && !value.startsWith("$")
      ).length,
    0
  );
}
