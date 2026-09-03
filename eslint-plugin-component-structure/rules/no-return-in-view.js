/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint rule requiring a View component to be an expression-bodied arrow.
 *
 * Stated that way on purpose. The rule used to be stated as "no return
 * statements", registered exactly one `ArrowFunctionExpression` visitor, and
 * nothing anywhere required a View to be an arrow function — so
 * `const XView = (...) => { ... }` was blocked while `function XView(...) { ... }`
 * was never visited and reported nothing, with `require-memo-in-view` still
 * passing because it checks the export. Writing `function` instead of `const`
 * was a silent, complete, permanent opt-out of the only statement gate on Views.
 *
 * An expression body is a property a `FunctionDeclaration` cannot have, so
 * requiring it bans declaration form by construction — no prose scanning, no
 * substring match on the word "function" (which fires on JSDoc, on local render
 * helpers, and on disable-comment justifications), and no false-positive
 * surface.
 *
 * What this rule guarantees is "no statement list". It is NOT a purity gate:
 * `{Date.now()}` and `{Math.random() > 0.5 ? … : …}` sit happily in an
 * expression body. Hooks are the other half and are `no-hooks-in-view`'s job.
 * @module eslint-plugin-component-structure/rules/no-return-in-view
 */

const { isEnforcedViewFile } = require("../lib/view-file-scope");

/**
 * Whether an identifier names a View component by spelling.
 * @param {string} name - The declared identifier.
 * @returns {boolean} True for a PascalCase name containing "View".
 */
const isViewComponentName = name =>
  /^[A-Z]/u.test(name) && name.includes("View");

/**
 * The binding a function expression or arrow is assigned to, if any.
 * @param {object} node - The function node.
 * @returns {string|null} The declared name, or null when there is none.
 */
function declaredName(node) {
  const parent = node.parent;
  return parent &&
    parent.type === "VariableDeclarator" &&
    parent.id.type === "Identifier"
    ? parent.id.name
    : null;
}

/**
 * The identifier a default export ultimately names.
 *
 * Unwraps `memo(X)` and `React.memo(X)` so the component the file actually
 * exports is recognised whatever it is called. Without this the rule would
 * depend on the identifier containing the word "View", and a file named
 * `HomeScreenView.tsx` exporting `HomeScreen` would slip through — the same
 * class of spelling-dependent hole the rule is being fixed for.
 * @param {object} declaration - The `export default` declaration node.
 * @returns {string|null} The exported identifier, or null.
 */
function defaultExportedName(declaration) {
  if (declaration.type === "Identifier") {
    return declaration.name;
  }

  if (declaration.type !== "CallExpression") {
    return null;
  }

  const [firstArgument] = declaration.arguments;
  return firstArgument && firstArgument.type === "Identifier"
    ? firstArgument.name
    : null;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require View components to be arrow functions with an expression body (no statements)",
      category: "Best Practices",
      recommended: true,
    },
    fixable: null,
    schema: [],
    messages: {
      noReturnInView:
        "View components must use an expression body: () => (...) instead of () => { return (...) }. Hoist any definitions outside of the arrow function body or into the corresponding Container.",
      mustBeArrowFunction:
        "View components must be an arrow function with an expression body: const {{name}} = (props) => (...). A function declaration or function expression cannot have one, so it always carries a statement list — move that logic into the corresponding Container.",
    },
  },

  create(context) {
    if (!isEnforcedViewFile(context.getFilename())) {
      return {};
    }

    /** Statement-bodied functions that are not arrows, pending a verdict. */
    const nonArrowCandidates = [];
    /** Names the default export resolves to. */
    const exportedNames = new Set();

    /**
     * Record a non-arrow function that may be this file's View component.
     * @param {object} node - The FunctionDeclaration or FunctionExpression.
     * @param {string|null} name - Its declared name, when it has one.
     * @returns {void}
     */
    const considerNonArrow = (node, name) => {
      const isDefaultExported =
        node.parent && node.parent.type === "ExportDefaultDeclaration";
      nonArrowCandidates.push({ node, name, isDefaultExported });
    };

    return {
      ArrowFunctionExpression(node) {
        const parent = node.parent;
        const name = declaredName(node);
        const isComponent =
          (parent && parent.type === "ExportDefaultDeclaration") ||
          (name !== null && isViewComponentName(name));

        if (isComponent && node.body.type === "BlockStatement") {
          context.report({ node, messageId: "noReturnInView" });
        }
      },

      FunctionDeclaration(node) {
        considerNonArrow(node, node.id ? node.id.name : null);
      },

      FunctionExpression(node) {
        considerNonArrow(node, declaredName(node));
      },

      ExportDefaultDeclaration(node) {
        const name = defaultExportedName(node.declaration);
        if (name !== null) {
          exportedNames.add(name);
        }
      },

      "Program:exit"() {
        nonArrowCandidates
          .filter(
            candidate =>
              candidate.isDefaultExported ||
              (candidate.name !== null &&
                (isViewComponentName(candidate.name) ||
                  exportedNames.has(candidate.name)))
          )
          .forEach(candidate => {
            context.report({
              node: candidate.node,
              messageId: "mustBeArrowFunction",
              data: { name: candidate.name ?? "ComponentView" },
            });
          });
      },
    };
  },
};
