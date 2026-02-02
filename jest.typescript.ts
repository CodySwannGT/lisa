/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Jest Configuration - TypeScript Stack
 *
 * Provides TypeScript/Node-specific Jest configuration.
 * Imports shared utilities from jest.base.ts.
 * Stack-specific configs (expo, nestjs, cdk) should import and extend this.
 *
 * @see https://jestjs.io/docs/configuration
 * @module jest.typescript
 */
import type { Config } from "jest";

import {
  defaultCoverageExclusions,
  defaultThresholds,
  mergeConfigs,
  mergeThresholds,
} from "./jest.base.ts";

// Re-export base utilities for stack-specific configs to use
export {
  defaultCoverageExclusions,
  defaultThresholds,
  mergeConfigs,
  mergeThresholds,
};

/**
 * Options for configuring the TypeScript Jest config factory.
 */
interface TypescriptJestOptions {
  /** Coverage thresholds (merged defaults + project overrides) */
  readonly thresholds?: Config["coverageThreshold"];
}

/**
 * Creates a Jest configuration for TypeScript/Node projects using ts-jest.
 *
 * @param options - Configuration options for threshold overrides
 * @param options.thresholds - Coverage thresholds (merged defaults + project overrides)
 * @returns Jest config object with ts-jest transform, ESM support, and coverage settings
 * @remarks Uses ts-jest ESM preset for projects with "type": "module" in package.json.
 * Projects needing CommonJS should override the preset in jest.config.local.ts.
 */
export const getTypescriptJestConfig = ({
  thresholds = defaultThresholds,
}: TypescriptJestOptions = {}): Config => ({
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts", "<rootDir>/src/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  extensionsToTreatAsEsm: [".ts"],
  collectCoverageFrom: ["src/**/*.ts", ...defaultCoverageExclusions],
  coverageThreshold: thresholds,
  testTimeout: 10000,
});
