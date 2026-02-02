/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

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
 * `setupFiles` is intentionally empty because `jest-expo/src/preset/setup.js`
 * requires `__DEV__` to be defined before it runs, and `mergeConfigs`
 * concatenates arrays with base entries first — making it impossible for
 * project-local setupFiles to prepend a `__DEV__` definition. Projects
 * should add their own setupFiles in `jest.config.local.ts` with the
 * correct ordering (define globals first, then load jest-expo setup).
 *
 * Coverage collection is scoped to standard Expo source directories
 * rather than a catch-all glob, preventing config files, scripts, and
 * plugins from distorting coverage numbers.
 *
 * Inheritance chain:
 *   jest.expo.ts (this file)
 *   └── jest.base.ts
 *
 * @see https://jestjs.io/docs/configuration
 * @see https://github.com/expo/expo/issues/40184
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
 * @remarks Avoids `jest-expo` preset to prevent jsdom + `react-native/jest/setup.js`
 * incompatibility. Manually configures haste, resolver, and transform to match the
 * preset's behavior without the problematic window redefinition. `setupFiles` is
 * empty — projects must provide their own in `jest.config.local.ts` with correct
 * ordering (define `__DEV__` before loading `jest-expo/src/preset/setup.js`).
 */
export const getExpoJestConfig = ({
  thresholds = defaultThresholds,
}: ExpoJestOptions = {}): Config => ({
  testEnvironment: "jsdom",
  haste: {
    defaultPlatform: "ios",
    platforms: ["android", "ios", "native"],
  },
  resolver: "react-native/jest/resolver.js",
  setupFiles: [],
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
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/.expo/"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@gluestack-ui/.*|@gluestack-style/.*|nativewind|react-native-css-interop|react-native-reanimated|react-native-worklets|lucide-react-native|@gorhom|@shopify)",
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "config/**/*.{ts,tsx}",
    "constants/**/*.{ts,tsx}",
    "features/**/*.{ts,tsx}",
    "hooks/**/*.{ts,tsx}",
    "lib/**/*.{ts,tsx}",
    "providers/**/*.{ts,tsx}",
    "shared/**/*.{ts,tsx}",
    "stores/**/*.{ts,tsx}",
    "types/**/*.{ts,tsx}",
    "utils/**/*.{ts,tsx}",
    "!**/*.d.ts",
    ...defaultCoverageExclusions,
  ],
  coverageThreshold: thresholds,
  testTimeout: 10000,
});
