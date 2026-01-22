/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/* eslint-disable max-lines-per-function -- config file requires many lines */
/**
 * ESLint 9 Flat Config - NestJS Stack
 *
 * This configuration extends TypeScript config for NestJS projects.
 * It adjusts rules for NestJS patterns like decorators, dependency injection,
 * and class-based architecture.
 *
 * Inheritance chain:
 *   eslint.nestjs.ts (this file)
 *   └── eslint.typescript.ts
 *       └── eslint.base.ts
 *
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.nestjs
 */

// Import TypeScript config and utilities
import {
  codeOrganization,
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
} from "./eslint.typescript";

// Re-export for downstream configs
export {
  defaultIgnores,
  defaultThresholds,
  getBaseConfigs,
  getBaseLanguageOptions,
  getSharedRules,
};

/**
 * Creates the NestJS ESLint configuration.
 *
 * @param {object} options - Configuration options
 * @param {string} options.tsconfigRootDir - Root directory for tsconfig.json
 * @param {string[]} [options.ignorePatterns] - Patterns to ignore
 * @param {object} [options.thresholds] - Threshold overrides
 * @returns {Array} ESLint flat config array
 */
export function getNestjsConfig({
  tsconfigRootDir,
  ignorePatterns = defaultIgnores,
  thresholds = defaultThresholds,
}: {
  tsconfigRootDir: string;
  ignorePatterns?: string[];
  thresholds?: typeof defaultThresholds;
}) {
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
        // All configuration should go through ConfigService
        // @see PROJECT_RULES.md
        "no-restricted-syntax": [
          "error",
          {
            selector:
              "MemberExpression[object.name='process'][property.name='env']",
            message:
              "Direct process.env access is forbidden. Use ConfigService for type-safe configuration. See PROJECT_RULES.md.",
          },
        ],

        // NestJS uses classes extensively for modules, controllers, services, etc.
        "functional/no-classes": "off",

        // NestJS decorators require class methods
        "jsdoc/require-jsdoc": [
          "error",
          {
            require: {
              FunctionDeclaration: true,
              MethodDefinition: true,
              ClassDeclaration: true,
              ArrowFunctionExpression: false,
              FunctionExpression: false,
            },
            contexts: [
              "TSInterfaceDeclaration",
              "TSTypeAliasDeclaration",
              "VariableDeclaration[declarations.0.init.type='ArrowFunctionExpression']:has([id.name=/^[A-Z]/])",
            ],
          },
        ],
      },
    },

    // JavaScript files override
    getJsFilesOverride(),

    // Shared hooks and components
    getSharedFilesOverride(),

    // Test files
    getTestFilesOverride(),

    // TypeScript files - enable type-checked linting
    getTsFilesOverride(["**/*.ts"], tsconfigRootDir),

    // TypeScript test files - disable immutable-data
    getTsTestFilesOverride([
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/*.e2e-spec.ts",
    ]),

    // NestJS module files - relax some rules
    {
      files: ["**/*.module.ts"],
      rules: {
        // Modules often import many things
        "max-lines": "off",
      },
    },

    // NestJS controller/service files
    {
      files: ["**/*.controller.ts", "**/*.service.ts", "**/*.resolver.ts"],
      rules: {
        // These files often have many methods
        "max-lines-per-function": ["error", { max: 100 }],
      },
    },

    // Configuration files - allowed to use process.env directly
    {
      files: ["**/*config.*", "**/configuration.ts", "**/config/*.ts"],
      rules: {
        "no-restricted-syntax": "off",
      },
    },

    // Lambda handlers - allowed to use getStandaloneConfig()
    {
      files: ["**/handlers/**/*.ts", "**/lambda/**/*.ts"],
      rules: {
        "no-restricted-syntax": "off",
      },
    },
  ];
}
/* eslint-enable max-lines-per-function -- config file requires many lines */
