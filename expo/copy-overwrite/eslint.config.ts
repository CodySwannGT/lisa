/**
 * ESLint 9 Flat Config - Main Entry Point (Expo)
 *
 * This file imports the Expo-specific configuration and project-local customizations.
 * Do not modify this file directly - use eslint.config.local.ts for project-specific rules.
 *
 * Inheritance chain:
 *   eslint.config.ts (this file)
 *   └── eslint.expo.ts
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
  getExpoConfig,
} from "./eslint.expo";

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
  // Stack-specific configuration (Expo)
  ...getExpoConfig({
    tsconfigRootDir: __dirname,
    ignorePatterns,
    thresholds,
  }),

  // Project-local customizations
  ...localConfig,
];
