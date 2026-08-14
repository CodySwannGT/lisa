/**
 * This file is managed by Lisa and IS replaced on each `lisa` run.
 * Do not edit directly — durable changes belong upstream in Lisa.
 */

/**
 * Vitest Configuration - Main Entry Point (CDK)
 *
 * Thin wrapper around @codyswann/lisa vitest config factory.
 * Customize via vitest.config.local.ts and vitest.thresholds.json.
 *
 * @see https://vitest.dev/config/
 * @module vitest.config
 */
import {
  defaultThresholds,
  getCdkVitestConfig,
  mergeVitestConfigs,
  mergeThresholds,
} from "@codyswann/lisa/vitest/cdk";

import localConfig from "./vitest.config.local";
import thresholdsOverrides from "./vitest.thresholds.json" with { type: "json" };

export default mergeVitestConfigs(
  getCdkVitestConfig({
    thresholds: mergeThresholds(defaultThresholds, thresholdsOverrides),
  }),
  localConfig
);
