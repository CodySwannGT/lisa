/* eslint-disable max-lines-per-function -- config file needs a lot of lines */
/**
 * ESLint 9 Flat Config - Expo Stack
 *
 * This configuration extends TypeScript config for Expo/React Native projects.
 * It adds Expo-specific plugins and rules for React, Tailwind, accessibility,
 * and component structure.
 *
 * Inheritance chain:
 *   eslint.expo.ts (this file)
 *   └── eslint.typescript.ts
 *       └── eslint.base.ts
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.expo
 */
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactCompiler from "eslint-plugin-react-compiler";
// @ts-expect-error -- eslint-plugin-react-perf lacks type declarations
import reactPerf from "eslint-plugin-react-perf";
import tailwind from "eslint-plugin-tailwindcss";
import { createRequire } from "module";

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

// Custom plugins (CommonJS - use createRequire)
const require = createRequire(import.meta.url);
const componentStructure = require("./eslint-plugin-component-structure/index.js");
const uiStandards = require("./eslint-plugin-ui-standards/index.js");
const expoConfig = require("eslint-config-expo/flat");

/**
 * Creates the Expo ESLint configuration.
 * @param {object} options - Configuration options
 * @param {string} options.tsconfigRootDir - Root directory for tsconfig.json
 * @param {string[]} [options.ignorePatterns] - Patterns to ignore
 * @param {object} [options.thresholds] - Threshold overrides
 * @returns {Array} ESLint flat config array
 */
export function getExpoConfig({
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

    // Expo-specific configurations
    ...expoConfig,

    // React configurations
    react.configs.flat.recommended,
    react.configs.flat["jsx-runtime"],

    // Accessibility
    jsxA11y.flatConfigs.strict,

    // Tailwind CSS
    ...tailwind.configs["flat/recommended"],

    // Performance
    reactPerf.configs.flat.recommended,

    // Base configuration for all files
    {
      languageOptions: {
        ...getBaseLanguageOptions(),
        parserOptions: {
          ...getBaseLanguageOptions().parserOptions,
          ecmaFeatures: { jsx: true },
        },
      },
      plugins: {
        "component-structure": componentStructure,
        "code-organization": codeOrganization,
        "react-compiler": reactCompiler,
        "ui-standards": uiStandards,
      },
      rules: {
        // Shared rules from base
        ...getSharedRules(thresholds),

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
        // Slow rules - disabled by default, run via `lint:slow` script
        // @see eslint.slow.config.ts
        "import/no-cycle": "off",
        "import/namespace": "off",
        // End Slow rules - disabled by default, run via `lint:slow` script
        "import/no-unresolved": "off", // Disabled: doesn't understand React Native platform extensions (.native.tsx, .web.tsx)
        "import/prefer-default-export": "off",
        "import/no-duplicates": "error",

        // React performance
        "react-perf/jsx-no-new-object-as-prop": "error",
        "react-perf/jsx-no-new-array-as-prop": "error",
        "react-perf/jsx-no-new-function-as-prop": "error",

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
        // Slow rules - disabled by default, run via `lint:slow` script
        // @see eslint.slow.config.ts
        "react-compiler/react-compiler": "off",
        "react-hooks/static-components": "off",
        // End Slow rules - disabled by default, run via `lint:slow` script
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

        // Console warnings for Expo
        "no-console": "warn",

        // Functional programming - classes not allowed in Expo (functional components only)
        "functional/no-classes": "error",

        // JSDoc rules - Expo has relaxed requirements for classes/methods
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
      },
    },

    // JavaScript files override
    getJsFilesOverride(),

    // Shared hooks and components
    getSharedFilesOverride(),

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

    // Test files and Jest setup (with JSX patterns)
    getTestFilesOverride([
      "**/*.test.jsx",
      "**/*.test.tsx",
      "**/*spec.jsx",
      "**/*spec.tsx",
    ]),

    // TypeScript files - enable type-checked linting (includes TSX)
    {
      ...getTsFilesOverride(["**/*.ts", "**/*.tsx"], tsconfigRootDir),
      rules: {
        ...getTsFilesOverride(["**/*.ts", "**/*.tsx"], tsconfigRootDir).rules,
        "react/prop-types": "off",
      },
    },

    // TSX files - disable require-returns for components
    {
      files: ["**/*.tsx"],
      rules: {
        "jsdoc/require-returns": "off",
      },
    },

    // TypeScript test files - disable immutable-data (must come after TypeScript config)
    getTsTestFilesOverride([
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*spec.ts",
      "**/*spec.tsx",
    ]),

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

    // Configuration files - allowed to use process.env directly
    {
      files: ["**/*config.*", "lighthouserc.js", "codegen.ts"],
      rules: {
        "no-restricted-syntax": "off",
      },
    },
  ];
}

/* eslint-enable max-lines-per-function -- config file needs a lot of lines */
