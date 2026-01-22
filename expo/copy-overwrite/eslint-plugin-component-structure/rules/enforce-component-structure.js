/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

const fs = require("fs");
const path = require("path");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce component structure in features/**/components directories",
      category: "Best Practices",
      recommended: true,
    },
    fixable: null,
    schema: [],
    messages: {
      missingContainer:
        'Component directory "{{componentName}}" is missing {{componentName}}Container.tsx file',
      missingView:
        'Component directory "{{componentName}}" is missing {{componentName}}View.tsx file',
      missingIndex:
        'Component directory "{{componentName}}" is missing index.tsx file',
      incorrectIndexExport:
        "index.tsx should export {{componentName}}Container or {{componentName}}View as default",
      componentNotInDirectory:
        "Component files must be inside a directory named after the component",
      incorrectFileNaming: "{{fileName}} should be named {{expectedName}}",
      invalidFileInComponentDirectory:
        "Only index.ts(x), {{componentName}}Container.tsx, and {{componentName}}View.tsx are allowed in component directories. Found: {{fileName}}",
    },
  },

  create(context) {
    const filename = context.getFilename();
    const normalizedPath = filename.replace(/\\/g, "/");

    // Get the path after components/ or screens/
    const componentsMatch = normalizedPath.match(
      /\/(components|screens)\/(.+)$/
    );
    if (!componentsMatch) return {};
    const afterComponents = componentsMatch[2];

    const pathParts = afterComponents.split("/");

    // If file is directly in components/ directory (not in a subdirectory)
    if (pathParts.length === 1) {
      const fileName = pathParts[0];
      if (fileName.endsWith(".tsx") || fileName.endsWith(".jsx")) {
        context.report({
          node: context.getSourceCode().ast,
          messageId: "componentNotInDirectory",
        });
      }
      return {};
    }

    // Get component name and file name from the END of the path
    // This handles both ComponentName/file.tsx and custom/ui/ComponentName/file.tsx
    const fileName = pathParts[pathParts.length - 1];
    const componentName = pathParts[pathParts.length - 2];

    // Skip validation for files in __tests__ directories
    if (componentName === "__tests__") {
      return {};
    }

    // Only check .ts/.tsx/.jsx files
    if (
      !fileName ||
      (!fileName.endsWith(".ts") &&
        !fileName.endsWith(".tsx") &&
        !fileName.endsWith(".jsx"))
    ) {
      return {};
    }

    // Get the directory path
    const dirPath = path.dirname(filename);

    // Check if file is one of the allowed types
    const isIndex =
      fileName === "index.ts" ||
      fileName === "index.tsx" ||
      fileName === "index.jsx";

    // Allow *Container.*.tsx and *Container.*.jsx patterns (e.g., MyComponentContainer.native.tsx)
    const containerPattern = new RegExp(
      `^${componentName}Container\\.[^.]+\\.(tsx|jsx)$`
    );
    const isContainer =
      fileName === `${componentName}Container.tsx` ||
      fileName === `${componentName}Container.jsx` ||
      containerPattern.test(fileName);

    // Allow *View.*.tsx and *View.*.jsx patterns (e.g., MyComponentView.web.tsx)
    const viewPattern = new RegExp(
      `^${componentName}View\\.[^.]+\\.(tsx|jsx)$`
    );
    const isView =
      fileName === `${componentName}View.tsx` ||
      fileName === `${componentName}View.jsx` ||
      viewPattern.test(fileName);

    // Report error if file is not one of the allowed types
    if (!isIndex && !isContainer && !isView) {
      context.report({
        node: context.getSourceCode().ast,
        messageId: "invalidFileInComponentDirectory",
        data: { fileName, componentName },
      });
      return {};
    }

    // Check file naming
    if (
      fileName === "index.ts" ||
      fileName === "index.tsx" ||
      fileName === "index.jsx"
    ) {
      // Check if index.tsx exports the Container
      return {
        Program(node) {
          const sourceCode = context.getSourceCode();
          const text = sourceCode.getText();

          // Check for export patterns (allow Container or View)
          const defaultExportPattern = new RegExp(
            `export\\s*{\\s*default\\s*}\\s*from\\s*['"\`]\\.\\/${componentName}(Container|View)['"\`]|` +
              `export\\s*\\*\\s*from\\s*['"\`]\\.\\/${componentName}(Container|View)['"\`]|` +
              `export\\s*{\\s*${componentName}(Container|View)\\s*as\\s*default\\s*}|` +
              `export\\s*default\\s*${componentName}(Container|View)`
          );

          if (!defaultExportPattern.test(text)) {
            context.report({
              node,
              messageId: "incorrectIndexExport",
              data: { componentName },
            });
          }
        },
      };
    } else if (
      fileName.endsWith("Container.tsx") ||
      fileName.endsWith("Container.jsx")
    ) {
      const expectedName = `${componentName}Container.tsx`;
      if (
        fileName !== expectedName &&
        fileName !== `${componentName}Container.jsx`
      ) {
        context.report({
          node: context.getSourceCode().ast,
          messageId: "incorrectFileNaming",
          data: { fileName, expectedName },
        });
      }
    } else if (fileName.endsWith("View.tsx") || fileName.endsWith("View.jsx")) {
      const expectedName = `${componentName}View.tsx`;
      if (
        fileName !== expectedName &&
        fileName !== `${componentName}View.jsx`
      ) {
        context.report({
          node: context.getSourceCode().ast,
          messageId: "incorrectFileNaming",
          data: { fileName, expectedName },
        });
      }
    }

    // Check for required files in the directory (only once per directory)
    // We'll do this check only for the first file we encounter
    const cache = new Map();
    const checkRequiredFiles = () => {
      try {
        const files = cache.has(dirPath)
          ? cache.get(dirPath)
          : (() => {
              const dirFiles = fs.readdirSync(dirPath);
              cache.set(dirPath, dirFiles);
              return dirFiles;
            })();
        const hasContainer = files.some(
          f =>
            f === `${componentName}Container.tsx` ||
            f === `${componentName}Container.jsx`
        );
        const hasView = files.some(
          f =>
            f === `${componentName}View.tsx` || f === `${componentName}View.jsx`
        );
        const hasIndex = files.some(
          f => f === "index.tsx" || f === "index.jsx"
        );

        if (!hasContainer) {
          context.report({
            node: context.getSourceCode().ast,
            messageId: "missingContainer",
            data: { componentName },
          });
        }
        if (!hasView) {
          context.report({
            node: context.getSourceCode().ast,
            messageId: "missingView",
            data: { componentName },
          });
        }
        if (!hasIndex) {
          context.report({
            node: context.getSourceCode().ast,
            messageId: "missingIndex",
            data: { componentName },
          });
        }
      } catch (_err) {
        // Directory might not exist or be accessible
      }
    };

    // Only check once per file
    if (fileName === "index.tsx" || fileName === "index.jsx") {
      checkRequiredFiles();
    }

    return {};
  },
};
