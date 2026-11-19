/**
 * @file package-lisa-template-apply.ts
 * @description Applies a resolved package.lisa.json template to a host
 * package.json: force, adopt, defaults, merge and remove, then the Lisa pin and
 * the operator notes.
 * @module strategies
 */
import { asRecord } from "../core/override-floors.js";
import { deepMerge } from "../utils/json-utils.js";
import { deduplicateArrays } from "./deduplicate-arrays.js";
import {
  detectHostPackageManager,
  fitDevEnginesToHost,
  retireDevEnginesFloor,
} from "./package-lisa-dev-engines.js";
import { preserveHigherHostPins } from "./package-lisa-host-pins.js";
import { alignLisaPin } from "./package-lisa-pin-alignment.js";
import { describeScriptChanges } from "./package-lisa-script-notes.js";
import type {
  PackageJsonPlan,
  ResolvedPackageLisaTemplate,
} from "./package-lisa-types.js";

/** The manifest name used in error messages. */
const PACKAGE_JSON = "package.json";

/** Sections whose keys name packages a host's code may import. */
const DEPENDENCY_SECTIONS: ReadonlySet<string> = new Set([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]);

/**
 * Every package a manifest declares, in any dependency section.
 * @param projectJson - Host package.json as read
 * @returns Package names, each at most once
 */
export function declaredDependencies(
  projectJson: Record<string, unknown>
): readonly string[] {
  return [
    ...new Set(
      [...DEPENDENCY_SECTIONS].flatMap(section =>
        Object.keys(asRecord(projectJson[section]))
      )
    ),
  ];
}

/**
 * Dependencies an `adopt` entry would delete, before the mention check runs.
 * @remarks
 * Only these are worth asking git about: a key the template forces is never
 * reclaimed, and one holding a value Lisa did not write is the host's own.
 * @param projectJson - Host package.json as read
 * @param template - Resolved template carrying the adopt section
 * @returns Package names, each at most once
 */
export function adoptableDependencies(
  projectJson: Record<string, unknown>,
  template: ResolvedPackageLisaTemplate
): readonly string[] {
  const names = Object.entries(template.adopt)
    .filter(([sectionName]) => DEPENDENCY_SECTIONS.has(sectionName))
    .flatMap(([sectionName, recognised]) => {
      const forcedHere = asRecord(asRecord(template.force)[sectionName]);
      return Object.entries(asRecord(projectJson[sectionName])).flatMap(
        ([key, value]) =>
          typeof value === "string" &&
          !(key in forcedHere) &&
          (recognised[key] ?? []).includes(value)
            ? [key]
            : []
      );
    });
  return [...new Set(names)];
}

/**
 * Apply the template after fitting its forced package-manager floor to the
 * host's manager, so a bun host never receives an npm floor (#4848).
 * @param projectJson - Current project's package.json
 * @param template - Merged package.lisa.json template
 * @param restricted - True when the template was reduced to security pins
 * @param projectDir - Host directory, or undefined when no tree is available
 * @param readApplyingVersion - Reports the Lisa version performing the apply
 * @param invokingPackageManager - Manager that launched this apply, if any
 * @param mentioned - Packages the host names outside its manifest, which a
 *   dependency `adopt` entry must never delete
 * @returns Modified package.json plus operator-visible notes
 */
export function applyHostFittedTemplate(
  projectJson: Record<string, unknown>,
  template: ResolvedPackageLisaTemplate,
  restricted: boolean,
  projectDir: string | undefined,
  readApplyingVersion: () => string,
  invokingPackageManager: string | undefined,
  mentioned: ReadonlySet<string>
): PackageJsonPlan {
  const fitted = fitDevEnginesToHost(
    template,
    detectHostPackageManager(projectDir, projectJson, invokingPackageManager),
    projectJson
  );
  const applied = applyTemplate(
    projectJson,
    fitted.template,
    PACKAGE_JSON,
    restricted,
    readApplyingVersion,
    mentioned
  );
  return fitted.retire
    ? { ...applied, packageJson: retireDevEnginesFloor(applied.packageJson) }
    : applied;
}

