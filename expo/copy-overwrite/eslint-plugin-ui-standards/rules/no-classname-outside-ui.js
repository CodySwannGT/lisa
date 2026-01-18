module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow className outside of UI component directories",
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
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noClassNameOutsideUI:
        "className is only allowed in components/ui and components/custom/ui directories. Create a reusable component with semantic props instead.",
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const allowedPaths = options.allowedPaths || [
      "/components/ui/",
      "/components/custom/ui/",
    ];

    return {
      JSXAttribute(node) {
        if (node.name.name !== "className") return;

        const filename = context.getFilename().replace(/\\/g, "/");
        const isAllowed = allowedPaths.some(path => filename.includes(path));

        if (!isAllowed) {
          context.report({
            node,
            messageId: "noClassNameOutsideUI",
          });
        }
      },
    };
  },
};
