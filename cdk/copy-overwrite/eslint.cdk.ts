/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint 9 Flat Config - CDK Stack
 *
 * This configuration extends TypeScript config for AWS CDK projects.
 * It adjusts rules for CDK patterns like constructs, stacks, and
 * infrastructure-as-code conventions.
 *
 * Inheritance chain:
 *   eslint.cdk.ts (this file)
 *   └── eslint.typescript.ts
 *       └── eslint.base.ts
 *
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.cdk
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

// CDK-specific ignores
const cdkIgnores = [
  ...defaultIgnores,
  "cdk.out/**",
  "*.js", // CDK generates JS files
  "*.d.ts",
];

/**
 * Creates the CDK ESLint configuration.
 *
 * @param {object} options - Configuration options
 * @param {string} options.tsconfigRootDir - Root directory for tsconfig.json
 * @param {string[]} [options.ignorePatterns] - Patterns to ignore
 * @param {object} [options.thresholds] - Threshold overrides
 * @returns {Array} ESLint flat config array
 */
export function getCdkConfig({
  tsconfigRootDir,
  ignorePatterns = cdkIgnores,
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
        // All configuration should go through config module
        // @see PROJECT_RULES.md
        "no-restricted-syntax": [
          "error",
          {
            selector:
              "MemberExpression[object.name='process'][property.name='env']",
            message:
              "Direct process.env access is forbidden. Use config module for type-safe configuration. See PROJECT_RULES.md.",
          },
        ],

        // CDK uses classes for constructs and stacks
        "functional/no-classes": "off",

        // CDK constructs and stacks require documentation
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
    getTsTestFilesOverride(["**/*.test.ts", "**/*.spec.ts"]),

    // CDK bin files - entry points can access process.env for stage selection
    {
      files: ["bin/**/*.ts"],
      rules: {
        "no-restricted-syntax": "off",
      },
    },

    // Configuration files - allowed to use process.env directly
    {
      files: ["**/*config.*", "**/config/**/*.ts"],
      rules: {
        "no-restricted-syntax": "off",
      },
    },

    // Lambda handlers - often have different constraints
    {
      files: [
        "**/lambda/**/*.ts",
        "**/lambdas/**/*.ts",
        "**/functions/**/*.ts",
      ],
      rules: {
        // Lambda cold starts benefit from simpler code
        "sonarjs/cognitive-complexity": ["error", 15],
      },
    },
  ];
}
