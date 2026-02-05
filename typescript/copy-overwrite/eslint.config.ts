/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint 9 Flat Config - Main Entry Point
 *
 * This file imports the stack-specific configuration and project-local customizations.
 * Do not modify this file directly - use eslint.config.local.ts for project-specific rules.
 *
 * Inheritance chain:
 *   eslint.config.ts (this file)
 *   └── eslint.typescript.ts (or eslint.expo.ts, eslint.nestjs.ts, etc.)
 *       └── eslint.base.ts (shared utilities)
 *
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.config
 */
import path from "path";
import { fileURLToPath } from "url";

import {
  defaultIgnores,
  defaultThresholds,
  getTypescriptConfig,
} from "./eslint.typescript";

// Project-specific configuration loaded from JSON files
import ignoreConfig from "./eslint.ignore.config.json" with { type: "json" };
import thresholdsConfig from "./eslint.thresholds.json" with { type: "json" };

// Project-local customizations (create-only - safe to modify)
import localConfig from "./eslint.config.local";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ignorePatterns = ignoreConfig.ignores || defaultIgnores;
const thresholds = { ...defaultThresholds, ...thresholdsConfig };

export default [
  // Stack-specific configuration (TypeScript)
  ...getTypescriptConfig({
    tsconfigRootDir: __dirname,
    ignorePatterns,
    thresholds,
  }),

  // Project-local customizations
  ...localConfig,
];
