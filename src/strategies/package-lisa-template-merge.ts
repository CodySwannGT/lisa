/**
 * @file package-lisa-template-merge.ts
 * @description Resolves the package.lisa.json templates along a project's
 * type-inheritance chain into one template, and reduces it to the security
 * pins the postinstall path may apply.
 * @module strategies
 */
import path from "node:path";

import type { ProjectType } from "../core/config.js";
import { PROJECT_TYPE_HIERARCHY, PROJECT_TYPE_ORDER } from "../core/config.js";
import { asRecord, OVERRIDE_SECTIONS } from "../core/override-floors.js";
import { deepMerge, readJsonOrNull } from "../utils/json-utils.js";
import {
  collectDollarReferences,
  collectLiteralOverrideNames,
} from "./package-lisa-manifest-guards.js";
import type {
  PackageLisaTemplate,
  ResolvedPackageLisaTemplate,
} from "./package-lisa-types.js";

/** The template every resolution starts from: every section empty. */
const EMPTY_TEMPLATE: ResolvedPackageLisaTemplate = {
  force: {},
  defaults: {},
  merge: {},
  remove: {},
  adopt: {},
};

/**
 * Load and merge all package.lisa.json templates from type hierarchy
 * @remarks
 * Inheritance chain: all → typescript → specific types (expo, nestjs, cdk, npm-package)
 * Child types override parent types in force, defaults, and merge sections.
 * Templates are read one after another, in chain order, so the first unreadable
 * template is the one that fails the resolution.
 * @param lisaDir - Root Lisa directory path
 * @param detectedTypes - Project types to load templates for
 * @returns Merged template with force, defaults, merge sections
 */
export async function loadAndMergeTemplates(
  lisaDir: string,
  detectedTypes: readonly ProjectType[]
): Promise<ResolvedPackageLisaTemplate> {
  // Process types in order: all, then typescript, then specific types
  const typesToProcess = ["all", ...expandTypeHierarchy(detectedTypes)];
  return typesToProcess.reduce<Promise<ResolvedPackageLisaTemplate>>(
    async (pending, type) => {
      const accumulator = await pending;
      const template = await readJsonOrNull<PackageLisaTemplate>(
        path.join(lisaDir, type, "package-lisa", "package.lisa.json")
      );
      // A missing template for this type is skipped; the child overrides the parent.
      return template ? mergeTemplates(accumulator, template) : accumulator;
    },
    Promise.resolve(EMPTY_TEMPLATE)
  );
}

/**
 * Expand project types to include parent types, sorted by hierarchy order
 * @remarks
 * Type hierarchy: expo/nestjs/cdk/npm-package inherit from typescript
 * This expands a list to include parents and sorts by PROJECT_TYPE_ORDER
 * so parents are processed before children (enabling child overrides).
 * Example: [cdk] → [typescript, cdk]
 * @param types - Project types detected
 * @returns Expanded types including parents, sorted parents-first
 */
function expandTypeHierarchy(types: readonly ProjectType[]): ProjectType[] {
  const parents = types.flatMap(type => {
    const parent = PROJECT_TYPE_HIERARCHY[type];
    return parent ? [parent] : [];
  });
  return Array.from(new Set<ProjectType>([...types, ...parents])).sort(
    (a, b) => PROJECT_TYPE_ORDER.indexOf(a) - PROJECT_TYPE_ORDER.indexOf(b)
  );
}

/**
 * Merge two template objects
 * Child template (override) values win in force and defaults.
 * Merge and remove arrays are concatenated without deduplication at merge time.
 * @param parent - Parent template (e.g., "all" or "typescript")
 * @param child - Child template (e.g., "expo") that overrides parent
 * @returns Merged template
 */
function mergeTemplates(
  parent: ResolvedPackageLisaTemplate,
  child: PackageLisaTemplate
): ResolvedPackageLisaTemplate {
  return {
    force: deepMerge(parent.force, child.force || {}),
    defaults: deepMerge(parent.defaults, child.defaults || {}),
    merge: mergeMergeSections(parent.merge, child.merge || {}),
    remove: mergeMergeSections(parent.remove, child.remove || {}) as Record<
      string,
      string[]
    >,
    adopt: mergeAdoptSections(parent.adopt, child.adopt || {}),
  };
}

/**
 * Merge two merge-section objects
 * Arrays are concatenated (deduplication happens later when applied to package.json)
 * @param parent - Parent merge sections
 * @param child - Child merge sections
 * @returns Merged sections, parent keys first in their original order
 */
function mergeMergeSections(
  parent: Record<string, unknown[]>,
  child: Record<string, unknown[]>
): Record<string, unknown[]> {
  return Object.entries(child).reduce<Record<string, unknown[]>>(
    (result, [key, value]) => ({
      ...result,
      [key]: key in result ? [...(result[key] as unknown[]), ...value] : value,
    }),
    { ...parent }
  );
}

