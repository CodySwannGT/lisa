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
import jsxA11y from "eslint-plugin-jsx-a11y";
import prettier from "eslint-plugin-prettier/recommended";
import react from "eslint-plugin-react";
import reactCompiler from "eslint-plugin-react-compiler";
import reactPerf from "eslint-plugin-react-perf";
import sonarjs from "eslint-plugin-sonarjs";
import tailwind from "eslint-plugin-tailwindcss";
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
  maxLinesView: 300,
};

const ignorePatterns = ignoreConfig.ignores || defaultIgnores;
const thresholds = { ...defaultThresholds, ...thresholdsConfig };

// Custom plugins and configs (CommonJS - use createRequire)
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Custom plugins
const componentStructure = require("./eslint-plugin-component-structure/index.js");
const codeOrganization = require("./eslint-plugin-code-organization/index.js");
const uiStandards = require("./eslint-plugin-ui-standards/index.js");

// Expo config (CommonJS)
const expoConfig = require("eslint-config-expo/flat");

export default [
  // Global ignores - loaded from eslint.ignore.config.json
  {
    ignores: ignorePatterns,
  },

  // Base configurations
  js.configs.recommended,
  ...expoConfig,

  // TypeScript configuration
  ...tseslint.configs.recommended,

  // React configurations
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  // Note: react-hooks plugin is provided by eslint-config-expo

  // Accessibility
  jsxA11y.flatConfigs.strict,

  // Functional programming - manual configuration since v7 requires type info
  // We'll configure specific rules we need without type checking
  {
    plugins: {
      functional,
    },
  },

  // Tailwind CSS
  ...tailwind.configs["flat/recommended"],

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

  // Performance
  reactPerf.configs.flat.recommended,

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
        ecmaFeatures: { jsx: true },
        ecmaVersion: 2021,
        sourceType: "module",
      },
    },
    plugins: {
      "component-structure": componentStructure,
      "code-organization": codeOrganization,
      "react-compiler": reactCompiler,
      "ui-standards": uiStandards,
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

      // UI standards (all off by default)
      "ui-standards/no-classname-outside-ui": "off",
      "ui-standards/no-direct-rn-imports": "off",
      "ui-standards/no-inline-styles": "off",

      // Tailwind
      "tailwindcss/classnames-order": [
        "error",
        {
          callees: ["tva", "classnames", "clsx", "ctl", "cva", "tv"],
        },
      ],

      // Import rules
      "import/no-cycle": "off", // Disable because this is very, very slow. TODO: debug and re-enable
      "import/no-unresolved": "off", // Disabled: doesn't understand React Native platform extensions (.native.tsx, .web.tsx)
      "import/prefer-default-export": "off",
      "import/namespace": "off", // Disable because this is slow and typescript type check will catch this
      "import/no-duplicates": "error",
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

      // React performance
      "react-perf/jsx-no-new-object-as-prop": "error",
      "react-perf/jsx-no-new-array-as-prop": "error",
      "react-perf/jsx-no-new-function-as-prop": "error",

      // ESLint comments
      "@eslint-community/eslint-comments/require-description": "error",
      "@eslint-community/eslint-comments/disable-enable-pair": "error",
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",

      // React rules
      "react/jsx-no-constructed-context-values": "error",
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/preserve-manual-memoization": "error",
      "react-hooks/refs": "error",
      "react-hooks/immutability": "error",
      "react-compiler/react-compiler": "error",

      // Environment variables - enforce validated env module usage
      // @see .claude/skills/expo-env-config/SKILL.md
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.name='process'][property.name='env']",
          message:
            "Direct process.env access is forbidden. Import { env } from '@/lib/env' instead for type-safe, validated environment variables.",
        },
      ],

      // General rules
      "no-console": "warn",
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
      "functional/no-classes": "error",

      // JSDoc rules
      "jsdoc/require-jsdoc": [
        "error",
        {
          require: {
            FunctionDeclaration: true,
            MethodDefinition: false,
            ClassDeclaration: false,
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

  // UI components
  {
    files: [
      "components/ui/**/*.tsx",
      "components/ui/**/*.jsx",
      "components/custom/ui/**/*.tsx",
      "components/custom/ui/**/*.jsx",
    ],
    rules: {
      "ui-standards/no-classname-outside-ui": "off",
      "ui-standards/no-inline-styles": "off",
    },
  },

  // View files - threshold loaded from eslint.thresholds.config.json
  {
    files: ["**/*View.tsx", "**/*View.jsx"],
    rules: {
      "max-lines": [
        "error",
        {
          max: thresholds.maxLinesView,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },

  // Test files and Jest setup
  {
    files: [
      "**/*.test.js",
      "**/*.test.jsx",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.js",
      "**/*.spec.jsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "jest.setup.js",
      "jest.setup.ts",
      "jest.setup.pre.js",
      "**/__tests__/*",
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
    },
  },

  // TypeScript files - enable type-checked linting
  {
    files: ["**/*.ts", "**/*.tsx"],
    // languageOptions: {
    //   parserOptions: {
    //     projectService: true,
    //     tsconfigRootDir: __dirname,
    //   },
    // },
    rules: {
      "react/prop-types": "off",
      // Enable immutable-data rule now that type-checking is available
      "functional/immutable-data": [
        "off",
        {
          ignoreClasses: true,
          ignoreImmediateMutation: true,
          ignoreNonConstDeclarations: {
            treatParametersAsConst: true,
          },
          // Allow common React patterns:
          // - Component.displayName = "ComponentName" for debugging
          // - ref.current = value for useRef mutations
          // - animation.value = value for animation changes
          ignoreAccessorPattern: ["*.displayName", "*.current", "*.value"],
        },
      ],
    },
  },

  // TSX files
  {
    files: ["**/*.tsx"],
    rules: {
      "jsdoc/require-returns": "off",
    },
  },

  // TypeScript test files - disable immutable-data (must come after TypeScript config)
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
    rules: {
      // Tests often need to mutate state for mocks, setup, and assertions
      "functional/immutable-data": "off",
    },
  },

  // Component structure rules
  {
    files: [
      "features/**/components/**/*.ts",
      "features/**/components/**/*.tsx",
      "features/**/components/**/*.jsx",
      "features/**/screens/**/*.ts",
      "features/**/screens/**/*.tsx",
      "features/**/screens/**/*.jsx",
      "components/**/*.ts",
      "components/**/*.tsx",
      "components/**/*.jsx",
    ],
    ignores: [
      "components/ui/**",
      "components/shared/**",
      "components/icons/**",
    ],
    rules: {
      "component-structure/enforce-component-structure": "error",
      "component-structure/single-component-per-file": "error",
    },
  },

  // View component rules
  {
    files: ["**/*View.tsx", "**/*View.jsx"],
    rules: {
      "component-structure/no-return-in-view": "error",
    },
  },

  // View memo requirement (excluding UI components)
  {
    files: ["**/*View.tsx", "**/*View.jsx"],
    ignores: ["components/ui/**"],
    rules: {
      "component-structure/require-memo-in-view": "error",
    },
  },

  // Environment validation module - allowed to access process.env
  // This is the ONLY file that should directly read environment variables
  // @see .claude/skills/expo-env-config/SKILL.md
  {
    files: ["src/lib/env.ts", "lib/env.ts", "lib/__tests__/env.test.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },

  // Test files that mock process.env for environment variable testing
  // These need direct access to process.env to set up test fixtures
  {
    files: [
      "lib/apollo/sentryLink.test.ts",
      "lib/build/info.test.ts",
      "lib/sentry/config.test.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },

  // Build/config files - allowed to access process.env at build time
  // These run in Node.js during build, not in the app bundle
  {
    files: [
      "app.config.ts",
      "codegen.ts",
      "playwright.config.ts",
      "lighthouserc.js",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
];
