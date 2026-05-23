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
    ignores: [
      "all/**",
      "cdk/**",
      "expo/**",
      "nestjs/**",
      "npm-package/**",
      "typescript/**",
      "plugins/**",
    ],
  },
];