/**
 * Merge two `adopt` sections, taking the UNION of the recognised values.
 * @remarks
 * Union, not child-overrides-parent as `force` and `defaults` use. Every entry
 * is a value Lisa is known to have written, and a host may have taken any of
 * them from any layer of the chain it has passed through. Dropping the parent's
 * list would stop recognising a value Lisa really did author, and the cost of
 * that is not cosmetic: the host gets warned that it customised something it
 * never touched, and stops tracking the template.
 * @param parent - Parent template's adopt section
 * @param child - Child template's adopt section
 * @returns Per-section, per-key union of the two, order-preserving and deduped
 */
function mergeAdoptSections(
  parent: Record<string, Record<string, string[]>>,
  child: Record<string, Record<string, string[]>>
): Record<string, Record<string, string[]>> {
  const sections = new Set([...Object.keys(parent), ...Object.keys(child)]);
  return Object.fromEntries(
    Array.from(sections).map(section => {
      const parentKeys = parent[section] ?? {};
      const childKeys = child[section] ?? {};
      const keys = new Set([
        ...Object.keys(parentKeys),
        ...Object.keys(childKeys),
      ]);
      return [
        section,
        Object.fromEntries(
          Array.from(keys).map(key => [
            key,
            Array.from(
              new Set([...(parentKeys[key] ?? []), ...(childKeys[key] ?? [])])
            ),
          ])
        ),
      ];
    })
  );
}

/**
 * Reduce a resolved template to only the security-critical sections —
 * `force.resolutions` and `force.overrides`, plus the retirements aimed at
 * those same two sections — dropping force.scripts, defaults, merge, and
 * every other retirement. Used during skip-git-check (postinstall) applies so
 * dependency pins still apply without clobbering host config.
 *
 * Retiring an override is as security-critical as writing one, so it travels
 * with them. Dropping it left a pin that turns out to be harmful with no way
 * to reach a host through postinstall: the template stops forcing the key,
 * but the copy already written into the host's package.json stays. That is
 * how `brace-expansion >=5.0.9` would have survived its own removal.
 * Retirements aimed at other sections stay behind, because deleting host
 * scripts or dependencies is exactly the config clobbering this path avoids.
 *
 * The retained overrides/resolutions may contain `$name` self-references or
 * literal pins that normalize to `$name` later. Both resolve against a direct
 * dependency of that name. If the restricted template drops the backing direct
 * dep, postinstall can validate against the host's wider range and fail the
 * normalization guard. So we also pull the package's forced pin from
 * force.dependencies / force.devDependencies into the restricted set.
 * @param template - Fully merged template from the type hierarchy
 * @returns Template carrying force.resolutions/force.overrides, the direct
 *   dependencies that back any direct-dependency override within them, and
 *   the retirements aimed at those same two sections
 */
export function restrictToSecurityPins(
  template: ResolvedPackageLisaTemplate
): ResolvedPackageLisaTemplate {
  const pins: Record<string, unknown> = {
    ...(template.force.resolutions === undefined
      ? {}
      : { resolutions: template.force.resolutions }),
    ...(template.force.overrides === undefined
      ? {}
      : { overrides: template.force.overrides }),
  };
  const force = { ...pins, ...backingDirectDeps(template, pins) };
  const remove = Object.fromEntries(
    OVERRIDE_SECTIONS.filter(
      section => template.remove[section] !== undefined
    ).map(section => [section, template.remove[section] as string[]])
  );
  // `adopt` reclaims a key so `defaults` can rewrite it, and `defaults` is
  // dropped here — carrying it alone would delete a host script and put
  // nothing back.
  return { force, defaults: {}, merge: {}, remove, adopt: {} };
}

/**
 * For every direct-dependency override in the restricted overrides/resolutions,
 * find the forced pin for `name` in the full template's force.dependencies /
 * force.devDependencies, so the backing direct dependency is materialized. A
 * devDependencies pin wins over dependencies when both exist.
 * @param template - Fully merged template (source of the forced dep pins)
 * @param pins - The restricted force section's overrides and resolutions
 * @returns `devDependencies` and/or `dependencies` sections to add to the
 *   restricted force section, each present only when it has an entry
 */
function backingDirectDeps(
  template: ResolvedPackageLisaTemplate,
  pins: Record<string, unknown>
): Record<string, unknown> {
  const sections = [pins.resolutions, pins.overrides];
  const referenced = Array.from(
    new Set([
      ...collectDollarReferences(sections),
      ...collectLiteralOverrideNames(sections),
    ])
  );
  const forceDeps = asRecord(template.force.dependencies);
  const forceDevDeps = asRecord(template.force.devDependencies);
  const devDeps = Object.fromEntries(
    referenced
      .filter(name => forceDevDeps[name] !== undefined)
      .map(name => [name, forceDevDeps[name]])
  );
  const deps = Object.fromEntries(
    referenced
      .filter(
        name =>
          forceDevDeps[name] === undefined && forceDeps[name] !== undefined
      )
      .map(name => [name, forceDeps[name]])
  );
  return {
    ...(Object.keys(devDeps).length > 0 ? { devDependencies: devDeps } : {}),
    ...(Object.keys(deps).length > 0 ? { dependencies: deps } : {}),
  };
}
