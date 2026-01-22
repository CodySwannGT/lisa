/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow inline style prop usage",
      category: "Best Practices",
      recommended: true,
    },
    fixable: null,
    schema: [
      {
        type: "object",
        properties: {
          allowedPaths: {
            type: "array",
            items: { type: "string" },
          },
          allowedComponents: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noInlineStyles:
        "Inline styles are not allowed. Use Gluestack components with semantic props or create a reusable component.",
      noInlineStylesComponent:
        "Inline styles are not allowed on {{componentName}}. Use semantic props or create a reusable component.",
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const allowedPaths = options.allowedPaths || [
      "/components/ui/",
      "/components/custom/ui/",
      "\\components\\ui\\", // Windows
      "\\components\\custom\\ui\\", // Windows
    ];
    const allowedComponents = options.allowedComponents || [];

    return {
      JSXAttribute(node) {
        if (node.name.name !== "style") return;

        const filename = context.getFilename();
        const isPathAllowed = allowedPaths.some(path =>
          filename.includes(path)
        );

        if (isPathAllowed) return;

        // Check if it's an allowed component
        const parentElement = node.parent;
        const componentName = parentElement.name.name;

        if (allowedComponents.includes(componentName)) return;

        context.report({
          node,
          messageId: componentName
            ? "noInlineStylesComponent"
            : "noInlineStyles",
          data: {
            componentName,
          },
        });
      },
    };
  },
};
