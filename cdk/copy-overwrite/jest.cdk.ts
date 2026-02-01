/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Jest Configuration - CDK Stack
 *
 * Provides AWS CDK-specific Jest configuration targeting
 * the test/ directory with spec and integration-spec patterns.
 *
 * Inheritance chain:
 *   jest.cdk.ts (this file)
 *   └── jest.base.ts
 *
 * @see https://jestjs.io/docs/configuration
 * @module jest.cdk
 */
import type { Config } from "jest";

import {
  defaultCoverageExclusions,
  defaultThresholds,
  mergeConfigs,
  mergeThresholds,
} from "./jest.base.ts";

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
 *
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
  testRegex: "(.*\\.(spec|integration-spec)\\.ts)$",
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  moduleFileExtensions: ["js", "json", "ts"],
  collectCoverageFrom: [
    "lib/**/*.ts",
    "util/**/*.ts",
    ...defaultCoverageExclusions,
  ],
  coverageThreshold: thresholds,
  testTimeout: 10000,
});
