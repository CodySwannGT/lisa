/**
 * ESLint 9 Flat Config
 *
 * This configuration file replaces the legacy .eslintrc.json format.
 * It uses JavaScript modules and explicit imports for all plugins and configs.
 *
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.config
 */
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import js from "@eslint/js";
import functional from "eslint-plugin-functional";
import jsdoc from "eslint-plugin-jsdoc";
import prettier from "eslint-plugin-prettier/recommended";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";
import path from "path";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "url";

// Project-specific configuration loaded from JSON files
// Edit these files to customize for your project; this JS file can be shared unchanged
import ignoreConfig from "./eslint.ignore.config.json" with { type: "json" };
import thresholdsConfig from "./eslint.thresholds.config.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Default ignore patterns used when not specified in config */
const defaultIgnores = [
  "build/**",
  "dist/**",
  ".build/**",
  ".esbuild/**",
  ".serverless/**",
  ".webpack/**",
  "_warmup/**",
  "node_modules/**",
  "**/node_modules/**",
  "src/graphql/**",
  "src/graphql.ts",
  "src/graphql-generated/**",
  "src/generated/**",
  "graphql/**",
  "graphql-generated/**",
  "generated/**",
  "components/ui/**",
  "coverage/**",
  "**/*spec.ts",
  "resolver-test.setup.ts",
  "**/*.factory.ts",
  "**/test-utils/**",
  "**/test/**",
  "**/database/migrations/**",
  "cypress/**",
  "e2e/**",
  "playwright-report/**",
  ".lighthouseci/**",
  ".expo/**",
  ".github/**",
  "public/**",
  ".dead/**",
  "example/**",
  "tmp/**",
  ".vscode/**",
  "*.config.js",
  "*.config.mjs",
  "babel.config.js",
  "metro.config.js",
  "webpack.*.js",
  "*.d.ts",
  "esbuild.plugins.js",
  "projects/**/scripts/**",
  "scripts/**",
  "lib/**/*.js",
  "cdk.out/**",
];

/** Default thresholds used when not specified in config */
const defaultThresholds = {
  cognitiveComplexity: 10,
  maxLines: 300,
};

const ignorePatterns = ignoreConfig.ignores || defaultIgnores;
const thresholds = { ...defaultThresholds, ...thresholdsConfig };

// Custom plugins and configs (CommonJS - use createRequire)
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Custom plugins
const codeOrganization = require("./eslint-plugin-code-organization/index.js");

// Expo config (CommonJS)

