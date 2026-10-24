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
 * Expo adds, through {@link getExpoSlowConfig}:
 * - react-compiler/react-compiler - React Compiler compatibility checks (slow)
 * - react-hooks/static-components - Static component optimization checks (slow)
 * @see https://github.com/import-js/eslint-plugin-import
 * @module configs/eslint/slow
 */
import importPlugin from "eslint-plugin-import";
import reactCompilerPlugin from "eslint-plugin-react-compiler";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import sonarjsPlugin from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

// Get the TypeScript flat config from the import plugin
const importTypescriptConfig = importPlugin.flatConfigs.typescript;

/**
 * Creates the slow ESLint configuration for rules disabled in the main config.
 * @param options - Configuration options for the slow rules config
 * @param options.ignorePatterns - Patterns to ignore in addition to built-in ignores
 * @returns ESLint flat config array containing only slow rules
 */
export function getSlowConfig({
  ignorePatterns = [],
}: {
  ignorePatterns?: readonly string[];
} = {}): import("eslint").Linter.Config[] {
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
        ...importTypescriptConfig?.plugins,
        sonarjs: sonarjsPlugin,
      },
      settings: {
        ...importTypescriptConfig?.settings,
        "import/resolver": {
          ...(importTypescriptConfig?.settings?.["import/resolver"] as Record<
            string,
            unknown
          >),
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

/**
 * Creates the slow ESLint configuration for Expo projects: the shared slow
 * rules plus the two React rules the main Expo config turns off for speed.
 *
 * `react-compiler/react-compiler` and `react-hooks/static-components` moved
 * here from the main Expo lint when lint:slow was introduced (0b58fe96a4).
 * A later rewrite of this module kept only the import rules, so neither ran
 * anywhere until they were restored (CodySwannGT/lisa#4507). The plugins are
 * resolved from Lisa's own dependencies, so a project needs no extra install.
 * @param options - Configuration options for the slow rules config
 * @param options.ignorePatterns - Patterns to ignore in addition to built-in ignores
 * @returns ESLint flat config array containing only slow rules
 */
export function getExpoSlowConfig({
  ignorePatterns = [],
}: {
  ignorePatterns?: readonly string[];
} = {}): import("eslint").Linter.Config[] {
  return [
    ...getSlowConfig({ ignorePatterns }),
    {
      files: ["**/*.tsx", "**/*.ts"],
      plugins: {
        "react-compiler": reactCompilerPlugin,
        // Rules only: the package's `configs` shape does not fit ESLint's
        // Plugin type, and this config needs none of its presets.
        "react-hooks": { rules: reactHooksPlugin.rules },
      },
      rules: {
        // React Compiler compatibility (slow)
        "react-compiler/react-compiler": "error",
        // Static component optimization (slow)
        "react-hooks/static-components": "error",
      },
    },
  ];
}

const defaultConfig: import("eslint").Linter.Config[] = getSlowConfig();
export default defaultConfig;
