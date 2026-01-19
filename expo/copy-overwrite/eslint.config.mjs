/**
 * ESLint 9 Flat Config - Expo
 *
 * This configuration file extends the TypeScript base for Expo/React Native projects.
 * It imports shared configuration from eslint.base.mjs and adds Expo-specific
 * plugins and rules for React, Tailwind, accessibility, and component structure.
 *
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.config
 */
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactCompiler from "eslint-plugin-react-compiler";
import reactPerf from "eslint-plugin-react-perf";
import tailwind from "eslint-plugin-tailwindcss";
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

// Custom plugins and configs (CommonJS - use createRequire)
const require = createRequire(import.meta.url);
const componentStructure = require("./eslint-plugin-component-structure/index.js");
const codeOrganization = require("./eslint-plugin-code-organization/index.js");
const uiStandards = require("./eslint-plugin-ui-standards/index.js");
const expoConfig = require("eslint-config-expo/flat");

export default [
  // Global ignores - loaded from eslint.ignore.config.json
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
      "import/no-cycle": "off", // Disable because this is very, very slow. TODO: debug and re-enable
      "import/no-unresolved": "off", // Disabled: doesn't understand React Native platform extensions (.native.tsx, .web.tsx)
      "import/prefer-default-export": "off",
      "import/namespace": "off", // Disable because this is slow and typescript type check will catch this
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
    "**/*.spec.jsx",
    "**/*.spec.tsx",
  ]),

  // TypeScript files - enable type-checked linting (includes TSX)
  {
    ...getTsFilesOverride(["**/*.ts", "**/*.tsx"], __dirname),
    rules: {
      ...getTsFilesOverride(["**/*.ts", "**/*.tsx"], __dirname).rules,
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
    "**/*.spec.ts",
    "**/*.spec.tsx",
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
