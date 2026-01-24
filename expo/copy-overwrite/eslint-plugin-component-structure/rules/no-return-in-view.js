/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow return statements in View components - use arrow function shorthand",
      category: "Best Practices",
      recommended: true,
    },
    fixable: null,
    schema: [],
    messages: {
      noReturnInView:
        "View components should use arrow function shorthand: () => (...) instead of () => { return (...) }. Hoist any definitions outside of the arrow function body or into the corresponding Container.",
    },
  },

  create(context) {
    const filename = context.getFilename();
    const normalizedPath = filename.replace(/\\/g, "/");

    // Only check View.tsx and View.jsx files
    if (!filename.endsWith("View.tsx") && !filename.endsWith("View.jsx")) {
      return {};
    }

    // Check if file is in features/**/components, features/**/screens, or components directory
    const isFeatureComponent =
      normalizedPath.includes("features/") &&
      normalizedPath.includes("/components/");
    const isFeatureScreen =
      normalizedPath.includes("features/") &&
      normalizedPath.includes("/screens/");
    const isComponentsDir =
      normalizedPath.includes("/components/") &&
      !normalizedPath.includes("/components/ui/") &&
      !normalizedPath.includes("/components/custom/ui/");

    if (!isFeatureComponent && !isFeatureScreen && !isComponentsDir) {
      return {};
    }

    return {
      ArrowFunctionExpression(node) {
        // Check if this is a component (starts with capital letter or is exported)
        const parent = node.parent;

        // Helper to check if variable has a View component name
        const isViewComponent = name =>
          /^[A-Z]/.test(name) && name.includes("View");

        // Determine if this is a component
        const isComponent = (() => {
          // Check if it's a default export
          if (parent.type === "ExportDefaultDeclaration") {
            return true;
          }

          // Check if it's a variable declaration with PascalCase name
          if (
            parent.type === "VariableDeclarator" &&
            parent.id.type === "Identifier"
          ) {
            return isViewComponent(parent.id.name);
          }

          // Check if it's part of an export statement
          if (
            parent.type === "VariableDeclarator" &&
            parent.parent.type === "VariableDeclaration" &&
            parent.parent.parent.type === "ExportNamedDeclaration"
          ) {
            return isViewComponent(parent.id.name);
          }

          return false;
        })();

        if (!isComponent) return;

        // Check if the arrow function has a block body (any BlockStatement is forbidden)
        if (node.body.type === "BlockStatement") {
          context.report({
            node,
            messageId: "noReturnInView",
          });
        }
      },
    };
  },
};
