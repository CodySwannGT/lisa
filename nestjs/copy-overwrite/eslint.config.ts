/**
 * ESLint 9 Flat Config - Main Entry Point (NestJS)
 *
 * This file imports the NestJS-specific configuration and project-local customizations.
 * Do not modify this file directly - use eslint.config.local.ts for project-specific rules.
 *
 * Inheritance chain:
 *   eslint.config.ts (this file)
 *   └── eslint.nestjs.ts
 *       └── eslint.typescript.ts
 *           └── eslint.base.ts
 *
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.config
 */
import path from "path";
import { fileURLToPath } from "url";

import {
  defaultIgnores,
  defaultThresholds,
  getNestjsConfig,
} from "./eslint.nestjs.ts";

// Project-specific configuration loaded from JSON files
import ignoreConfig from "./eslint.ignore.config.json" with { type: "json" };
import thresholdsConfig from "./eslint.thresholds.json" with { type: "json" };

// Project-local customizations (create-only - safe to modify)
import localConfig from "./eslint.config.local.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ignorePatterns = ignoreConfig.ignores || defaultIgnores;
const thresholds = { ...defaultThresholds, ...thresholdsConfig };

export default [
  // Stack-specific configuration (NestJS)
  ...getNestjsConfig({
    tsconfigRootDir: __dirname,
    ignorePatterns,
    thresholds,
  }),

  // Project-local customizations
  ...localConfig,
];
