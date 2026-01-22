/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint 9 Flat Config - Main Entry Point (CDK)
 *
 * This file imports the CDK-specific configuration and project-local customizations.
 * Do not modify this file directly - use eslint.config.local.ts for project-specific rules.
 *
 * Inheritance chain:
 *   eslint.config.ts (this file)
 *   └── eslint.cdk.ts
 *       └── eslint.typescript.ts
 *           └── eslint.base.ts
 *
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.config
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

import { defaultIgnores, defaultThresholds, getCdkConfig } from "./eslint.cdk";

// Project-specific configuration loaded from JSON files (use createRequire for compatibility)
const require = createRequire(import.meta.url);
const ignoreConfig = require("./eslint.ignore.config.json");
const thresholdsConfig = require("./eslint.thresholds.json");

// Project-local customizations (create-only - safe to modify)
import localConfig from "./eslint.config.local";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ignorePatterns = ignoreConfig.ignores || defaultIgnores;
const thresholds = { ...defaultThresholds, ...thresholdsConfig };

export default [
  // Stack-specific configuration (CDK)
  ...getCdkConfig({
    tsconfigRootDir: __dirname,
    ignorePatterns,
    thresholds,
  }),

  // Project-local customizations
  ...localConfig,
];