/**
 * Apply force/defaults/merge/remove logic to project's package.json
 * @remarks
 * Processing order:
 * 1. Apply force: Deep merge with Lisa values winning (entire section replaced)
 * 2. Apply defaults: Deep merge with project values winning (only set if missing)
 * 3. Apply merge: Concatenate arrays and deduplicate
 * 4. Apply remove: Delete retired keys from their sections (runs last so an
 *    earlier phase cannot reintroduce a removed key)
 * @param projectJson - Current project's package.json
 * @param template - Merged package.lisa.json template
 * @param fileName - Basename used in error messages
 * @param restricted - True when the template was reduced to security pins,
 *   which is the postinstall path and Lisa's own repository
 * @param readApplyingVersion - Reports the Lisa version performing the apply;
 *   only called on an unrestricted apply
 * @param mentioned - Packages the host names outside its manifest. Omitted,
 *   every package counts as mentioned and no dependency is reclaimed.
 * @returns Modified package.json plus operator-visible notes
 */
export function applyTemplate(
  projectJson: Record<string, unknown>,
  template: ResolvedPackageLisaTemplate,
  fileName: string,
  restricted: boolean,
  readApplyingVersion: () => string,
  mentioned?: ReadonlySet<string>
): PackageJsonPlan {
  // Phase 1: Apply force (Lisa's values completely replace project's), then
  // restore any dependency pin the host had raised ABOVE Lisa's floor.
  const afterForce = preserveHigherHostPins(
    projectJson,
    deepMerge(projectJson, template.force as Record<string, unknown>),
    fileName
  );

  // Phase 1.5: Reclaim keys still carrying a value Lisa itself wrote, so the
  // defaults phase can install the current one. A host value Lisa does not
  // recognise as its own is left alone — that is the whole point.
  const afterAdopt = applyAdoptSections(
    afterForce.packageJson,
    template,
    name => mentioned === undefined || mentioned.has(name)
  );

  // Phase 2: Apply defaults (project's values preserved, Lisa provides fallback)
  const afterDefaults = deepMerge(
    template.defaults as Record<string, unknown>,
    afterAdopt
  );

  // Phase 3: Apply merge (concatenate and deduplicate arrays)
  const afterMerge = applyMergeSections(afterDefaults, template.merge);

  // Phase 4: Apply remove (delete retired keys from their sections)
  const afterRemove = applyRemoveSections(afterMerge, template.remove);

  // Phase 5: Make the host's pin name the version that wrote these templates.
  // A restricted apply is the postinstall path, where the installed package
  // IS the applying version, so there is nothing to reconcile — and rewriting
  // the host's manifest from inside their `install` is not this phase's to do.
  const pinned = restricted
    ? { packageJson: afterRemove, notes: [] }
    : alignLisaPin(afterRemove, readApplyingVersion());

  // Phase 6: Say out loud what the host lost, and which gates nothing runs.
  return {
    packageJson: pinned.packageJson,
    notes: [
      ...afterForce.notes,
      ...pinned.notes,
      ...describeScriptChanges(projectJson, pinned.packageJson, template),
    ],
  };
}

/**
 * Drop every key still carrying a value Lisa itself wrote.
 * @remarks
 * The deletion is what lets the `defaults` phase, which never overwrites, reach
 * a key Lisa used to force. Nothing else is touched: a value absent from the
 * adopt list is the host's own work by definition, and keeping it is the entire
 * behaviour this exists to provide.
 *
 * A dependency needs one more proof than a script. Keeping the version Lisa
 * wrote says nothing about whether the host imports the package, so a
 * dependency key is cleared only when the host also never mentions it
 * (CodySwannGT/lisa#4932, `package-mentions.ts`).
 * @param packageJson - The document as the force phase left it
 * @param template - Resolved template carrying the adopt section
 * @param isMentioned - Whether the host names a package outside its manifest
 * @returns The document with Lisa-authored values cleared
 */
