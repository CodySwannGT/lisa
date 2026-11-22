/**
 * ESLint 9 Flat Config - Expo Stack File Overrides
 *
 * The path- and file-type overrides `getExpoConfig` layers after its all-files
 * block, plus the oxlint hand-off that must close the Expo config. Split out of
 * `expo.ts` so each module stays within the size limits it enforces.
 * @module configs/eslint/expo-overrides
 */
import oxlint from "eslint-plugin-oxlint";
import { createRequire } from "module";

import {
  getJsFilesOverride,
  getSharedFilesOverride,
  getTestFilesOverride,
  getTsFilesOverride,
  getTsTestFilesOverride,
} from "./base.js";
import { getViewGateConfigs } from "./view-gate.js";

const require = createRequire(import.meta.url);
const jsxA11y = require("eslint-plugin-jsx-a11y");

/**
 * jsx-a11y `strict` rules that eslint-plugin-oxlint's `flat/jsx-a11y` preset
 * hands to oxlint from 1.63.0–1.65.0, where they only warn. Expo restores them
 * after the preset so they keep blocking (#4508).
 */
export const OXLINT_HANDED_OFF_A11Y_RULES = [
  "jsx-a11y/interactive-supports-focus",
  "jsx-a11y/no-interactive-element-to-noninteractive-role",
  "jsx-a11y/no-noninteractive-element-interactions",
  "jsx-a11y/no-noninteractive-element-to-interactive-role",
] as const;

/**
 * Overrides keyed on file type: JS, shared, UI components, tests, TS and TSX.
 * @param sourceRoot - Prefix for source-relative file globs
 * @param tsconfigRootDir - Root directory for tsconfig.json
 * @returns ESLint flat config objects for Expo file types
 */
export function getExpoSourceOverrides(
  sourceRoot: string,
  tsconfigRootDir: string
) {
  return [
    // JavaScript files override
    getJsFilesOverride(),

    // Shared hooks and components
    getSharedFilesOverride(),

    // UI components
    {
      files: [
        `${sourceRoot}components/ui/**/*.tsx`,
        `${sourceRoot}components/ui/**/*.jsx`,
        `${sourceRoot}components/custom/ui/**/*.tsx`,
        `${sourceRoot}components/custom/ui/**/*.jsx`,
      ],
      rules: {
        "ui-standards/no-classname-outside-ui": "off",
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
  ];
}

/**
 * Component-structure, view-gate and view-memo overrides.
 * @param sourceRoot - Prefix for source-relative file globs
 * @returns ESLint flat config objects enforcing component structure
 */
export function getExpoStructureOverrides(
  sourceRoot: string
): import("eslint").Linter.Config[] {
  return [
    // Component structure rules
    {
      files: [
        `${sourceRoot}features/**/components/**/*.ts`,
        `${sourceRoot}features/**/components/**/*.tsx`,
        `${sourceRoot}features/**/components/**/*.jsx`,
        `${sourceRoot}features/**/screens/**/*.ts`,
        `${sourceRoot}features/**/screens/**/*.tsx`,
        `${sourceRoot}features/**/screens/**/*.jsx`,
        `${sourceRoot}components/**/*.ts`,
        `${sourceRoot}components/**/*.tsx`,
        `${sourceRoot}components/**/*.jsx`,
      ],
      ignores: [
        `${sourceRoot}components/ui/**`,
        `${sourceRoot}components/shared/**`,
        `${sourceRoot}components/icons/**`,
      ],
      rules: {
        "component-structure/enforce-component-structure": "error",
        "component-structure/single-component-per-file": "error",
      },
    },

    // View gate: no statements, no hooks. See `view-gate.ts` for why it is
    // stated as those two properties and not as "Views are pure functions".
    ...getViewGateConfigs(sourceRoot),

    // View memo requirement (excluding UI components)
    {
      files: ["**/*View.tsx", "**/*View.jsx"],
      ignores: [`${sourceRoot}components/ui/**`],
      rules: {
        "component-structure/require-memo-in-view": "error",
      },
    },
  ];
}

/**
 * Files allowed to read process.env directly: the env module, the tests that
 * mock it, and configuration files.
 * @returns ESLint flat config objects relaxing the env ban
 */
export function getExpoEnvOverrides() {
  return [
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

/**
 * The oxlint hand-off presets and the jsx-a11y strict restore that must follow
 * them.
 * @returns ESLint flat config objects that close the Expo config
 */
export function getExpoOxlintConfigs() {
  return [
    // eslint-plugin-oxlint: turn off ESLint rules covered by oxlint, including
    // the React/JSX-A11y/perf rule sets specific to Expo. Must come last so
    // disables override prior enables.
    ...oxlint.configs["flat/react"],
    ...oxlint.configs["flat/jsx-a11y"],

    // Keep these four blocking, exactly as jsx-a11y `strict` sets them above.
    // From eslint-plugin-oxlint 1.63.0–1.65.0 the `flat/jsx-a11y` preset turns
    // them off because oxlint implements them, but oxlint reports them only as
    // correctness-category warnings, which never fail lint. Must come after the
    // preset so it wins (#4508).
    {
      name: "lisa/jsx-a11y-strict-restore",
      rules: Object.fromEntries(
        OXLINT_HANDED_OFF_A11Y_RULES.map(rule => [
          rule,
          jsxA11y.flatConfigs.strict.rules[rule],
        ])
      ),
    },
  ];
}
