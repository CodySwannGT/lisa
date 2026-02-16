/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 *
 * @jest-config-loader esbuild-register
 */

/**
 * Jest Configuration - Main Entry Point (TypeScript)
 *
 * Imports the TypeScript-specific configuration and project-local customizations.
 * Do not modify this file directly - use jest.config.local.ts for project-specific settings.
 *
 * Inheritance chain:
 *   jest.config.ts (this file)
 *   └── jest.typescript.ts
 *       └── jest.base.ts
 *
 * @see https://jestjs.io/docs/configuration
 * @module jest.config
 */
import { mergeConfigs, mergeThresholds } from "./jest.base.ts";
import {
  defaultThresholds,
  getTypescriptJestConfig,
} from "./jest.typescript.ts";

import localConfig from "./jest.config.local.ts";
import thresholdsOverrides from "./jest.thresholds.json" with { type: "json" };

const thresholds = mergeThresholds(defaultThresholds, thresholdsOverrides);

export default mergeConfigs(
  getTypescriptJestConfig({ thresholds }),
  localConfig
);