function applyAdoptSections(
  packageJson: Record<string, unknown>,
  template: ResolvedPackageLisaTemplate,
  isMentioned: (name: string) => boolean
): Record<string, unknown> {
  return Object.entries(template.adopt).reduce<Record<string, unknown>>(
    (document, [sectionName, recognised]) => {
      const section = document[sectionName];
      if (!isPlainSection(section)) {
        return document;
      }
      // A key the template also FORCES already holds Lisa's current value.
      // Clearing it would delete what force just wrote and leave the key to
      // whatever `defaults` happens to carry — so force wins, and adopt is a
      // no-op there. Adopt only has meaning for a key Lisa has handed back.
      const forcedHere = asRecord(asRecord(template.force)[sectionName]);
      const guarded = DEPENDENCY_SECTIONS.has(sectionName);
      const entries = Object.entries(section);
      const kept = entries.filter(
        ([key, value]) =>
          typeof value !== "string" ||
          key in forcedHere ||
          !(recognised[key] ?? []).includes(value) ||
          (guarded && isMentioned(key))
      );
      if (kept.length === entries.length) {
        return document;
      }
      return { ...document, [sectionName]: Object.fromEntries(kept) };
    },
    packageJson
  );
}

/**
 * Is this package.json value a section object whose keys can be edited?
 * @param section - The value found under a section name
 * @returns True for a plain, non-null, non-array object
 */
function isPlainSection(section: unknown): section is Record<string, unknown> {
  return (
    section !== null && typeof section === "object" && !Array.isArray(section)
  );
}

/**
 * Delete retired keys from their package.json sections
 * @remarks
 * Used to clean up keys Lisa previously forced and has since renamed or
 * retired (e.g. the "knip" script renamed to "knip:check"). Runs after
 * force/defaults/merge so a removed key cannot be reintroduced within the
 * same apply. Sections that don't exist or aren't objects are left alone.
 * @param packageJson - Current package.json after force/defaults/merge applied
 * @param removeSections - Map of section name to keys to delete from it
 * @returns Package.json with retired keys removed
 */
function applyRemoveSections(
  packageJson: Record<string, unknown>,
  removeSections: Record<string, string[]>
): Record<string, unknown> {
  return Object.entries(removeSections).reduce<Record<string, unknown>>(
    (result, [sectionName, keysToRemove]) => {
      const section = result[sectionName];
      // A missing or falsy section, or one that is not a plain object, has
      // nothing to remove.
      if (!section || !isPlainSection(section)) {
        return result;
      }
      const cleaned = Object.fromEntries(
        Object.entries(section).filter(([key]) => !keysToRemove.includes(key))
      );
      return { ...result, [sectionName]: cleaned };
    },
    { ...packageJson }
  );
}

/**
 * Apply merge-section arrays to package.json
 * Concatenates Lisa's items and project's items, deduplicated by JSON.stringify equality.
 * @param packageJson - Current package.json after force/defaults applied
 * @param mergeSections - Merge sections from template
 * @returns Package.json with merge sections applied
 */
function applyMergeSections(
  packageJson: Record<string, unknown>,
  mergeSections: Record<string, unknown[]>
): Record<string, unknown> {
  return Object.entries(mergeSections).reduce<Record<string, unknown>>(
    (result, [key, lisaItems]) => {
      const projectItems = (result[key] as unknown[]) || [];
      // A field that exists but is not an array is replaced with Lisa's items;
      // otherwise Lisa's items come first, then the project's unique items.
      const merged = Array.isArray(projectItems)
        ? deduplicateArrays(lisaItems, projectItems)
        : lisaItems;
      return { ...result, [key]: merged };
    },
    { ...packageJson }
  );
}
