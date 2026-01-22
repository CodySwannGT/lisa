/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint plugin for component structure standards
 *
 * This plugin enforces component structure and patterns for React components
 * in the frontend application. Supports ESLint 9 flat config format.
 *
 * Rules:
 * - enforce-component-structure: Ensures components follow the Container/View pattern
 * - no-return-in-view: Disallows return statements in View components
 * - require-memo-in-view: Enforces React.memo usage in View components
 * - single-component-per-file: Ensures only one React component per file
 * @module eslint-plugin-component-structure
 */
const enforceComponentStructure = require("./rules/enforce-component-structure");
const noReturnInView = require("./rules/no-return-in-view");
const requireMemoInView = require("./rules/require-memo-in-view");
const singleComponentPerFile = require("./rules/single-component-per-file");

const plugin = {
  meta: {
    name: "eslint-plugin-component-structure",
    version: "1.0.0",
  },
  rules: {
    "enforce-component-structure": enforceComponentStructure,
    "no-return-in-view": noReturnInView,
    "require-memo-in-view": requireMemoInView,
    "single-component-per-file": singleComponentPerFile,
  },
};

module.exports = plugin;
