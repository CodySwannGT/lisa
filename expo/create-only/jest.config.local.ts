/**
 * Jest Configuration - Project-Local Customizations
 *
 * Add project-specific Jest settings here. This file is create-only,
 * meaning Lisa will create it but never overwrite your customizations.
 *
 * The Expo stack's `jest.expo.ts` provides haste, resolver, transform,
 * setupFiles, and base coverage settings. This file should only contain
 * settings that are project-specific or need to override the base config.
 *
 * @see https://jestjs.io/docs/configuration
 * @module jest.config.local
 */
import type { Config } from "jest";

const config: Config = {
  // Path aliases matching tsconfig.expo.json paths
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },

  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/generated/",
    "\\.mock\\.(ts|tsx|js|jsx)$",
  ],
};

export default config;
