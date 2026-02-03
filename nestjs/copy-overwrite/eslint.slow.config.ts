/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint 9 Flat Config - Slow Rules Only (NestJS)
 *
 * This configuration runs ONLY slow linting rules that are disabled in the
 * main eslint.config.ts for performance. Run this periodically via `lint:slow`
 * rather than on every lint pass.
 *
 * Rules included:
 * - import/namespace - Type checks all namespace imports (slow)
 * - import/no-cycle - Detects circular dependencies (very slow)
 *
 * NestJS-specific adjustments:
 * - sonarjs/deprecation disabled (NestJS ecosystem APIs evolve frequently)
 * - import/no-cycle disabled for *.module.ts (NestJS forwardRef pattern)
 *
 * @see https://github.com/import-js/eslint-plugin-import
 * @module eslint.slow.config
 */
import importPlugin from "eslint-plugin-import";
import sonarjsPlugin from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

import ignoreConfig from "./eslint.ignore.config.json" with { type: "json" };

const ignorePatterns = ignoreConfig.ignores || [];

// Get the TypeScript flat config from the import plugin
const importTypescriptConfig = importPlugin.flatConfigs.typescript;

export default [
  // Use same ignores as main config, plus ignore all non-TS files
  // This prevents errors from inline eslint directives in JS files
  // that reference rules not loaded in this minimal config
  // Also ignore template files in type-specific directories that don't have tsconfig
  {
    ignores: [
      ...ignorePatterns,
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
      "**/*.jsx",
      "**/__tests__/**",
      "cdk/**",
      "expo/**",
      "nestjs/**",
      "typescript/**",
      "npm-package/**",
    ],
  },

  // TypeScript files - slow import rules only
  {
    files: ["**/*.ts", "**/*.tsx"],
    linterOptions: {
      // Ignore inline eslint-disable comments since they reference rules
      // from the main config that aren't loaded in this minimal config
      noInlineConfig: true,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "tsconfig.eslint.json",
      },
    },
    plugins: {
      ...(importTypescriptConfig?.plugins ?? {}),
      sonarjs: sonarjsPlugin,
    },
    settings: {
      ...(importTypescriptConfig?.settings ?? {}),
      "import/resolver": {
        ...((importTypescriptConfig?.settings?.["import/resolver"] as Record<
          string,
          unknown
        >) ?? {}),
        typescript: true,
      },
    },
    rules: {
      // ONLY slow rules - everything else runs in the main config
      "import/namespace": "error",
      "import/no-cycle": "error",

      // NestJS ecosystem APIs evolve frequently with deprecation notices
      // that are not immediately actionable (e.g., OpenAI SDK, MCP SDK)
      "sonarjs/deprecation": "off",
    },
  },

  // NestJS module files use forwardRef() to handle circular dependencies
  // at runtime. ESLint's import/no-cycle doesn't understand this pattern.
  {
    files: ["**/*.module.ts"],
    rules: {
      "import/no-cycle": "off",
    },
  },
];
