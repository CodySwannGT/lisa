/**
 * Vitest Configuration - Shared Base
 *
 * Exports shared configuration pieces that can be imported by
 * project-specific vitest.config.ts files. Reduces duplication between
 * typescript, nestjs, and other project type configurations.
 *
 * Published as part of the `@codyswann/lisa` npm package so downstream
 * projects can import these utilities directly from the package.
 * @see https://vitest.dev/config/
 * @module configs/vitest/base
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ViteUserConfig } from "vitest/config";
import { isUnitCoverageScope } from "../coverage-scope.js";
import { isInsideWorktree } from "../worktrees.js";

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
  /**
   * The floor a unit-scoped run answers to, layered over `global`.
   *
   * Never reaches the runner under this name — `mergeThresholds` folds it into
   * `global` when the scope is unit and strips it either way, because both
   * runners read any non-`global` key as a path or glob and would go looking
   * for a directory called `unit`. That is a threshold that is not enforced and
   * does not complain, which is worse than one that errors.
   */
  readonly unit?: {
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
 *
 * The `.claude/worktrees/` exclusion is intentionally NOT baked in here —
 * it is cwd-conditional and supplied by {@link worktreeExclusions} so that
 * a vitest run launched from INSIDE a worktree can still discover its own
 * tests. Stack factories spread `worktreeExclusions()` alongside this list.
 */
export const defaultTestExclusions: readonly string[] = [
  "**/node_modules/**",
  "**/dist/**",
];

/**
 * Returns the worktree exclusion globs a stack config should add to skip
 * test files / coverage that live inside an agent worktree.
 *
 * Lisa manages scratch worktrees for subagents under TWO roots —
 * `.claude/worktrees/` and a bare `.worktrees/` — and both must be covered.
 * Omitting the second one let sibling worktrees dominate test discovery from
 * the primary checkout (one host project measured 13,821 of 14,277 collected
 * files coming from other branches' worktrees), so the local suite reported
 * other agents' in-flight failures instead of this checkout's.
 *
 * When vitest runs from the primary checkout, tests inside those worktrees
 * should be skipped — each worktree has its own vitest run. When vitest runs
 * from INSIDE a worktree (the project root *is* the worktree), the same globs
 * match every path under root and vitest finds zero tests. This returns the
 * globs only when the current working directory is outside a worktree, so each
 * stack factory can spread them into its `exclude` arrays without hand-rolling
 * the conditional. Mirrors jest's `worktreeTestPathIgnorePatterns()`.
 * @returns The worktree exclude globs, or an empty array when already inside a worktree.
 */
export function worktreeExclusions(): readonly string[] {
  return isInsideWorktree()
    ? []
    : ["**/.claude/worktrees/**", "**/.worktrees/**"];
}

/**
 * Resolves a sibling module of this file to an absolute path Vitest can load.
 *
 * `setupFiles` and `globalSetup` take file paths rather than functions, and this
 * module is consumed from two places with different extensions: downstream
 * projects import the compiled `dist/` copy, while Lisa's own unit tests import
 * the `src/` TypeScript directly. Probing for the built file first and falling
 * back to the source keeps one wiring correct on both.
 * @param basename - Sibling module name without extension
 * @returns Absolute path to the module.
 */
const resolveScratchModule = (basename: string): string => {
  const built = fileURLToPath(new URL(`./${basename}.js`, import.meta.url));
  return existsSync(built)
    ? built
    : fileURLToPath(new URL(`./${basename}.ts`, import.meta.url));
};

/**
 * Setup files that bound and reclaim the suite's temporary directories.
 *
 * Every stack factory spreads this. Without it, each fixture's
 * `mkdtemp(os.tmpdir())` lands directly in the shared platform temp root, which
 * is never emptied while the machine is up and which no in-process cleanup can
 * protect once the runner is killed.
 * @returns Absolute paths to spread into `test.setupFiles`.
 * @see {@link module:configs/vitest/scratch} for the measurements behind this
 */
export function scratchSetupFiles(): readonly string[] {
  return [
    resolveScratchModule("scratch-setup"),
    resolveScratchModule("scratch-leak-setup"),
  ];
}

/**
 * Global setup that reclaims residue before a run and audits the namespace after it.
 * @returns Absolute paths to spread into `test.globalSetup`.
 */
export function scratchGlobalSetup(): readonly string[] {
  return [resolveScratchModule("scratch-global-setup")];
}

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
 *
 * A `unit` block in the overrides is the floor for a unit-scoped run, and is
 * applied only when {@link isUnitCoverageScope} says this process is one. It is
 * layered over the EFFECTIVE global floor rather than over the stack default,
 * so a project that raised its global and declared no unit block keeps the
 * higher number. It is stripped from the result either way: both runners read a
 * non-`global` key as a path glob, and a surviving `unit` key would become a
 * threshold that is never enforced and never complains.
 * @param defaults - Base thresholds from the stack config
 * @param overrides - Project-specific overrides from vitest.thresholds.json
 * @returns Merged thresholds with overrides taking precedence
 */
export const mergeThresholds = (
  defaults: PortableThresholds,
  overrides: PortableThresholds
): PortableThresholds => {
  const { unit: _defaultUnit, ...restDefaults } = defaults;
  const { unit: overrideUnit, ...restOverrides } = overrides;
  const global = {
    ...(defaults.global as Record<string, number>),
    ...(overrides.global as Record<string, number>),
  };
  return {
    ...restDefaults,
    ...restOverrides,
    // Layered over the effective global floor, not over Lisa's default one: a
    // project that raised its global and declared no unit block must keep the
    // higher number, or a "scope fix" would silently hand it a lower bar.
    global: isUnitCoverageScope()
      ? { ...global, ...(overrideUnit as Record<string, number>) }
      : global,
  };
};

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
