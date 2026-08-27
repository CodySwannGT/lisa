/**
 * Vitest Configuration - CDK Stack
 *
 * Provides AWS CDK-specific Vitest configuration targeting
 * the test/ directory with test/spec and integration-test/integration-spec patterns.
 *
 * Inheritance chain:
 *   cdk.ts (this file)
 *   +-- base.ts
 * @see https://vitest.dev/config/
 * @module configs/vitest/cdk
 */
import type { ViteUserConfig } from "vitest/config";

/** Vite UserConfig augmented with Vitest's `test` property */
type UserConfig = ViteUserConfig;

import {
  defaultCoverageExclusions,
  defaultTestExclusions,
  defaultThresholds,
  mapThresholds,
  mergeThresholds,
  mergeVitestConfigs,
  scratchGlobalSetup,
  scratchSetupFiles,
} from "./base.js";

import type { PortableThresholds } from "./base.js";

/** Prefix used by AWS CDK's default CloudAssemblyBuilder output directory. */
export const CDK_SCRATCH_PREFIX = "cdk.out";

/** Opaque owner label recorded before a CDK suite is collected. */
export const CDK_SCRATCH_SUITE = "cdk";

// Re-export base utilities for entry-point configs
export {
  defaultCoverageExclusions,
  defaultTestExclusions,
  defaultThresholds,
  mapThresholds,
  mergeThresholds,
  mergeVitestConfigs,
  scratchGlobalSetup,
  scratchSetupFiles,
};

export type { PortableThresholds };

/**
 * Options for configuring the CDK Vitest config factory.
 */
interface CdkVitestOptions {
  /** Coverage thresholds in portable format (merged defaults + project overrides) */
  readonly thresholds?: PortableThresholds;
}

/**
 * Creates a Vitest configuration for AWS CDK projects.
 *
 * Unlike the Jest equivalent, no `ts-jest` is needed — Vitest transforms
 * TypeScript natively via esbuild. CDK projects keep tests in a separate
 * test/ directory and collect coverage only from lib/ and util/ since
 * bin/ contains entry-point code with minimal logic.
 * @param options - Configuration options for threshold overrides
 * @param options.thresholds - Coverage thresholds in portable format
 * @returns Vitest UserConfig object with node environment and CDK-specific paths
 */
export const getCdkVitestConfig = ({
  thresholds,
}: CdkVitestOptions = {}): UserConfig => ({
  test: {
    setupFiles: [...scratchSetupFiles()],
    globalSetup: [...scratchGlobalSetup()],
    sequence: { setupFiles: "list", hooks: "stack" },
    globals: true,
    environment: "node",
    include: [
      "test/**/*.test.ts",
      "test/**/*.spec.ts",
      "test/**/*.integration-test.ts",
      "test/**/*.integration-spec.ts",
    ],
    exclude: [...defaultTestExclusions],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "util/**/*.ts"],
      exclude: [...defaultCoverageExclusions],
      thresholds: mapThresholds(
        thresholds
          ? mergeThresholds(defaultThresholds, thresholds)
          : defaultThresholds
      ),
    },
  },
});