export default [
  // Global ignores - loaded from eslint.ignore.config.json
  {
    ignores: ignorePatterns,
  },

  // Base configurations
  js.configs.recommended,

  // TypeScript configuration
  ...tseslint.configs.recommended,

  // Functional programming - manual configuration since v7 requires type info
  // We'll configure specific rules we need without type checking
  {
    plugins: {
      functional,
    },
  },

  // Code quality
  sonarjs.configs.recommended,
  {
    plugins: {
      "@eslint-community/eslint-comments": eslintComments,
    },
    rules: {
      ...eslintComments.configs.recommended.rules,
    },
  },

  // Documentation
  jsdoc.configs["flat/recommended-typescript-flavor"],

  // Prettier (must be last of shared configs)
  prettier,

  // Base configuration for all files
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
      },
    },
    plugins: {
      "code-organization": codeOrganization,
      // folders: foldersPlugin, // Disabled: not compatible with ESLint 9 flat config
    },
    rules: {
      // Prettier: Disabled because running Prettier inside ESLint is redundant and slower.
      // We use `format:check` from package.json for formatting validation and editor Prettier integration.
      // The eslint-config-prettier (imported above) still disables conflicting ESLint rules.
      // @see https://prettier.io/docs/en/integrating-with-linters.html
      "prettier/prettier": "off",

      // Code organization
      "code-organization/enforce-statement-order": "error",

      // Import rules
      "no-restricted-imports": [
        "warn",
        {
          patterns: ["@/features/*/*"],
        },
      ],

      // File size - threshold loaded from eslint.thresholds.config.json
      "max-lines": [
        "error",
        {
          max: thresholds.maxLines,
          skipBlankLines: true,
          skipComments: true,
        },
      ],

      // Folder naming
      // NOTE: eslint-plugin-folders is not compatible with ESLint 9 flat config
      // The rule has no schema defined and ESLint 9 validates rule options strictly
      // This needs to be addressed in a separate PR or the plugin needs to be updated
      // "folders/match-regex": ["error", "^([a-z][a-z0-9]*)(-[a-z0-9]+)*$", "/src/"],

      // SonarJS rules - threshold loaded from eslint.thresholds.config.json
      "sonarjs/cognitive-complexity": ["error", thresholds.cognitiveComplexity],
      "sonarjs/no-identical-functions": "error",
      "sonarjs/no-duplicate-string": "error",
      "sonarjs/no-nested-template-literals": "warn",
      "sonarjs/prefer-immediate-return": "warn",
      "sonarjs/prefer-single-boolean-return": "warn",
      "sonarjs/no-collapsible-if": "warn",
      // New rules in SonarJS v3 - disabled temporarily to allow migration
      // These need to be addressed in a separate cleanup task
      "sonarjs/pseudo-random": "error",
      "sonarjs/no-clear-text-protocols": "error",
      "sonarjs/prefer-read-only-props": "error",
      "sonarjs/no-empty-test-file": "warn",
      "sonarjs/no-nested-conditional": "off",
      "sonarjs/no-commented-code": "warn",
      "sonarjs/no-ignored-exceptions": "warn",
      "sonarjs/todo-tag": "warn",
      // Next takes forever and doesn't provide value
      "sonarjs/aws-restricted-ip-admin-access": "off",

      // ESLint comments
      "@eslint-community/eslint-comments/require-description": "error",
      "@eslint-community/eslint-comments/disable-enable-pair": "error",
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",

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

      // General rules
      "no-extra-boolean-cast": "off",
      "prefer-const": "error",
      "no-param-reassign": "error",
      "no-var": "error",
      "brace-style": "error",
      "prefer-template": "error",
      radix: "error",
      "space-before-blocks": "error",
      "no-unused-vars": "off",

      // TypeScript rules
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_|^unstable_settings$|^React$",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // New rules in typescript-eslint v8 - disabled temporarily
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/prefer-as-const": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",

      // Functional rules - configured to avoid type-checking requirements
      // Rules that require type info are disabled
      "functional/no-mixed-types": "off",
      "functional/functional-parameters": "off",
      "functional/prefer-immutable-types": "off",
      "functional/no-expression-statements": "off",
      "functional/no-conditional-statements": "off",
      "functional/prefer-property-signatures": "off",
      "functional/no-return-void": "off",
      "functional/no-throw-statements": "off",
      "functional/prefer-readonly-type": "off",
      "functional/prefer-tacit": "off",
      "functional/readonly-type": "off",
      "functional/type-declaration-immutability": "off",
      // Rules we want - these work without type info
      // NOTE: functional/immutable-data requires type info - enabled in TypeScript file config below
      "functional/immutable-data": "off",
      "functional/no-let": "error",
      // Disabled: NestJS relies heavily on classes for modules, controllers, services, etc.
      "functional/no-classes": "off",

      // JSDoc rules
      "jsdoc/require-jsdoc": [
        "error",
        {
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true, // Changed: AI can document class methods
            ClassDeclaration: true, // Changed: AI can document classes
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
      "jsdoc/require-description": "error", // Add: require main description
      "jsdoc/require-param": "error", // Add: force @param tags
      "jsdoc/require-returns": "error", // Add: force @returns tags
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns-description": "error",
      "jsdoc/require-property-description": "error",
      "jsdoc/check-tag-names": ["error", { definedTags: ["remarks"] }],
      "jsdoc/no-types": "off",
      "jsdoc/require-param-type": "off",
      "jsdoc/require-returns-type": "off",
      "jsdoc/require-property-type": "off",
    },
  },

  // JavaScript files override
  {
    files: ["**/*.js"],
    rules: {
      "sonarjs/cognitive-complexity": "off",
      "@typescript-eslint/no-require-imports": "off", // CommonJS files
    },
  },

  // Shared hooks and components
  {
    files: ["hooks/shared/**/*", "components/shared/**/*"],
    rules: {
      "no-restricted-imports": "off",
    },
  },

  // Test files and Jest setup
  {
    files: [
      "**/*.test.js",
      "**/*.test.ts",
      "**/*.spec.js",
      "**/*.spec.ts",
      "jest.setup.js",
      "jest.setup.ts",
      "jest.setup.pre.js",
      "**/__tests__/*",
      "**/test/**",
    ],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // Tests often need to mutate state for mocks, setup, and assertions
      "functional/immutable-data": "off",
      // Tests often need let for setup/teardown and incrementing counters
      "functional/no-let": "off",
      // Tests need to manipulate process.env for environment setup
      "no-restricted-syntax": "off",
    },
  },

  // TypeScript files - enable type-checked linting
  {
    files: ["**/*.ts"],
    // languageOptions: {
    //   parserOptions: {
    //     projectService: true,
    //     tsconfigRootDir: __dirname,
    //   },
    // },
    rules: {
      // Enable immutable-data rule now that type-checking is available
      "functional/immutable-data": [
        "off",
        {
          ignoreClasses: true,
          ignoreImmediateMutation: true,
          ignoreNonConstDeclarations: {
            treatParametersAsConst: true,
          },
          ignoreAccessorPattern: ["*.displayName", "*.current", "*.value"],
        },
      ],
    },
  },

  // TypeScript test files - disable immutable-data (must come after TypeScript config)
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      // Tests often need to mutate state for mocks, setup, and assertions
      "functional/immutable-data": "off",
    },
  },

  // Configuration file - allowed to use process.env (single source of truth)
  {
    files: ["src/config/configuration.ts"],
    rules: {
      // This is the ONLY file allowed to access process.env directly
      // All other code must use ConfigService or getStandaloneConfig()
      "no-restricted-syntax": "off",
    },
  },
];
