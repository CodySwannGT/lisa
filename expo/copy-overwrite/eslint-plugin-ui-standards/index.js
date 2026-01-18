/**
 * ESLint plugin for UI standards
 *
 * This plugin enforces UI-related coding standards for React Native components.
 * Supports ESLint 9 flat config format.
 *
 * Rules:
 * - no-classname-outside-ui: Disallows className prop outside UI components
 * - no-direct-rn-imports: Disallows direct React Native imports
 * - no-inline-styles: Disallows inline style objects
 * @module eslint-plugin-ui-standards
 */
const noClassnameOutsideUi = require("./rules/no-classname-outside-ui");
const noDirectRnImports = require("./rules/no-direct-rn-imports");
const noInlineStyles = require("./rules/no-inline-styles");

const plugin = {
  meta: {
    name: "eslint-plugin-ui-standards",
    version: "1.0.0",
  },
  rules: {
    "no-classname-outside-ui": noClassnameOutsideUi,
    "no-direct-rn-imports": noDirectRnImports,
    "no-inline-styles": noInlineStyles,
  },
};

module.exports = plugin;
