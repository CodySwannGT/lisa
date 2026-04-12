/**
 * Vitest Configuration - TypeScript Stack
 *
 * Provides TypeScript/Node-specific Vitest configuration.
 * Imports shared utilities from the base module.
 *
 * @see https://vitest.dev/config/
 * @module configs/vitest/typescript
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
} from "./base.js";

import type { PortableThresholds } from "./base.js";

// Re-export base utilities for stack-specific configs to use
export {
  defaultCoverageExclusions,
  defaultTestExclusions,
  defaultThresholds,
  mapThresholds,
  mergeThresholds,
  mergeVitestConfigs,
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
 *
 * @param options - Configuration options for threshold overrides
 * @param options.thresholds - Coverage thresholds in portable format
 * @returns Vitest UserConfig object
 */
export const getTypescriptVitestConfig = ({
  thresholds = defaultThresholds,
}: TypescriptVitestOptions = {}): UserConfig => ({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: [...defaultTestExclusions],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [...defaultCoverageExclusions],
      thresholds: mapThresholds(thresholds),
    },
  },
});
