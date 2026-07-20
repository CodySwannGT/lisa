/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint rule to enforce statement order in all functions
 *
 * Enforces the following order:
 * 1. Definitions: Variable declarations (const/let/var) and function declarations
 * 2. Side effects: Expression statements that are function calls
 * 3. Return statement
 *
 * Applies to all functions: hooks, components, utilities, etc.
 * @type {import('eslint').Rule.RuleModule}
 */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce statement order: definitions → side effects → return",
      category: "Best Practices",
      recommended: true,
    },
    fixable: null,
    schema: [
      {
        type: "object",
        properties: {
          checkAwaitedCalls: {
            type: "boolean",
          },
          checkAllFunctionBodies: {
            type: "boolean",
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      wrongOrder:
        "{{current}} should come before {{previous}}. Expected order: definitions → side effects → return statement (tip: `if` statements are exempt from ordering checks — inline validation as an `if` guard clause instead of calling a helper)",
    },
  },

  create(context) {
    const ORDER = {
      DEFINITION: 1, // Variable declarations, function declarations
      SIDE_EFFECT: 2, // Expression statements with function calls
      RETURN: 3, // Return statement
    };

    const ORDER_NAMES = {
      [ORDER.DEFINITION]: "Definitions",
      [ORDER.SIDE_EFFECT]: "Side effects",
      [ORDER.RETURN]: "Return statement",
    };
    const options = context.options[0] || {};
    const checkAwaitedCalls = options.checkAwaitedCalls !== false;
    const checkAllFunctionBodies = options.checkAllFunctionBodies !== false;

    /**
     * Removes transparent wrappers around a candidate side-effect expression.
     * @param {import('eslint').Rule.Node | null | undefined} expression - Expression node
     * @returns {import('eslint').Rule.Node | null | undefined} Unwrapped expression node
     */
    function unwrapExpression(expression) {
      if (
        expression &&
        ((checkAwaitedCalls && expression.type === "AwaitExpression") ||
          expression.type === "ChainExpression")
      ) {
        return unwrapExpression(expression.expression || expression.argument);
      }

      return expression;
    }

    /**
     * Checks if an expression statement is a function call (side effect)
     * @param {import('eslint').Rule.Node} statement - AST node
     * @returns {boolean} True if this is a function call expression
     */
    function isFunctionCallExpression(statement) {
      if (statement.type !== "ExpressionStatement") {
        return false;
      }

      const expression = unwrapExpression(statement.expression);

      // Direct call: doSomething() or object.method()
      return Boolean(expression && expression.type === "CallExpression");
    }

    /**
     * Determines the order category of a statement
     * Guard clauses (if statements with early returns) are ignored and don't
     * affect order validation - they can appear anywhere in the function.
     * @param {import('eslint').Rule.Node} statement - AST node
     * @returns {number|null} Order category value, or null to skip this statement
     */
    function getStatementOrder(statement) {
      // Bare return statement (not in an if block)
      if (statement.type === "ReturnStatement") {
        return ORDER.RETURN;
      }

      // If statements are ignored - they may contain guard clauses (early returns)
      // which are valid at any position in the function
      if (statement.type === "IfStatement") {
        return null;
      }

      // Variable declarations are definitions
      if (statement.type === "VariableDeclaration") {
        return ORDER.DEFINITION;
      }

      // Function declarations are definitions
      if (statement.type === "FunctionDeclaration") {
        return ORDER.DEFINITION;
      }

      // super(...) is a language-mandated constructor prologue: it must run
      // before any `this` access, so definitions that follow it are
      // unavoidable. Treat it as order-neutral rather than a side effect.
      if (statement.type === "ExpressionStatement") {
        const expression = unwrapExpression(statement.expression);

        if (
          expression &&
          expression.type === "CallExpression" &&
          expression.callee.type === "Super"
        ) {
          return null;
        }
      }

      // Expression statements with function calls are side effects
      if (isFunctionCallExpression(statement)) {
        return ORDER.SIDE_EFFECT;
      }

      // Default to null for other statements (they don't affect order)
      return null;
    }

    /**
     * Checks if a function body follows the correct statement order
     * @param {import('eslint').Rule.Node} node - Function node
     */
    function checkBodyOrder(node) {
      if (!node.body || node.body.type !== "BlockStatement") {
        return;
      }

      const statements = node.body.body;
      // eslint-disable-next-line functional/no-let -- ESLint plugin requires mutable tracking variable for order validation
      let maxOrderSeen = 0;

      statements.forEach(statement => {
        const currentOrder = getStatementOrder(statement);

        // Skip statements that don't affect order (e.g., if statements)
        if (currentOrder === null) {
          return;
        }

        if (currentOrder < maxOrderSeen) {
          context.report({
            node: statement,
            messageId: "wrongOrder",
            data: {
              current: ORDER_NAMES[currentOrder],
              previous: ORDER_NAMES[maxOrderSeen],
            },
          });
        }

        // Track the highest order we've seen so far
        if (currentOrder > maxOrderSeen) {
          maxOrderSeen = currentOrder;
        }
      });
    }

    if (checkAllFunctionBodies) {
      return {
        "FunctionDeclaration, FunctionExpression, ArrowFunctionExpression"(
          node
        ) {
          checkBodyOrder(node);
        },
      };
    }

    return {
      FunctionDeclaration(node) {
        checkBodyOrder(node);
      },

      VariableDeclarator(node) {
        if (
          node.init &&
          (node.init.type === "ArrowFunctionExpression" ||
            node.init.type === "FunctionExpression")
        ) {
          checkBodyOrder(node.init);
        }
      },
    };
  },
};
