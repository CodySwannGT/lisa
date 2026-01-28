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
 * Template structure for package.lisa.json files
 * @remarks
 * - `force`: Sections where Lisa's values completely replace project's values
 * - `defaults`: Sections where project's values take precedence if they exist
 * - `merge`: Array sections that are concatenated and deduplicated
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
}

/**
 * Merged template with resolved force/defaults/merge sections
 * ready to be applied to a project's package.json
 */
export interface ResolvedPackageLisaTemplate extends PackageLisaTemplate {
  force: Record<string, unknown>;
  defaults: Record<string, unknown>;
  merge: Record<string, unknown[]>;
}
