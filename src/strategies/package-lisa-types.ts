/**
 * @file package-lisa-types.ts
 * @description Type definitions for the package-lisa strategy
 *
 * Defines the structure of package.lisa.json template files that control
 * how package.json is merged during Lisa application.
 * @module strategies
 */

/**
 * Force merge behavior: Lisa's values completely replace project's values in this section.
 * Used for governance-critical configurations that must match Lisa's specifications exactly.
 * All keys in this section come from Lisa; project values are discarded.
 */
export interface ForceSection {
  [key: string]: unknown;
}

/**
 * Defaults merge behavior: Sets values only if the project doesn't already have them.
 * Used for sensible defaults that projects can override if needed.
 * If a key exists in the project's package.json, the project's value is preserved.
 * If a key is missing, Lisa's value is added.
 */
export interface DefaultsSection {
  [key: string]: unknown;
}

/**
 * Merge behavior: Arrays are concatenated and deduplicated.
 * Used for lists like trustedDependencies where both Lisa's and project's items should be combined.
 * Deduplication uses JSON.stringify for value equality comparison.
 */
export interface MergeSection {
  [key: string]: unknown[];
}

/**
 * Remove behavior: Keys Lisa deletes from the named package.json section.
 * Used to retire keys Lisa previously forced (e.g. a renamed script) so they
 * don't linger in downstream projects forever. Applied after force/defaults/
 * merge, so a removed key cannot be reintroduced by an earlier phase in the
 * same apply. Each entry maps a package.json section (e.g. "scripts") to the
 * list of keys to delete from it.
 */
export interface RemoveSection {
  [key: string]: string[];
}

/**
 * Adopt behavior: values Lisa itself previously wrote into a key it has since
 * handed back to the host.
 *
 * A `force` key that a host must be able to EXTEND cannot stay forced — every
 * apply would delete the extension. Moving it to `defaults` protects the
 * extension but freezes every host that never customised it on whatever literal
 * their last apply left behind, because `defaults` never overwrites.
 *
 * `adopt` is the bridge. Each entry lists the values Lisa is known to have
 * written into that key itself. A host sitting on one of them has provably NOT
 * customised it, so Lisa discards it and lets `defaults` install the current
 * value; any other value is the host's own and is kept. Applied between force
 * and defaults, so the default it clears the way for lands in the same apply.
 *
 * Each entry maps a package.json section (e.g. "scripts") to a map of key to
 * the Lisa-authored values recognised for that key. The list is cumulative:
 * whenever a governed value changes, the value being replaced stays in the list
 * so a host that skipped a release is still recognised rather than warned at.
 */
export interface AdoptSection {
  [key: string]: Record<string, string[]>;
}

/**
 * Template structure for package.lisa.json files
 * @remarks
 * - `force`: Sections where Lisa's values completely replace project's values
 * - `defaults`: Sections where project's values take precedence if they exist
 * - `merge`: Array sections that are concatenated and deduplicated
 * - `remove`: Section keys Lisa deletes from the project (retired keys)
 * - `adopt`: Section keys whose Lisa-authored values are reclaimed so
 *   `defaults` can install the current one
 *
 * When multiple package.lisa.json files are loaded from the inheritance chain (all → typescript → specific),
 * they are merged with child types overriding parent types in each section.
 * @example
 * ```json
 * {
 *   "force": {
 *     "scripts": {
 *       "lint": "eslint . --quiet",
 *       "test": "jest"
 *     },
 *     "devDependencies": {
 *       "eslint": "^9.0.0"
 *     }
 *   },
 *   "defaults": {
 *     "engines": {
 *       "node": "22.x"
 *     }
 *   },
 *   "merge": {
 *     "trustedDependencies": ["@ast-grep/cli"]
 *   },
 *   "remove": {
 *     "scripts": ["knip"]
 *   },
 *   "adopt": {
 *     "scripts": { "lint": ["eslint . --quiet"] }
 *   }
 * }
 * ```
 */
export interface PackageLisaTemplate {
  /** Sections where Lisa's values completely replace project's values */
  force?: Record<string, unknown>;

  /** Sections where project's values are preserved (only set if missing) */
  defaults?: Record<string, unknown>;

  /** Array sections that are concatenated and deduplicated */
  merge?: Record<string, unknown[]>;

  /** Section keys Lisa deletes from the project (retired keys) */
  remove?: Record<string, string[]>;

  /** Section keys whose Lisa-authored values are reclaimed before defaults */
  adopt?: Record<string, Record<string, string[]>>;
}

/**
 * Merged template with resolved force/defaults/merge/remove/adopt sections
 * ready to be applied to a project's package.json
 */
export interface ResolvedPackageLisaTemplate extends PackageLisaTemplate {
  force: Record<string, unknown>;
  defaults: Record<string, unknown>;
  merge: Record<string, unknown[]>;
  remove: Record<string, string[]>;
  adopt: Record<string, Record<string, string[]>>;
}
