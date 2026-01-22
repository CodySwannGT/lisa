/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint rule to enforce React.memo usage with displayName in View components
 *
 * This rule ensures that all View components (*View.tsx, *View.jsx) follow the standardized pattern:
 * - Must be wrapped with memo() or React.memo() in the default export
 * - Must have a displayName property
 *
 * Excludes components/ui/** and components/custom/ui/** directories (third-party generated files)
 * @module eslint-plugin-component-structure/rules/require-memo-in-view
 */

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce React.memo usage with displayName in View components",
      category: "Best Practices",
      recommended: true,
    },
    schema: [],
    messages: {
      missingMemo:
        "View components must be wrapped with memo(). Expected: export default memo({{componentName}})",
      missingDisplayName:
        'View components must have a displayName property. Expected: {{componentName}}.displayName = "{{componentName}}"',
    },
  },

  create(context) {
    const filename = context.getFilename();
    const normalizedPath = filename.replace(/\\/g, "/");

    // Only check View.tsx and View.jsx files
    if (!filename.endsWith("View.tsx") && !filename.endsWith("View.jsx")) {
      return {};
    }

    // Exclude components/ui/** and components/custom/ui/** directories
    if (
      normalizedPath.includes("/components/ui/") ||
      normalizedPath.includes("/components/custom/ui/")
    ) {
      return {};
    }

    // Check if file is in features/**/components, features/**/screens, or components directory
    const isFeatureComponent =
      normalizedPath.includes("features/") &&
      normalizedPath.includes("/components/");
    const isFeatureScreen =
      normalizedPath.includes("features/") &&
      normalizedPath.includes("/screens/");
    const isComponentsDir = normalizedPath.includes("/components/");

    if (!isFeatureComponent && !isFeatureScreen && !isComponentsDir) {
      return {};
    }

    const state = {
      componentName: null,
      hasMemoImport: false,
      hasMemoWrapper: false,
      hasDisplayName: false,
      exportNode: null,
    };

    return {
      ImportDeclaration(node) {
        // Check if memo is imported from 'react'
        if (node.source.value === "react") {
          const memoImport = node.specifiers.find(
            spec =>
              spec.type === "ImportSpecifier" && spec.imported.name === "memo"
          );
          if (memoImport) {
            state.hasMemoImport = true;
          }
        }
      },

      VariableDeclarator(node) {
        // Find the component name from variable declaration
        if (
          node.id.type === "Identifier" &&
          /^[A-Z]/.test(node.id.name) &&
          node.id.name.includes("View")
        ) {
          state.componentName = node.id.name;
        }
      },

      AssignmentExpression(node) {
        // Check for displayName assignment
        if (
          node.left.type === "MemberExpression" &&
          node.left.property.name === "displayName" &&
          node.left.object.type === "Identifier"
        ) {
          const componentName = node.left.object.name;
          if (
            componentName === state.componentName ||
            /^[A-Z]/.test(componentName)
          ) {
            state.hasDisplayName = true;
          }
        }
      },

      ExportDefaultDeclaration(node) {
        state.exportNode = node;

        // Check if the default export is wrapped with memo()
        if (node.declaration.type === "CallExpression") {
          const callee = node.declaration.callee;

          // Check for memo() or React.memo()
          const isMemoCall =
            (callee.type === "Identifier" && callee.name === "memo") ||
            (callee.type === "MemberExpression" &&
              callee.object.name === "React" &&
              callee.property.name === "memo");

          if (isMemoCall) {
            state.hasMemoWrapper = true;

            // If using React.memo, ensure memo is imported from 'react'
            if (callee.type === "MemberExpression" && !state.hasMemoImport) {
              // React.memo is allowed, but we prefer direct memo import
              // Store that we found React.memo usage
              state.hasReactMemo = true;
            }

            // Get the component name from the memo argument
            const firstArg = node.declaration.arguments[0];
            if (
              firstArg &&
              firstArg.type === "Identifier" &&
              !state.componentName
            ) {
              state.componentName = firstArg.name;
            }
          }
        } else if (
          node.declaration.type === "Identifier" &&
          !state.componentName
        ) {
          // Component exported without memo wrapper
          state.componentName = node.declaration.name;
        }
      },

      "Program:exit"() {
        if (!state.exportNode || !state.componentName) {
          return;
        }

        // Report missing memo wrapper
        if (!state.hasMemoWrapper) {
          context.report({
            node: state.exportNode,
            messageId: "missingMemo",
            data: { componentName: state.componentName },
          });
        }

        // Report missing displayName
        if (!state.hasDisplayName) {
          context.report({
            node: state.exportNode,
            messageId: "missingDisplayName",
            data: { componentName: state.componentName },
          });
        }
      },
    };
  },
};
