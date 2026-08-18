/**
 * ESLint 9 Flat Config - Project-Local Customizations
 *
 * Add project-specific ESLint rules here. This file is create-only,
 * meaning Lisa will create it but never overwrite your customizations.
 *
 * Example:
 * ```ts
 * export default [
 *   {
 *     files: ["src/legacy/**"],
 *     rules: {
 *       "@typescript-eslint/no-explicit-any": "off",
 *     },
 *   },
 * ];
 * ```
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @module eslint.config.local
 */
export default [
  {
    // Lisa-specific: ignore distributable payloads that are copied/published to other
    // projects, not part of this monorepo's app source. plugins/** also covers GENERATED
    // build artifacts (plugins/lisa, plugins/lisa-*) which must never be auto-fixed —
    // a lint --fix there would desync them from plugins/src and break check:plugins.
    // wiki/** is the LLM Wiki content (markdown + JSON config/state cursors), not app
    // code, so app lint rules (e.g. sonarjs/no-duplicate-string on the config) don't apply.
    ignores: [
      "all/**",
      "cdk/**",
      "expo/**",
      "nestjs/**",
      "npm-package/**",
      "typescript/**",
      "plugins/**",
      "wiki/**",
      // OpenCode plugin templates: copied verbatim into a host project's
      // `.opencode/plugin/` and executed under OpenCode's Bun runtime, NOT this
      // monorepo's runtime. They use Bun globals (`Bun`, `$`) and the OpenCode
      // plugin shape, so this repo's functional/jsdoc rules don't apply.
      "src/opencode/plugin-templates/**",
    ],
  },
  {
    // Shared test fixtures. `**/*.test.ts` is already exempt from the app's
    // `process.env` restriction because a test must be able to construct the
    // environment it puts a subject under; a helper extracted OUT of a test file
    // to stop three suites drifting onto different environments is the same code
    // doing the same job, and should not be pushed back inline to satisfy a rule
    // aimed at application configuration access.
    files: ["tests/**/support/**"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    rules: {
      // Lisa's own codebase has existing awaited and nested-function side effects
      // before later declarations. Keep the published rule stricter by default
      // while this repo carries that cleanup as separate follow-up work.
      "code-organization/enforce-statement-order": [
        "error",
        { checkAllFunctionBodies: false, checkAwaitedCalls: false },
      ],
    },
  },
  {
    // The block above is global, and a project-local config is spread AFTER the
    // Lisa factory — so it silently re-enabled a rule the shipped scripts
    // profile turns off for `scripts/**`. Re-apply the shipped decision here.
    // A maintenance script is one linear procedure; declaration-order rules are
    // tuned for composed application modules.
    files: ["scripts/**", "**/scripts/**"],
    rules: {
      "code-organization/enforce-statement-order": "off",
    },
  },
];
