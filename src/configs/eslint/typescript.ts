/**
 * ESLint 9 Flat Config - TypeScript Stack
 *
 * Publishable factory function for TypeScript-specific ESLint rules and settings.
 * Stack-specific configs (expo, nestjs, cdk) import and extend this module.
 *
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module configs/eslint/typescript
 */
import { createRequire } from "module";

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
} from "./base.js";

// Re-export base utilities for stack-specific configs to use
export {
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
};

// Custom plugins (CommonJS - use createRequire)
const require = createRequire(import.meta.url);
const codeOrganization = require("@codyswann/eslint-plugin-code-organization");

// Re-export plugin for stack-specific configs
export { codeOrganization };

/**
 * Creates the TypeScript ESLint configuration.
 *
 * @param {object} options - Configuration options
 * @param {string} options.tsconfigRootDir - Root directory for tsconfig.json
 * @param {string[]} [options.ignorePatterns] - Patterns to ignore
 * @param {object} [options.thresholds] - Threshold overrides
 * @returns {import("eslint").Linter.Config[]} ESLint flat config array
 */
export function getTypescriptConfig({
  tsconfigRootDir,
  ignorePatterns = defaultIgnores,
  thresholds = defaultThresholds,
}: {
  tsconfigRootDir: string;
  ignorePatterns?: string[];
  thresholds?: typeof defaultThresholds;
}): import("eslint").Linter.Config[] {
  return [
    // Global ignores
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
        // @see .claude/rules/PROJECT_RULES.md
        "no-restricted-syntax": [
          "error",
          {
            selector:
              "MemberExpression[object.name='process'][property.name='env']",
            message:
              "Direct process.env access is forbidden. Use ConfigService (in NestJS context) or getStandaloneConfig() (in Lambda handlers). See .claude/rules/PROJECT_RULES.md.",
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
    getTsFilesOverride(["**/*.ts"], tsconfigRootDir),

    // TypeScript test files - disable immutable-data (must come after TypeScript config)
    getTsTestFilesOverride(["**/*.test.ts", "**/*.spec.ts"]),

    // Configuration files - allowed to use process.env directly
    {
      files: ["**/*config.*"],
      rules: {
        "no-restricted-syntax": "off",
      },
    },
  ] as unknown as import("eslint").Linter.Config[];
}
