/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Jest Configuration - Expo Stack
 *
 * Provides Expo/React Native-specific Jest configuration.
 * Extends the base Jest utilities for coverage thresholds and merging.
 *
 * Inheritance chain:
 *   jest.expo.ts (this file)
 *   └── jest.base.ts
 *
 * @see https://jestjs.io/docs/configuration
 * @module jest.expo
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
 * Options for configuring the Expo Jest config factory.
 */
interface ExpoJestOptions {
  /** Coverage thresholds (merged defaults + project overrides) */
  readonly thresholds?: Config["coverageThreshold"];
}

/**
 * Creates a Jest configuration for Expo/React Native projects.
 *
 * @param options - Configuration options for threshold overrides
 * @param options.thresholds - Coverage thresholds (merged defaults + project overrides)
 * @returns Jest config object with jsdom environment, babel-jest transform, and React Native resolver
 * @remarks Uses jest-expo preset which provides platform-specific test resolution
 * and proper React Native module mocking out of the box.
 */
export const getExpoJestConfig = ({
  thresholds = defaultThresholds,
}: ExpoJestOptions = {}): Config => ({
  preset: "jest-expo",
  testEnvironment: "jsdom",
  testMatch: [
    "<rootDir>/**/*.test.ts",
    "<rootDir>/**/*.test.tsx",
    "<rootDir>/**/__tests__/**/*.ts",
    "<rootDir>/**/__tests__/**/*.tsx",
  ],
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/.expo/"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@gluestack-ui/.*|@gluestack-style/.*|nativewind|react-native-css-interop)",
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverageFrom: [
    "**/*.{ts,tsx}",
    "!**/*.d.ts",
    ...defaultCoverageExclusions,
  ],
  coverageThreshold: thresholds,
  testTimeout: 10000,
});
