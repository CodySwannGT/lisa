/**
 * This file is managed by Lisa and IS replaced on each `lisa` run.
 * Do not edit directly — durable changes belong upstream in Lisa.
 */

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
import { readFileSync } from "fs";
import { createRequire } from "module";
import path from "path";

// Import TypeScript config and utilities from the Lisa package
// (eslint.typescript.ts is no longer deployed to downstream projects)
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
} from "@codyswann/lisa/eslint/typescript";

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
const componentStructure = require("@codyswann/eslint-plugin-component-structure");
const uiStandards = require("@codyswann/eslint-plugin-ui-standards");
const expoConfig = require("eslint-config-expo/flat");

/**
 * React's hook named exports, banned from a View's import list.
 *
 * An enumeration is correct HERE and nowhere else: React's hook set is fixed and
 * published, and this is the import-line axis. The call-site axis
 * (`component-structure/no-hooks-in-view`) matches by shape precisely because a
 * project-local custom hook can never appear on a list like this one.
 */
const REACT_HOOK_IMPORT_NAMES = [
  "useActionState",
  "useCallback",
  "useContext",
  "useDebugValue",
  "useDeferredValue",
  "useEffect",
  "useEffectEvent",
  "useId",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
  "useOptimistic",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
];

/** What a developer is told when a View imports a hook. */
const VIEW_HOOK_IMPORT_MESSAGE =
  "View components must not use hooks. Move the hook into the corresponding Container and pass its result down as a prop.";

/**
 * A project's `.lisa.config.json`, when it has one.
 *
 * Absence is not an error: a project that has never run `lisa apply` has no
 * such file and declares no axes.
 * @param file - Absolute path to the candidate `.lisa.config.json`.
 * @returns Its text, or undefined when the project has no such file.
 */
function readConfigText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Axes a project declares typed, read from its own `.lisa.config.json`.
 *
 * #2807: the design-value rule shipped installed, severity `"off"`, and arming
 * it needed a severity AND a `typedAxes` option hand-written into
 * `eslint.config.local.ts`. Nothing carried `design.tokens.axes` from
 * `.lisa.config.json` to the rule, so a project could declare every axis,
 * install the policy, pass every test, and enforce nothing.
 *
 * It is read HERE, at ESLint **config** load, rather than inside the rule at
 * **rule** load. That distinction is what makes it unremarkable: the managed
 * `eslint.config.ts` already reads `eslint.thresholds.json` and
 * `eslint.ignore.config.json` from disk at exactly this moment, so this adds no
 * new class of behaviour and gives ESLint's config cache nothing to fight. A
 * rule reading project files on every `create()` would do both.
 *
 * It also needs no generation step, which is what the alternative — emitting
 * rule options into a generated file during `lisa apply` — would have cost. A
 * generated file can go stale against the config it was generated from; a value
 * read at load cannot.
 * @param projectRoot - Directory holding the project's `.lisa.config.json`.
 * @returns The declared axes, or an empty list when none are declared.
 * @throws {TypeError} When `design.tokens.axes` is present but is not a list of strings.
 */
export function readTypedAxes(projectRoot: string): string[] {
  const file = path.join(projectRoot, ".lisa.config.json");
  const raw = readConfigText(file);
  if (raw === undefined) return [];
  const axes = (JSON.parse(raw) as { design?: { tokens?: { axes?: unknown } } })
    .design?.tokens?.axes;
  if (axes === undefined) return [];
  if (!Array.isArray(axes) || axes.some(axis => typeof axis !== "string")) {
    // Coercing a malformed declaration to "no axes" would disarm the rule
    // silently — #2807 reproduced one layer down. Refuse loudly instead.
    throw new TypeError(
      `${file}: design.tokens.axes must be an array of axis names, e.g. ["color"].`
    );
  }
  return axes as string[];
}

