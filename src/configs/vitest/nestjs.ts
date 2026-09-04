/**
 * Vitest Configuration - NestJS Stack
 *
 * Provides NestJS-specific Vitest configuration with extensive coverage
 * exclusions for generated files, DTOs, entities, and modules.
 *
 * Inheritance chain:
 *   nestjs.ts (this file)
 *   +-- base.ts
 * @see https://vitest.dev/config/
 * @module configs/vitest/nestjs
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

// Re-export base utilities for entry-point configs
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
 * Options for configuring the NestJS Vitest config factory.
 */
interface NestjsVitestOptions {
  /** Coverage thresholds in portable format (merged defaults + project overrides) */
  readonly thresholds?: PortableThresholds;
}

/**
 * NestJS-specific patterns excluded from coverage collection.
 * These are generated or boilerplate files that don't benefit from coverage tracking.
 */
const nestjsCoverageExclusions: readonly string[] = [
  ...defaultCoverageExclusions,
  "**/*.entity.ts",
  "**/*.dto.ts",
  "**/*.input.ts",
  "**/*.args.ts",
  "**/*.model.ts",
  "**/*.module.ts",
  "**/*.factory.ts",
  "**/*.enum.ts",
  "**/*.interface.ts",
  "**/*.constants.ts",
  "**/database/migrations/**",
  "**/database/seeds/**",
  "**/graphql/**",
  "**/main.ts",
];

/**
 * Creates a Vitest configuration for NestJS projects.
 *
 * Unlike the Jest equivalent, no `ts-jest` with `tsconfig.spec.json` is needed —
 * Vitest transforms TypeScript natively via esbuild. Path aliases should be
 * configured via `vite-tsconfig-paths` plugin in the project's vitest.config.local.ts.
 * @param options - Configuration options for threshold overrides
 * @param options.thresholds - Coverage thresholds in portable format
 * @returns Vitest UserConfig object with node environment and NestJS-specific exclusions
 */
export const getNestjsVitestConfig = ({
  thresholds = defaultThresholds,
}: NestjsVitestOptions = {}): UserConfig => ({
  test: {
    setupFiles: [...scratchSetupFiles()],
    globalSetup: [...scratchGlobalSetup(), ...coverageGlobalSetup()],
    sequence: { setupFiles: "list", hooks: "stack" },
    // Bounded so k concurrent runs do not claim k x cores. See resolveMaxWorkers.
    maxWorkers: resolveMaxWorkers(),
    globals: true,
    environment: "node",
    root: "src",
    include: ["**/*.spec.ts"],
    exclude: [...defaultTestExclusions, ...worktreeExclusions()],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      // Per-run, so a sibling run in this checkout cannot delete this
      // run's live scratch. See configs/vitest/coverage-reports-directory.
      reportsDirectory: coverageReportsDirectory(),
      include: ["**/*.ts"],
      exclude: [...nestjsCoverageExclusions, ...worktreeExclusions()],
      thresholds: mapThresholds(thresholds),
    },
  },
});
