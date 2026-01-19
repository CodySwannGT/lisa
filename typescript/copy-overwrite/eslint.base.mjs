/**
 * ESLint 9 Flat Config - Shared Base
 *
 * This module exports shared configuration pieces that can be imported by
 * project-specific eslint.config.mjs files. This reduces duplication between
 * typescript, expo, nestjs, and other project type configurations.
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.base
 */
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import js from "@eslint/js";
import functional from "eslint-plugin-functional";
import jsdoc from "eslint-plugin-jsdoc";
import prettier from "eslint-plugin-prettier/recommended";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";
import tseslint from "typescript-eslint";

const specFilePattern = "**/*.spec.ts";

/**
 * Default ignore patterns used when not specified in project config.
 * Projects can override via eslint.ignore.config.json.
 */
export const defaultIgnores = [
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
  specFilePattern,
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

/**
 * Default thresholds used when not specified in project config.
 * Projects can override via eslint.thresholds.config.json.
 */
export const defaultThresholds = {
  cognitiveComplexity: 10,
  maxLines: 300,
  maxLinesPerFunction: 75
};

/**
 * Base ESLint configurations that should be applied to all TypeScript projects.
 * This includes recommended configs from ESLint, TypeScript-ESLint, and plugins.
 * @returns {Array} Array of ESLint flat config objects
 */
export const getBaseConfigs = () => [
  // Base configurations
  js.configs.recommended,

  // TypeScript configuration
  ...tseslint.configs.recommended,

  // Functional programming - manual configuration since v7 requires type info
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
];

/**
 * Shared rules that apply to all TypeScript projects.
 * These are rules that should be identical across typescript, expo, nestjs, etc.
 * @param {object} thresholds - Threshold values for configurable rules
 * @param {number} thresholds.cognitiveComplexity - Max cognitive complexity
 * @param {number} thresholds.maxLines - Max lines per file
 * @param {number} thresholds.maxLinesPerFunction - Max lines per function
 * @returns {object} Rules configuration object
 */
export const getSharedRules = thresholds => ({
  // Prettier: Disabled because running Prettier inside ESLint is redundant and slower.
  // We use `format:check` from package.json for formatting validation and editor Prettier integration.
  // The eslint-config-prettier (imported above) still disables conflicting ESLint rules.
  // @see https://prettier.io/docs/en/integrating-with-linters.html
  "prettier/prettier": "off",

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
  "max-lines-per-function": [
    "error",
    {
      max: thresholds.maxLinesPerFunction,
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
  "sonarjs/pseudo-random": "error",
  "sonarjs/no-clear-text-protocols": "error",
  "sonarjs/prefer-read-only-props": "error",
  "sonarjs/no-empty-test-file": "warn",
  "sonarjs/no-nested-conditional": "off",
  "sonarjs/no-commented-code": "warn",
  "sonarjs/no-ignored-exceptions": "warn",
  "sonarjs/todo-tag": "warn",
  // Next takes forever and doesn't provide much value
  "sonarjs/deprecation": "off",
  // Next takes forever and doesn't provide value
  "sonarjs/aws-restricted-ip-admin-access": "off",
  // This just seems to be wrong and gives all kinds of false positives
  "sonarjs/different-types-comparison": "off", 
  // This duplicates another lint check
  "sonarjs/no-unused-vars": "off",

  // ESLint comments
  "@eslint-community/eslint-comments/require-description": "error",
  "@eslint-community/eslint-comments/disable-enable-pair": "error",
  "@eslint-community/eslint-comments/no-unlimited-disable": "error",

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

  // JSDoc rules
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
  "jsdoc/require-description": "error",
  "jsdoc/require-param": "error",
  "jsdoc/require-returns": "error",
  "jsdoc/require-param-description": "error",
  "jsdoc/require-returns-description": "error",
  "jsdoc/require-property-description": "error",
  "jsdoc/check-tag-names": [
    "error",
    { definedTags: ["remarks", "precondition", "entity", "security"] },
  ],
  "jsdoc/no-types": "off",
  "jsdoc/require-param-type": "off",
  "jsdoc/require-returns-type": "off",
  "jsdoc/require-property-type": "off",
});

/**
 * Base language options for all files.
 * @returns {object} Language options configuration
 */
export const getBaseLanguageOptions = () => ({
  globals: {
    ...globals.browser,
    ...globals.node,
    ...globals.es2021,
  },
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: "module",
  },
});

/**
 * JavaScript files override - relaxes certain rules for JS files.
 * @returns {object} ESLint flat config object for JS files
 */
export const getJsFilesOverride = () => ({
  files: ["**/*.js", "**/*.mjs"],
  rules: {
    "sonarjs/cognitive-complexity": "off",
    "@typescript-eslint/no-require-imports": "off", // CommonJS files
    "max-lines-per-function": "off",
  },
});

/**
 * Shared hooks and components override - relaxes import restrictions.
 * @returns {object} ESLint flat config object for shared files
 */
export const getSharedFilesOverride = () => ({
  files: ["hooks/shared/**/*", "components/shared/**/*"],
  rules: {
    "no-restricted-imports": "off",
  },
});

/**
 * Test files override - configures Jest globals and relaxes rules for tests.
 * @param additionalPatterns - Additional file patterns to include
 * @returns {object} ESLint flat config object for test files
 */
export const getTestFilesOverride = (additionalPatterns = []) => ({
  files: [
    "**/*.test.js",
    "**/*.test.ts",
    "**/*.spec.js",
    specFilePattern,
    "jest.setup.js",
    "jest.setup.ts",
    "jest.setup.pre.js",
    "**/__tests__/*",
    "**/test/**",
    ...additionalPatterns,
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
    // Tests can be longer than typical functions
    "max-lines-per-function": "off",
  },
});

/**
 * TypeScript files override - enables type-checked linting.
 * @param filePatterns - File patterns to match
 * @param tsconfigRootDir - Root directory for tsconfig.json (pass __dirname from calling module)
 * @returns {object} ESLint flat config object for TypeScript files
 */
export const getTsFilesOverride = (
  filePatterns = ["**/*.ts"],
  tsconfigRootDir
) => ({
  files: filePatterns,
  languageOptions: {
    parserOptions: {
      project: "tsconfig.eslint.json",
      tsconfigRootDir,
    },
  },
  rules: {
    // Enable immutable-data rule now that type-checking is available
    "functional/immutable-data": [
      "error",
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
});

/**
 * TypeScript test files override - must come after TypeScript config.
 * @param filePatterns - File patterns for test files
 * @returns {object} ESLint flat config object for TypeScript test files
 */
export const getTsTestFilesOverride = (
  filePatterns = ["**/*.test.ts", specFilePattern]
) => ({
  files: filePatterns,
  rules: {
    // Tests often need to mutate state for mocks, setup, and assertions
    "functional/immutable-data": "off",
    // Tests can be longer than typical functions
    "max-lines-per-function": "off",
  },
});

// Re-export plugins and configs for use in project-specific configs
export {
  eslintComments,
  functional,
  globals,
  js,
  jsdoc,
  prettier,
  sonarjs,
  tseslint
};

