/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint plugin for code organization standards
 *
 * This plugin enforces code organization patterns for all functions
 * in the frontend application. Supports ESLint 9 flat config format.
 *
 * Rules:
 * - enforce-statement-order: Ensures statements follow the order (definitions -> side effects -> return)
 * @module eslint-plugin-code-organization
 */
const enforceStatementOrder = require("./rules/enforce-statement-order");

const plugin = {
  meta: {
    name: "eslint-plugin-code-organization",
    version: "1.0.0",
  },
  rules: {
    "enforce-statement-order": enforceStatementOrder,
  },
};

module.exports = plugin;
