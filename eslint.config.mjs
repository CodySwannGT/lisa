/**
 * ESLint 9 Flat Config - TypeScript Base
 *
 * This configuration file is the base for all TypeScript projects.
 * It imports shared configuration from eslint.base.mjs and adds
 * TypeScript-specific settings.
 *
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.config
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

// Import shared base configuration
import {
  defaultIgnores,
  defaultThresholds,
  getBaseConfigs,
  getBaseLanguageOptions,
  getJsFilesOverride,
  getSharedFilesOverride,
  getSharedRules,
  getTestFilesOverride,
  getTsFilesOverride,
  getTsTestFilesOverride,
} from "./eslint.base.mjs";

// Project-specific configuration loaded from JSON files
// Edit these files to customize for your project; this JS file can be shared unchanged
import ignoreConfig from "./eslint.ignore.config.json" with { type: "json" };
import thresholdsConfig from "./eslint.thresholds.config.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ignorePatterns = ignoreConfig.ignores || defaultIgnores;
const thresholds = { ...defaultThresholds, ...thresholdsConfig };

// Custom plugins (CommonJS - use createRequire)
const require = createRequire(import.meta.url);
const codeOrganization = require("./eslint-plugin-code-organization/index.js");

export default [
  // Global ignores - loaded from eslint.ignore.config.json
  {
    ignores: ignorePatterns,
  },

  // Base configurations from shared module
  ...getBaseConfigs(),

  // Base configuration for all files
  {
    languageOptions: getBaseLanguageOptions(),
    plugins: {
      "code-organization": codeOrganization,
    },
    rules: {
      // Shared rules from base
      ...getSharedRules(thresholds),

      // Code organization
      "code-organization/enforce-statement-order": "error",

      // Configuration enforcement - prevent direct process.env access
      // All configuration should go through ConfigService or getStandaloneConfig()
      // @see PROJECT_RULES.md
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.name='process'][property.name='env']",
          message:
            "Direct process.env access is forbidden. Use ConfigService (in NestJS context) or getStandaloneConfig() (in Lambda handlers). See PROJECT_RULES.md.",
        },
      ],

      // Disabled: NestJS relies heavily on classes for modules, controllers, services, etc.
      "functional/no-classes": "off",
    },
  },

  // JavaScript files override
  getJsFilesOverride(),

  // Shared hooks and components
  getSharedFilesOverride(),

  // Test files and Jest setup
  getTestFilesOverride(),

  // TypeScript files - enable type-checked linting
  getTsFilesOverride(["**/*.ts"], __dirname),

  // TypeScript test files - disable immutable-data (must come after TypeScript config)
  getTsTestFilesOverride(["**/*.test.ts", "**/*.spec.ts"]),

  // Configuration files - allowed to use process.env directly
  {
    files: ["**/*config.*"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
];
