/**
 * Jest Configuration - Project-Local Customizations (Lisa)
 *
 * Lisa-specific Jest settings for ESM support with ts-jest.
 * This file is create-only — Lisa will not overwrite it.
 *
 * @see https://jestjs.io/docs/configuration
 * @module jest.config.local
 */
import type { Config } from "jest";

const config: Config = {
  // Lisa prefers tests/ as the primary test location. Note: mergeConfigs
  // concatenates arrays, so this entry combines with the stack's testMatch
  // (which may include src/**/*.test.ts), resulting in both patterns being active.
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  // Exclude index.ts from coverage (entry point with no logic)
  collectCoverageFrom: ["src/**/*.ts", "!src/index.ts"],
};

export default config;
