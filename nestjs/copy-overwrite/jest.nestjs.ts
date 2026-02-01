/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Jest Configuration - NestJS Stack
 *
 * Provides NestJS-specific Jest configuration with extensive coverage
 * exclusions for generated files, DTOs, entities, and modules.
 *
 * Inheritance chain:
 *   jest.nestjs.ts (this file)
 *   └── jest.base.ts
 *
 * @see https://jestjs.io/docs/configuration
 * @module jest.nestjs
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
 * Options for configuring the NestJS Jest config factory.
 */
interface NestjsJestOptions {
  /** Coverage thresholds (merged defaults + project overrides) */
  readonly thresholds?: Config["coverageThreshold"];
}

/**
 * NestJS-specific patterns excluded from coverage collection.
 * These are generated or boilerplate files that don't benefit from coverage tracking.
 */
const nestjsCoverageExclusions: readonly string[] = [
  ...defaultCoverageExclusions,
  "!**/*.entity.ts",
  "!**/*.dto.ts",
  "!**/*.input.ts",
  "!**/*.args.ts",
  "!**/*.model.ts",
  "!**/*.module.ts",
  "!**/*.factory.ts",
  "!**/*.enum.ts",
  "!**/*.interface.ts",
  "!**/*.constants.ts",
  "!**/database/migrations/**",
  "!**/database/seeds/**",
  "!**/graphql/**",
  "!**/main.ts",
];

/**
 * Creates a Jest configuration for NestJS projects.
 *
 * @param options - Configuration options for threshold overrides
 * @param options.thresholds - Coverage thresholds (merged defaults + project overrides)
 * @returns Jest config object with ts-jest transform, node environment, and NestJS-specific exclusions
 * @remarks NestJS projects use CommonJS modules and spec.ts test file convention.
 * Coverage excludes entities, DTOs, modules, and other boilerplate files
 * that are better validated through integration tests.
 */
export const getNestjsJestConfig = ({
  thresholds = defaultThresholds,
}: NestjsJestOptions = {}): Config => ({
  testEnvironment: "node",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  moduleFileExtensions: ["js", "json", "ts"],
  collectCoverageFrom: ["**/*.ts", ...nestjsCoverageExclusions],
  coverageThreshold: thresholds,
  testTimeout: 10000,
});
