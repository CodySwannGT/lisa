/**
 * ESLint 9 Flat Config - Shared Rules
 *
 * The rule set every Lisa stack (TypeScript, Expo, NestJS, CDK) applies
 * identically, grouped by concern. `getSharedRules` composes the groups in a
 * fixed order; `base.ts` re-exports it as part of the published surface.
 * @module configs/eslint/shared-rules
 */

/** Threshold values for the configurable size and complexity rules. */
export interface SharedRuleThresholds {
  /** Max cognitive complexity per function. */
  readonly cognitiveComplexity: number;
  /** Max lines per file. */
  readonly maxLines: number;
  /** Max lines per function. */
  readonly maxLinesPerFunction: number;
}

/**
 * Formatting and import-boundary rules.
 * @returns Rules for prettier and restricted imports
 */
const getLeadingRules = () => ({
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
});

/**
 * File and function size limits.
 * @param thresholds - Threshold values for the size rules
 * @returns Rules for max-lines and max-lines-per-function
 */
const getSizeRules = (thresholds: SharedRuleThresholds) => ({
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
});

/**
 * SonarJS code-quality rules.
 * @param thresholds - Threshold values for the complexity rule
 * @returns SonarJS rule settings
 */
const getSonarRules = (thresholds: SharedRuleThresholds) => ({
  // Folder naming
  // NOTE: eslint-plugin-folders is not compatible with ESLint 9 flat config
  // The rule has no schema defined and ESLint 9 validates rule options strictly
  // This needs to be addressed in a separate PR or the plugin needs to be updated
  // "folders/match-regex": ["error", "^([a-z][a-z0-9]*)(-[a-z0-9]+)*$", "/src/"],

  // SonarJS rules - threshold loaded from eslint.thresholds.config.json
  "sonarjs/cognitive-complexity": ["error", thresholds.cognitiveComplexity],
  "sonarjs/no-identical-functions": "error",
  "sonarjs/no-duplicate-string": "error",
  "sonarjs/no-nested-functions": "error",
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
  // This gives too many false positives
  "sonarjs/no-hardcoded-ip": "off",
  // This just seems to be wrong and gives all kinds of false positives
  "sonarjs/different-types-comparison": "off",
  // This duplicates another lint check
  "sonarjs/no-unused-vars": "off",
});

/**
 * ESLint-comment hygiene and general JavaScript rules.
 * @returns ESLint-comment and core rule settings
 */
const getGeneralRules = () => ({
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
});

/**
 * TypeScript-ESLint rules.
 * @returns TypeScript rule settings
 */
const getTypescriptRules = () => ({
  // TypeScript rules
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_|^unstable_settings$|^React$",
      caughtErrorsIgnorePattern: "^_",
      destructuredArrayIgnorePattern: "^_",
      ignoreRestSiblings: true,
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
});

/**
 * Functional-programming rules that work without type information.
 * @returns eslint-plugin-functional rule settings
 */
const getFunctionalRules = () => ({
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
});

/**
 * JSDoc documentation rules.
 * @returns eslint-plugin-jsdoc rule settings
 */
const getJsdocRules = () => ({
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
  // prettier-ignore
  "jsdoc/check-tag-names": ["error", { definedTags: ["remarks", "precondition", "entity", "security", "jest-config-loader", "jest-config-loader-options"] }],
  "jsdoc/no-types": "off",
  "jsdoc/require-param-type": "off",
  "jsdoc/require-returns-type": "off",
  "jsdoc/require-property-type": "off",
  // Keep these at the "warn" JSDoc's recommended-typescript-flavor gives them.
  // From eslint-plugin-oxlint 1.65.0 its `flat/jsdoc` preset turns both OFF,
  // because oxlint implements them — but in its pedantic category, and Lisa's
  // oxlint config enables only correctness, so nothing would check them. Shared
  // rules are spread after getBaseConfigs() in every stack, so this wins over
  // the preset and lets the forced oxlint range reach below 1.86.0 (#4508).
  "jsdoc/require-throws-type": "warn",
  "jsdoc/require-yields-type": "warn",
});

/**
 * Shared rules that apply to all TypeScript projects.
 * These are rules that should be identical across typescript, expo, nestjs, etc.
 * @param {object} thresholds - Threshold values for configurable rules
 * @param {number} thresholds.cognitiveComplexity - Max cognitive complexity
 * @param {number} thresholds.maxLines - Max lines per file
 * @param {number} thresholds.maxLinesPerFunction - Max lines per function
 * @returns {object} Rules configuration object
 */
export const getSharedRules = (thresholds: SharedRuleThresholds) => ({
  ...getLeadingRules(),
  ...getSizeRules(thresholds),
  ...getSonarRules(thresholds),
  ...getGeneralRules(),
  ...getTypescriptRules(),
  ...getFunctionalRules(),
  ...getJsdocRules(),
});
