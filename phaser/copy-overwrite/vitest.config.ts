/**
 * This file is managed by Lisa and IS replaced on each `lisa` run.
 * Do not edit directly — durable changes belong upstream in Lisa.
 */

/**
 * Vitest Configuration - Main Entry Point (Phaser)
 *
 * Thin wrapper around @codyswann/lisa vitest config factory.
 * Customize via vitest.config.local.ts and vitest.thresholds.json.
 *
 * @see https://vitest.dev/config/
 * @module vitest.config
 */
import {
  defaultThresholds,
  getPhaserVitestConfig,
  mergeThresholds,
  mergeVitestConfigs,
} from "@codyswann/lisa/vitest/phaser";

import localConfig from "./vitest.config.local";
import thresholdsOverrides from "./vitest.thresholds.json" with { type: "json" };

export default mergeVitestConfigs(
  getPhaserVitestConfig({
    thresholds: mergeThresholds(defaultThresholds, thresholdsOverrides),
  }),
  localConfig
);
