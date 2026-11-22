/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Shared setup for the enforce-statement-order rule tests, which are split by
 * concern across several files.
 *
 * Enforces the order: definitions → side effects → return
 * 1. Definitions: const/let/var declarations, function declarations
 * 2. Side effects: Expression statements that are function calls
 * 3. Return statement
 */
const { RuleTester } = require("eslint");

const rule = require("../rules/enforce-statement-order");

/** Message data constants for test assertions */
const DEFINITIONS = "Definitions";
const SIDE_EFFECTS = "Side effects";
const RETURN_STATEMENT = "Return statement";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
});

module.exports = {
  DEFINITIONS,
  RETURN_STATEMENT,
  SIDE_EFFECTS,
  rule,
  ruleTester,
};
