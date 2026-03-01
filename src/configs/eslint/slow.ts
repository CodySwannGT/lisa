/**
 * ESLint 9 Flat Config - Slow Rules Only
 *
 * Publishable factory function for slow linting rules that are disabled in the
 * main ESLint config for performance. Projects run these periodically via
 * `lint:slow` rather than on every lint pass.
 *
 * Rules included:
 * - import/namespace - Type checks all namespace imports (slow)
 * - import/no-cycle - Detects circular dependencies (very slow)
 *
 * @see https://github.com/import-js/eslint-plugin-import
 * @module configs/eslint/slow
 */
import importPlugin from "eslint-plugin-import";
import sonarjsPlugin from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

// Get the TypeScript flat config from the import plugin
const importTypescriptConfig = importPlugin.flatConfigs.typescript;

/**
 * Creates the slow ESLint configuration for rules disabled in the main config.
 *
 * @param options - Configuration options for the slow rules config
 * @param options.ignorePatterns - Patterns to ignore in addition to built-in ignores
 * @returns ESLint flat config array containing only slow rules
 */
export function getSlowConfig({
  ignorePatterns = [],
}: { ignorePatterns?: readonly string[] } = {}) {
  return [
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
        // Prevent parse errors from modules that use non-standard JS syntax
        // (e.g. react-native uses Flow types which ESLint's parser cannot handle)
        "import/ignore": ["node_modules", "react-native", "\\.native\\."],
      },
      rules: {
        // ONLY slow rules - everything else runs in the main config
        "import/namespace": "error",
        "import/no-cycle": "error",
        // Off by default: codebase may have existing deprecated API usages.
        // Enable project-by-project once violations are addressed.
        "sonarjs/deprecation": "off",
      },
    },
  ];
}

export default getSlowConfig();
