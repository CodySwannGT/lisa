/**
 * ESLint rule to enforce exactly one React component per file
 *
 * This rule ensures that View and Container files contain only one React component.
 * A React component is defined as any PascalCase function that returns JSX.
 *
 * Applies to:
 * - *View.tsx, *View.jsx files
 * - *Container.tsx, *Container.jsx files
 *
 * Excludes:
 * - components/ui/** directory (third-party generated files)
 * - components/custom/ui/** directory (third-party generated files)
 * - components/shared/** directory (shared utility components)
 * @module eslint-plugin-component-structure/rules/single-component-per-file
 */

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce exactly one React component per View or Container file",
      category: "Best Practices",
      recommended: true,
    },
    schema: [],
    messages: {
      multipleComponents:
        "Only one React component is allowed per file. Found '{{componentName}}' in addition to '{{firstComponentName}}'. Extract '{{componentName}}' to a separate file.",
    },
  },

  create(context) {
    const filename = context.getFilename();
    const normalizedPath = filename.replace(/\\/g, "/");

    // Only check View and Container files
    const isViewOrContainer =
      filename.endsWith("View.tsx") ||
      filename.endsWith("View.jsx") ||
      filename.endsWith("Container.tsx") ||
      filename.endsWith("Container.jsx");

    if (!isViewOrContainer) {
      return {};
    }

    // Exclude components/ui/**, components/custom/ui/**, and components/shared/** directories
    if (
      normalizedPath.includes("/components/ui/") ||
      normalizedPath.includes("/components/custom/ui/") ||
      normalizedPath.includes("/components/shared/") ||
      normalizedPath.startsWith("components/ui/") ||
      normalizedPath.startsWith("components/custom/ui/") ||
      normalizedPath.startsWith("components/shared/")
    ) {
      return {};
    }

    // Check if file is in features/**/components directory or components directory
    const isFeatureComponent =
      normalizedPath.includes("/features/") &&
      normalizedPath.includes("/components/");
    const isComponentsDir =
      normalizedPath.includes("/components/") ||
      normalizedPath.startsWith("components/");

    if (!isFeatureComponent && !isComponentsDir) {
      return {};
    }

    const state = {
      components: [], // Array of { name, node }
      firstComponent: null,
    };

    /**
     * Recursively checks if an expression contains JSX
     * @param {object} node - AST node to check
     * @returns {boolean} True if expression contains JSX
     */
    const containsJSX = node => {
      if (!node) {
        return false;
      }

      const type = node.type;
      if (type === "JSXElement" || type === "JSXFragment") {
        return true;
      }

      // Check conditional expressions: condition ? consequent : alternate
      if (type === "ConditionalExpression") {
        return containsJSX(node.consequent) || containsJSX(node.alternate);
      }

      // Check logical expressions: left && right, left || right
      if (type === "LogicalExpression") {
        return containsJSX(node.left) || containsJSX(node.right);
      }

      // Check parenthesized expressions
      if (type === "ParenthesizedExpression") {
        return containsJSX(node.expression);
      }

      return false;
    };

    /**
     * Checks if a function returns JSX by examining its body
     * @param {object} node - AST node to check
     * @returns {boolean} True if function returns JSX
     */
    const returnsJSX = node => {
      if (!node || !node.body) {
        return false;
      }

      // Handle arrow function with direct JSX return (no block)
      if (node.type === "ArrowFunctionExpression") {
        return containsJSX(node.body);
      }

      // Handle function with block body
      if (node.body.type === "BlockStatement") {
        const hasJSXReturn = node.body.body.some(statement => {
          return (
            statement.type === "ReturnStatement" &&
            containsJSX(statement.argument)
          );
        });

        if (hasJSXReturn) {
          return true;
        }
      }

      return false;
    };

    /**
     * Records a component if it meets all criteria (PascalCase + returns JSX)
     * @param {string} name - Component name
     * @param {object} node - AST node
     * @param {object} functionNode - Function AST node
     */
    const recordComponent = (name, node, functionNode) => {
      // Check if name is PascalCase
      if (!/^[A-Z]/.test(name)) {
        return;
      }

      // Check if function returns JSX
      if (!returnsJSX(functionNode)) {
        return;
      }

      // This is a component - record it
      if (state.components.length === 0) {
        state.firstComponent = { name, node };
      }
      state.components.push({ name, node });
    };

    return {
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier") {
          return;
        }

        const name = node.id.name;

        // Check for arrow function assignment: const Component = () => <div />
        if (node.init && node.init.type === "ArrowFunctionExpression") {
          const jsxCheck = returnsJSX(node.init);
          if (jsxCheck) {
            recordComponent(name, node, node.init);
            return;
          }
        }

        // Check for memo-wrapped component: const Component = memo(() => <div />)
        if (
          node.init &&
          node.init.type === "CallExpression" &&
          ((node.init.callee.type === "Identifier" &&
            node.init.callee.name === "memo") ||
            (node.init.callee.type === "MemberExpression" &&
              node.init.callee.object.name === "React" &&
              node.init.callee.property.name === "memo"))
        ) {
          const firstArg = node.init.arguments[0];
          if (firstArg && returnsJSX(firstArg)) {
            recordComponent(name, node, firstArg);
            return;
          }
        }

        // Check for React.FC typed components: const Component: React.FC = () => <div />
        if (
          node.init &&
          node.init.type === "ArrowFunctionExpression" &&
          node.id.typeAnnotation &&
          returnsJSX(node.init)
        ) {
          recordComponent(name, node, node.init);
        }
      },

      FunctionDeclaration(node) {
        if (!node.id || node.id.type !== "Identifier") {
          return;
        }

        const name = node.id.name;
        recordComponent(name, node, node);
      },

      "Program:exit"() {
        // Report all components after the first one
        if (state.components.length > 1) {
          state.components.slice(1).forEach(component => {
            context.report({
              node: component.node,
              messageId: "multipleComponents",
              data: {
                componentName: component.name,
                firstComponentName: state.firstComponent.name,
              },
            });
          });
        }
      },
    };
  },
};
