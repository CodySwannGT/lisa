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
  moduleNameMapper: {
    // Stack template files (expo/, nestjs/, cdk/) import ./jest.base.ts as
    // a sibling — which only exists at the project root after Lisa copies
    // the template. Redirect so tests can import these templates in-place.
    "^\\./(jest\\.base\\.ts)$": "<rootDir>/$1",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        // Disable ts-jest diagnostics because stack template files (in
        // expo/, nestjs/, cdk/) import ./jest.base.ts which only exists as
        // a sibling after Lisa copies the template to a project root.
        // moduleNameMapper handles runtime resolution; typecheck catches
        // real type errors via `bun run typecheck`.
        diagnostics: false,
      },
    ],
  },
};

export default config;
