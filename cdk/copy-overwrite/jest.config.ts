/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 *
 * @jest-config-loader esbuild-register
 */

/**
 * Jest Configuration - Main Entry Point (CDK)
 *
 * Thin wrapper around @codyswann/lisa jest config factory.
 * Customize via jest.config.local.ts and jest.thresholds.json.
 *
 * @see https://jestjs.io/docs/configuration
 * @module jest.config
 */
import {
  defaultThresholds,
  getCdkJestConfig,
  mergeConfigs,
  mergeThresholds,
} from "@codyswann/lisa/jest/cdk";

import localConfig from "./jest.config.local.ts";
import thresholdsOverrides from "./jest.thresholds.json" with { type: "json" };

export default mergeConfigs(
  getCdkJestConfig({
    thresholds: mergeThresholds(defaultThresholds, thresholdsOverrides),
  }),
  localConfig
);
