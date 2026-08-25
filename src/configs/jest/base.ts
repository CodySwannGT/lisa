/**
 * Jest Configuration - Shared Base
 *
 * Exports shared configuration pieces that can be imported by
 * project-specific jest.config.ts files. Reduces duplication between
 * typescript, expo, nestjs, and other project type configurations.
 *
 * Published as part of the @codyswann/lisa npm package so downstream
 * projects can import these utilities directly from the package.
 * @see https://jestjs.io/docs/configuration
 * @module configs/jest/base
 */
import type { Config } from "jest";
import { isUnitCoverageScope } from "../coverage-scope.js";
import { isInsideWorktree } from "../worktrees.js";

/**
 * Default coverage thresholds used when not specified in project config.
 * Projects can override via jest.thresholds.json.
 */
export const defaultThresholds: Config["coverageThreshold"] = {
  global: {
    statements: 70,
    branches: 70,
    functions: 70,
    lines: 70,
  },
};

/**
 * Returns the extra `testPathIgnorePatterns` entries a stack config
 * should add to skip tests that live inside an agent worktree.
 *
 * Both roots must be covered — `.claude/worktrees/` and the bare
 * `.worktrees/`. Omitting the second let sibling worktrees dominate test
 * discovery from the primary checkout (one host project measured 13,821 of
 * 14,277 collected files coming from other branches' worktrees), so the local
 * suite reported other agents' in-flight failures instead of this checkout's.
 *
 * When jest runs from the primary checkout, tests inside worktrees
 * should be skipped — each worktree has its own jest run. When jest
 * runs from INSIDE a worktree (rootDir *is* the worktree), the same
 * patterns would match every test path and jest would find zero tests.
 * This helper returns the patterns only when the current working
 * directory is outside a worktree, so each stack can spread them into
 * its own `testPathIgnorePatterns` without hand-rolling the conditional.
 * @returns The worktree ignore patterns, or an empty array when already inside a worktree.
 */
export function worktreeTestPathIgnorePatterns(): readonly string[] {
  return isInsideWorktree() ? [] : ["/.claude/worktrees/", "/.worktrees/"];
}

/**
 * Default patterns to exclude from coverage collection.
 * Common across all stacks — stack-specific configs extend this list.
 */
export const defaultCoverageExclusions: readonly string[] = [
  "!**/*.d.ts",
  "!**/index.ts",
  "!**/node_modules/**",
  "!**/dist/**",
  "!**/*.test.ts",
  "!**/*.spec.ts",
  "!**/*.mock.ts",
  "!**/test/**",
  "!**/tests/**",
  "!**/__tests__/**",
  "!**/__mocks__/**",
  "!**/components/ui/**",
];

/**
 * Merges project-specific threshold overrides into default thresholds.
 * Allows projects to selectively raise or lower coverage requirements
 * via jest.thresholds.json without replacing the entire threshold object.
 *
 * Spreads all top-level keys from both defaults and overrides (including
 * per-path/per-file patterns like `"./src/api/": { branches: 80 }`).
 * The `global` key receives special treatment: its properties are
 * shallow-merged so individual metrics can be overridden without
 * replacing the entire global object.
 *
 * The `unit` key is the second special case: it is the floor for a unit-scoped
 * run, applied over the effective `global` only when the process is one, and
 * stripped from the result either way so Jest never treats it as a path.
 * @param defaults - Base thresholds from the stack config
 * @param overrides - Project-specific overrides from jest.thresholds.json
 * @returns Merged thresholds with overrides taking precedence
 */
export const mergeThresholds = (
  defaults: Config["coverageThreshold"],
  overrides: Config["coverageThreshold"]
): Config["coverageThreshold"] => {
  // Cast to a record before destructuring: Jest's `coverageThreshold` type is a
  // union whose empty-object arm has no index signature, so `unit` is not
  // nameable on it even though the shape permits any key.
  const { unit: _defaultUnit, ...restDefaults } = (defaults ?? {}) as Record<
    string,
    unknown
  >;
  const { unit: overrideUnit, ...restOverrides } = (overrides ?? {}) as Record<
    string,
    unknown
  >;
  const global = {
    ...(defaults?.global as Record<string, number>),
    ...(overrides?.global as Record<string, number>),
  };
  return {
    ...restDefaults,
    ...restOverrides,
    // See the vitest twin: layered over the EFFECTIVE global floor so a raised
    // global is never quietly lowered, and stripped so Jest never reads `unit`
    // as a path pattern.
    global: isUnitCoverageScope()
      ? { ...global, ...(overrideUnit as Record<string, number>) }
      : global,
  };
};

/**
 * Merges multiple Jest configs together with array concatenation and
 * shallow object merging. Later configs take precedence for scalar values.
 * Arrays are concatenated and deduplicated to allow additive composition.
 * @param configs - Jest config objects to merge in order of precedence
 * @returns Single merged Jest config
 * @remarks Used by entry-point jest.config.ts files to combine stack config
 * with project-local overrides without losing array values like testMatch
 * or collectCoverageFrom.
 */
export const mergeConfigs = (...configs: Config[]): Config =>
  configs.reduce(
    (acc, config) =>
      (Object.keys(config) as (keyof Config)[]).reduce((merged, key) => {
        const accVal = acc[key];
        const configVal = config[key];

        const mergedValue =
          Array.isArray(accVal) && Array.isArray(configVal)
            ? [...new Set([...accVal, ...configVal])]
            : typeof accVal === "object" &&
                accVal !== null &&
                !Array.isArray(accVal) &&
                typeof configVal === "object" &&
                configVal !== null &&
                !Array.isArray(configVal)
              ? {
                  ...(accVal as Record<string, unknown>),
                  ...(configVal as Record<string, unknown>),
                }
              : configVal;

        return { ...merged, [key]: mergedValue };
      }, acc),
    {} as Config
  );