/**
 * The `ui-standards/no-unbound-design-value` entry for a set of typed axes.
 *
 * Silence-by-default is deliberate and unchanged: an axis with no published
 * variable collection behind it has no token to bind to, and a rule that fires
 * on every project is a rule that gets switched off. What changes is that
 * declaring an axis is now SUFFICIENT to arm it. Previously nothing was.
 *
 * An axis name outside the rule's fixed vocabulary is passed through rather
 * than filtered out, so ESLint's own schema validation rejects it by name. A
 * filter would turn a typo into silent non-enforcement, which is the defect
 * this function exists to remove.
 * @param typedAxes - Axes the project declares typed.
 * @returns `"off"` when none are declared, an armed error entry otherwise.
 */
export function getDesignValueBindingRule(
  typedAxes: readonly string[]
): import("eslint").Linter.RuleEntry {
  return typedAxes.length > 0
    ? ["error", { typedAxes: [...typedAxes] }]
    : "off";
}

/**
 * Creates the Expo ESLint configuration.
 * @param {object} options - Configuration options
 * @param {string} options.tsconfigRootDir - Root directory for tsconfig.json
 * @param {string[]} [options.ignorePatterns] - Patterns to ignore
 * @param {object} [options.thresholds] - Threshold overrides
 * @param {string[]} [options.typedAxes] - Axes the project declares typed, mirroring `design.tokens.axes`. Empty leaves the design-value rule off.
 * @returns {Array} ESLint flat config array
 */
export function getExpoConfig({
  tsconfigRootDir,
  ignorePatterns = defaultIgnores,
  thresholds = defaultThresholds,
  typedAxes = [],
}: {
  tsconfigRootDir: string;
  ignorePatterns?: string[];
  thresholds?: typeof defaultThresholds;
  typedAxes?: readonly string[];
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
        // Regime-aware by declaration: silent until the project names the axes
        // it publishes design variables for. Declaring `design.tokens.axes` in
        // .lisa.config.json is what arms it — the managed eslint.config.ts
        // reads that key and hands it here (#2807). Declaring nothing leaves
        // the rule off, which is the correct default and was previously the
        // ONLY reachable state.
        "ui-standards/no-unbound-design-value":
          getDesignValueBindingRule(typedAxes),

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

    // View component rules: no statements, no hooks.
    //
    // Stated as those two properties rather than as "Views are pure functions",
    // which is a guarantee neither rule delivers — `{Date.now()}` and
    // `{Math.random() > 0.5 ? … : …}` sit happily in an expression body. The
    // skill claiming an enforcement it did not have is what let a hook live in
    // a View for so long; the fix must not repeat the shape of the defect.
    {
      files: ["**/*View.tsx", "**/*View.jsx"],
      rules: {
        "component-structure/no-return-in-view": "error",
      },
    },

    // View hook ban, on two independent axes.
    //
    // `no-hooks-in-view` matches the CALL by shape (`use` + uppercase), so a
    // project-local custom hook is caught where an enumerated name list would
    // miss it. `no-restricted-imports` catches the IMPORT LINE, before a call
    // site exists. Neither subsumes the other: a hook re-exported through a
    // barrel escapes the import patterns, and an import with no call yet
    // escapes the call matcher.
    //
    // `paths` may enumerate here because React's hook set is fixed and
    // published; the generic half is the rule, not this list. Scope matches the
    // Container/View pattern's own applicability table, and the base
    // `@/features/*/*` restriction is carried forward because a flat-config
    // override replaces a rule's options wholesale.
    {
      files: ["**/*View.tsx", "**/*View.jsx"],
      ignores: [
        "components/ui/**",
        "components/shared/**",
        "components/icons/**",
      ],
      rules: {
        "component-structure/no-hooks-in-view": "error",
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "react",
                importNames: REACT_HOOK_IMPORT_NAMES,
                message: VIEW_HOOK_IMPORT_MESSAGE,
              },
            ],
            patterns: [
              // Objects, not a mix: `no-restricted-imports` accepts an array of
              // strings OR an array of objects, never both, and a mixed array
              // is a schema error that disables the whole override.
              { group: ["@/features/*/*"] },
              {
                group: ["**/hooks/**", "@/hooks/**", "~/hooks/**"],
                message: VIEW_HOOK_IMPORT_MESSAGE,
              },
            ],
          },
        ],
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
