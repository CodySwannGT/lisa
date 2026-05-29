/**
 * Jest Configuration - Expo Stack
 *
 * Provides Expo/React Native-specific Jest configuration without using
 * the `jest-expo` preset directly. The preset's `setupFiles` include
 * `react-native/jest/setup.js` which redefines `window` via
 * `Object.defineProperties` — incompatible with jsdom's non-configurable
 * `window` property, causing "Cannot redefine property: window" errors.
 *
 * Instead, this config manually replicates the preset's resolution,
 * transform, and haste settings without any preset setupFiles.
 *
 * `setupFiles` and `setupFilesAfterEnv` are configured here to wire up
 * the base jest setup files (`jest.setup.pre.js` and `jest.setup.ts`).
 * These base files import project-local overrides (`jest.setup.pre.local.js`
 * and `jest.setup.local.ts`) which are create-only templates that projects
 * can customize without Lisa overwriting them.
 *
 * Coverage collection is scoped to standard Expo source directories
 * rather than a catch-all glob, preventing config files, scripts, and
 * plugins from distorting coverage numbers. The `app/` directory is
 * excluded because Expo Router file-based routing makes those files thin
 * wrappers (8-15 lines) that just re-export feature components.
 * `*View.{ts,tsx}` files are excluded because the Container/View pattern
 * puts all logic in Container files — Views are purely presentational.
 *
 * Inheritance chain:
 *   expo.ts (this file)
 *   └── base.ts
 * @see https://jestjs.io/docs/configuration
 * @see https://github.com/expo/expo/issues/40184
 * @module configs/jest/expo
 */
import type { Config } from "jest";

import {
  defaultCoverageExclusions,
  defaultThresholds,
  mergeConfigs,
  mergeThresholds,
  worktreeTestPathIgnorePatterns,
} from "./base.js";

// Re-export base utilities for entry-point configs
export {
  defaultCoverageExclusions,
  defaultThresholds,
  mergeConfigs,
  mergeThresholds,
  worktreeTestPathIgnorePatterns,
};

/**
 * Options for configuring the Expo Jest config factory.
 */
interface ExpoJestOptions {
  /** Coverage thresholds (merged defaults + project overrides) */
  readonly thresholds?: Config["coverageThreshold"];
  /**
   * Prefix applied to the positive `collectCoverageFrom` globs. Defaults to
   * `""` (source at the project root). Set to `"src/"` for projects that adopt
   * the Expo SDK 55+/56 `/src` directory convention so coverage is collected
   * from `src/components`, `src/features`, etc. The negative (exclusion) globs
   * are anchored with a leading globstar and are unaffected by this prefix.
   */
  readonly sourceRoot?: string;
}

/**
 * Creates a Jest configuration for Expo/React Native projects.
 * @param options - Configuration options for threshold overrides
 * @param options.thresholds - Coverage thresholds (merged defaults + project overrides)
 * @param options.sourceRoot - Prefix for coverage globs (e.g. `"src/"` for the SDK 55+/56 `/src` convention; defaults to `""`)
 * @returns Jest config object with jsdom environment, babel-jest transform, and React Native resolver
 * @remarks Avoids `jest-expo` preset to prevent jsdom + `react-native/jest/setup.js`
 * incompatibility. Manually configures haste, resolver, and transform to match the
 * preset's behavior without the problematic window redefinition.
 */
export const getExpoJestConfig = ({
  thresholds = defaultThresholds,
  sourceRoot = "",
}: ExpoJestOptions = {}): Config => ({
  testEnvironment: "jsdom",
  haste: {
    defaultPlatform: "ios",
    platforms: ["android", "ios", "native"],
  },
  // SDK 56 / RN 0.85 relocated the React Native Jest resolver out of
  // `react-native/jest/resolver.js` and into `@react-native/jest-preset`.
  // This resolver is what teaches Jest to resolve platform-extension files
  // (`.ios`/`.native`/`.web`); without it those variants do not resolve.
  resolver: "@react-native/jest-preset/jest/resolver.js",
  setupFiles: ["<rootDir>/jest.setup.pre.js"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  transform: {
    "\\.[jt]sx?$": [
      "babel-jest",
      {
        caller: {
          name: "metro",
          bundler: "metro",
          platform: "ios",
        },
      },
    ],
    "^.+\\.(bmp|gif|jpg|jpeg|mp4|png|psd|svg|webp|ttf|otf|woff|woff2)$":
      "jest-expo/src/preset/assetFileTransformer.js",
  },
  testMatch: ["<rootDir>/**/*.test.ts", "<rootDir>/**/*.test.tsx"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/.expo/",
    ...worktreeTestPathIgnorePatterns(),
  ],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@gluestack-ui/.*|@gluestack-style/.*|nativewind|react-native-css-interop|react-native-reanimated|react-native-worklets|lucide-react-native|@gorhom|@shopify)",
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverageFrom: [
    `${sourceRoot}components/**/*.{ts,tsx}`,
    `${sourceRoot}config/**/*.{ts,tsx}`,
    `${sourceRoot}constants/**/*.{ts,tsx}`,
    `${sourceRoot}features/**/*.{ts,tsx}`,
    `${sourceRoot}hooks/**/*.{ts,tsx}`,
    `${sourceRoot}lib/**/*.{ts,tsx}`,
    `${sourceRoot}providers/**/*.{ts,tsx}`,
    `${sourceRoot}shared/**/*.{ts,tsx}`,
    `${sourceRoot}stores/**/*.{ts,tsx}`,
    `${sourceRoot}types/**/*.{ts,tsx}`,
    `${sourceRoot}utils/**/*.{ts,tsx}`,
    "!**/*View.{ts,tsx}",
    ...defaultCoverageExclusions,
  ],
  ...(thresholds !== undefined ? { coverageThreshold: thresholds } : {}),
  testTimeout: 10000,
});
