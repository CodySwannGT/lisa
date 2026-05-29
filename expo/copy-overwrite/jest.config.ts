/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 *
 * @jest-config-loader esbuild-register
 */

/**
 * Jest Configuration - Main Entry Point (Expo)
 *
 * Thin wrapper around @codyswann/lisa jest config factory.
 * Customize via jest.config.local.ts and jest.thresholds.json.
 *
 * @see https://jestjs.io/docs/configuration
 * @module jest.config
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  defaultThresholds,
  getExpoJestConfig,
  mergeConfigs,
  mergeThresholds,
} from "@codyswann/lisa/jest/expo";

import localConfig from "./jest.config.local.ts";
import thresholdsOverrides from "./jest.thresholds.json" with { type: "json" };

// Auto-detect the Expo SDK 55+/56 `/src` convention. When source lives under
// `src/`, pass `sourceRoot: "src/"` so the factory anchors `collectCoverageFrom`
// at `src/...` in a single correctly-ordered array — avoiding the glob-ordering
// trap that arises if a project instead re-anchors coverage via a local override.
const sourceRoot = existsSync(join(process.cwd(), "src", "app")) ? "src/" : "";

export default mergeConfigs(
  getExpoJestConfig({
    thresholds: mergeThresholds(defaultThresholds, thresholdsOverrides),
    sourceRoot,
  }),
  localConfig
);
