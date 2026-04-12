/**
 * Vitest Configuration - Shared Base
 *
 * Exports shared configuration pieces that can be imported by
 * project-specific vitest.config.ts files. Reduces duplication between
 * typescript, nestjs, and other project type configurations.
 *
 * Published as part of the @codyswann/lisa npm package so downstream
 * projects can import these utilities directly from the package.
 * @see https://vitest.dev/config/
 * @module configs/vitest/base
 */
import type { ViteUserConfig } from "vitest/config";

/** Vite UserConfig augmented with Vitest's `test` property */
type UserConfig = ViteUserConfig;

/**
 * Vitest coverage threshold shape — flat metrics without the `global` wrapper
 * that Jest uses. Projects store thresholds in the Jest-compatible format
 * (with `global` key) for portability; factories map to this shape internally.
 */
export interface VitestThresholds {
  readonly statements?: number;
  readonly branches?: number;
  readonly functions?: number;
  readonly lines?: number;
}

/**
 * Portable threshold format shared with Jest configs.
 * Projects use this in their threshold JSON files so the same file
 * works with both Jest (Expo/CDK) and Vitest (TypeScript/NestJS).
 */
export interface PortableThresholds {
  readonly global?: {
    readonly statements?: number;
    readonly branches?: number;
    readonly functions?: number;
    readonly lines?: number;
  };
  readonly [path: string]: unknown;
}

/**
 * Default coverage thresholds used when not specified in project config.
 * Projects can override via vitest.thresholds.json.
 */
export const defaultThresholds: PortableThresholds = {
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
 *
 * Unlike Jest's `!`-prefixed negation patterns in `collectCoverageFrom`,
 * Vitest uses separate `include`/`exclude` arrays without `!` prefixes.
 */
export const defaultCoverageExclusions: readonly string[] = [
  "**/*.d.ts",
  "**/index.ts",
  "**/node_modules/**",
  "**/dist/**",
  "**/.claude/worktrees/**",
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/*.mock.ts",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/components/ui/**",
];

/**
 * Default patterns to exclude from test discovery across all stacks.
 * Lisa manages `.claude/worktrees/` as scratch worktrees for subagents;
 * test files inside them should never be collected by the repo-level vitest run.
 */
export const defaultTestExclusions: readonly string[] = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.claude/worktrees/**",
];

/**
 * Maps portable threshold format (with `global` wrapper) to Vitest's
 * flat threshold format. Projects store thresholds in the portable
 * format so the same JSON file works for both Jest and Vitest stacks.
 * @param thresholds - Portable thresholds with `global` wrapper
 * @returns Flat Vitest thresholds object
 */
export const mapThresholds = (
  thresholds: PortableThresholds
): VitestThresholds => ({
  ...(thresholds.global?.statements !== undefined
    ? { statements: thresholds.global.statements }
    : {}),
  ...(thresholds.global?.branches !== undefined
    ? { branches: thresholds.global.branches }
    : {}),
  ...(thresholds.global?.functions !== undefined
    ? { functions: thresholds.global.functions }
    : {}),
  ...(thresholds.global?.lines !== undefined
    ? { lines: thresholds.global.lines }
    : {}),
});

/**
 * Merges project-specific threshold overrides into default thresholds.
 * Allows projects to selectively raise or lower coverage requirements
 * via vitest.thresholds.json without replacing the entire threshold object.
 *
 * Uses the portable format (with `global` wrapper) for compatibility
 * with both Jest and Vitest threshold JSON files.
 * @param defaults - Base thresholds from the stack config
 * @param overrides - Project-specific overrides from vitest.thresholds.json
 * @returns Merged thresholds with overrides taking precedence
 */
export const mergeThresholds = (
  defaults: PortableThresholds,
  overrides: PortableThresholds
): PortableThresholds => ({
  ...defaults,
  ...overrides,
  global: {
    ...(defaults.global as Record<string, number>),
    ...(overrides.global as Record<string, number>),
  },
});

/**
 * Deep merges the `test` key of multiple Vitest UserConfig objects.
 * Arrays are concatenated and deduplicated. Nested objects (like
 * `coverage`) are shallow-merged. Scalar values from later configs
 * take precedence.
 * @param configs - Vitest UserConfig objects to merge in order of precedence
 * @returns Single merged UserConfig
 */
export const mergeVitestConfigs = (...configs: UserConfig[]): UserConfig => {
  if (configs.length === 0) {
    return {};
  }

  const mergeObjects = (
    a: Record<string, unknown>,
    b: Record<string, unknown>
  ): Record<string, unknown> =>
    Object.keys(b).reduce(
      (acc, key) => {
        const accVal = acc[key];
        const bVal = b[key];

        const merged =
          Array.isArray(accVal) && Array.isArray(bVal)
            ? [...new Set([...accVal, ...bVal])]
            : typeof accVal === "object" &&
                accVal !== null &&
                !Array.isArray(accVal) &&
                typeof bVal === "object" &&
                bVal !== null &&
                !Array.isArray(bVal)
              ? {
                  ...(accVal as Record<string, unknown>),
                  ...(bVal as Record<string, unknown>),
                }
              : bVal;

        return { ...acc, [key]: merged };
      },
      { ...a }
    );

  return configs.reduce((acc, config) => {
    const accTest = (acc.test ?? {}) as Record<string, unknown>;
    const configTest = (config.test ?? {}) as Record<string, unknown>;

    return {
      ...acc,
      ...config,
      test: mergeObjects(accTest, configTest),
    };
  }, {} as UserConfig);
};
