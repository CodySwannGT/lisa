/**
 * Jest Configuration - CDK Stack
 *
 * Provides AWS CDK-specific Jest configuration targeting
 * the test/ directory with test/spec and integration-test/integration-spec patterns.
 *
 * Inheritance chain:
 *   cdk.ts (this file)
 *   └── base.ts
 * @see https://jestjs.io/docs/configuration
 * @module configs/jest/cdk
 */
import type { Config } from "jest";

import {
  defaultCoverageExclusions,
  defaultThresholds,
  mergeConfigs,
  mergeThresholds,
} from "./base.js";

// Re-export base utilities for entry-point configs
export {
  defaultCoverageExclusions,
  defaultThresholds,
  mergeConfigs,
  mergeThresholds,
};

/**
 * Options for configuring the CDK Jest config factory.
 */
interface CdkJestOptions {
  /** Coverage thresholds (merged defaults + project overrides) */
  readonly thresholds?: Config["coverageThreshold"];
}

/**
 * Creates a Jest configuration for AWS CDK projects.
 * @param options - Configuration options for threshold overrides
 * @param options.thresholds - Coverage thresholds (merged defaults + project overrides)
 * @returns Jest config object with ts-jest transform, node environment, and CDK-specific paths
 * @remarks CDK projects typically use CommonJS modules and keep tests in a
 * separate test/ directory. Coverage is collected only from lib/ and util/
 * directories since bin/ contains entry-point code with minimal logic.
 */
export const getCdkJestConfig = ({
  thresholds = defaultThresholds,
}: CdkJestOptions = {}): Config => ({
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testRegex: "(.*\\.(test|spec|integration-test|integration-spec)\\.ts)$",
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  moduleFileExtensions: ["js", "json", "ts"],
  collectCoverageFrom: [
    "lib/**/*.ts",
    "util/**/*.ts",
    ...defaultCoverageExclusions,
  ],
  ...(thresholds !== undefined ? { coverageThreshold: thresholds } : {}),
  testTimeout: 10000,
});
