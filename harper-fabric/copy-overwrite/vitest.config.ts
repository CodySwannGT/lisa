/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Vitest Configuration - Main Entry Point (Harper/Fabric)
 *
 * Thin wrapper around @codyswann/lisa vitest config factory.
 * Customize via vitest.config.local.ts and vitest.thresholds.json.
 *
 * @see https://vitest.dev/config/
 * @module vitest.config
 */
import {
  defaultThresholds,
  getHarperFabricVitestConfig,
  mergeThresholds,
  mergeVitestConfigs,
} from "@codyswann/lisa/vitest/harper-fabric";

import localConfig from "./vitest.config.local";
import thresholdsOverrides from "./vitest.thresholds.json" with { type: "json" };

export default mergeVitestConfigs(
  getHarperFabricVitestConfig({
    thresholds: mergeThresholds(defaultThresholds, thresholdsOverrides),
  }),
  localConfig
);
