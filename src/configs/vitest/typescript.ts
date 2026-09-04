/**
 * Vitest Configuration - TypeScript Stack
 *
 * Provides TypeScript/Node-specific Vitest configuration.
 * Imports shared utilities from the base module.
 * @see https://vitest.dev/config/
 * @module configs/vitest/typescript
 */
import type { ViteUserConfig } from "vitest/config";

/** Vite UserConfig augmented with Vitest's `test` property */
type UserConfig = ViteUserConfig;

import {
  coverageGlobalSetup,
  coverageReportsDirectory,
  defaultCoverageExclusions,
  defaultTestExclusions,
  defaultThresholds,
  mapThresholds,
  mergeThresholds,
  mergeVitestConfigs,
  resolveMaxWorkers,
  scratchGlobalSetup,
  scratchSetupFiles,
  worktreeExclusions,
} from "./base.js";

import type { PortableThresholds } from "./base.js";

// Re-export base utilities for stack-specific configs to use
export {
  coverageGlobalSetup,
  coverageReportsDirectory,
  defaultCoverageExclusions,
  defaultTestExclusions,
  defaultThresholds,
  mapThresholds,
  mergeThresholds,
  mergeVitestConfigs,
  resolveMaxWorkers,
  scratchGlobalSetup,
  scratchSetupFiles,
  worktreeExclusions,
};

export type { PortableThresholds };

/**
 * Options for configuring the TypeScript Vitest config factory.
 */
interface TypescriptVitestOptions {
  /** Coverage thresholds in portable format (merged defaults + project overrides) */
  readonly thresholds?: PortableThresholds;
}

/**
 * Creates a Vitest configuration for TypeScript/Node projects.
 *
 * Unlike the Jest equivalent, no `ts-jest` or `moduleNameMapper` is needed —
 * Vitest transforms TypeScript natively via esbuild and resolves `.ts` files
 * without extension mapping.
 * @param options - Configuration options for threshold overrides
 * @param options.thresholds - Coverage thresholds in portable format
 * @returns Vitest UserConfig object
 */
export const getTypescriptVitestConfig = ({
  thresholds = defaultThresholds,
}: TypescriptVitestOptions = {}): UserConfig => ({
  test: {
    setupFiles: [...scratchSetupFiles()],
    globalSetup: [...scratchGlobalSetup(), ...coverageGlobalSetup()],
    sequence: { setupFiles: "list", hooks: "stack" },
    // Bounded so k concurrent runs do not claim k x cores. See resolveMaxWorkers.
    maxWorkers: resolveMaxWorkers(),
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: [...defaultTestExclusions, ...worktreeExclusions()],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      // Per-run, so a sibling run in this checkout cannot delete this
      // run's live scratch. See configs/vitest/coverage-reports-directory.
      reportsDirectory: coverageReportsDirectory(),
      include: ["src/**/*.ts"],
      exclude: [...defaultCoverageExclusions, ...worktreeExclusions()],
      thresholds: mapThresholds(thresholds),
    },
  },
});
