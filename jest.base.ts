/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Jest Configuration - Shared Base
 *
 * Exports shared configuration pieces that can be imported by
 * project-specific jest.config.ts files. Reduces duplication between
 * typescript, expo, nestjs, and other project type configurations.
 *
 * @see https://jestjs.io/docs/configuration
 * @module jest.base
 */
import type { Config } from "jest";

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
 * @param defaults - Base thresholds from the stack config
 * @param overrides - Project-specific overrides from jest.thresholds.json
 * @returns Merged thresholds with overrides taking precedence
 */
export const mergeThresholds = (
  defaults: Config["coverageThreshold"],
  overrides: Config["coverageThreshold"]
): Config["coverageThreshold"] => ({
  ...defaults,
  ...overrides,
  global: {
    ...(defaults?.global as Record<string, number>),
    ...(overrides?.global as Record<string, number>),
  },
});

/**
 * Merges multiple Jest configs together with array concatenation and
 * shallow object merging. Later configs take precedence for scalar values.
 * Arrays are concatenated and deduplicated to allow additive composition.
 *
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
