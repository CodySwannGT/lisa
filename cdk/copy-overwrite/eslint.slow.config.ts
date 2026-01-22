/**
 * ESLint 9 Flat Config - Slow Rules Only (CDK)
 *
 * This configuration runs ONLY slow linting rules that are disabled in the
 * main eslint.config.ts for performance. Run this periodically via `lint:slow`
 * rather than on every lint pass.
 *
 * Rules included:
 * - import/namespace - Type checks all namespace imports (slow)
 * - import/no-cycle - Detects circular dependencies (very slow)
 *
 * @see https://github.com/import-js/eslint-plugin-import
 * @module eslint.slow.config
 */
import { createRequire } from "module";

import importPlugin from "eslint-plugin-import";
import sonarjsPlugin from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

// Use createRequire for JSON imports (compatible with CDK's CommonJS tsconfig)
const require = createRequire(import.meta.url);
const ignoreConfig = require("./eslint.ignore.config.json");

const ignorePatterns = ignoreConfig.ignores || [];

// Get the TypeScript flat config from the import plugin
const importTypescriptConfig = importPlugin.flatConfigs.typescript;

export default [
  // Use same ignores as main config, plus ignore all non-TS files
  // This prevents errors from inline eslint directives in JS files
  // that reference rules not loaded in this minimal config
  {
    ignores: [
      ...ignorePatterns,
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
      "**/*.jsx",
      "cdk.out/**",
    ],
  },

  // TypeScript files - slow import rules only
  {
    files: ["**/*.ts", "**/*.tsx"],
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
      "sonarjs/deprecation": "error",
    },
  },
];
