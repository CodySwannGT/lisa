/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Prevent direct React Native component imports",
      category: "Best Practices",
      recommended: true,
    },
    fixable: null,
    schema: [],
    messages: {
      noDirectRNImport:
        "Don't import {{importName}} from 'react-native'. Use {{suggestion}} from '@/components/ui' instead.",
    },
  },

  create(context) {
    const componentMap = {
      View: "Box",
      Text: "Text",
      Image: "Image",
      ScrollView: "ScrollView",
      Pressable: "Pressable",
      TouchableOpacity: "Pressable",
      TouchableHighlight: "Pressable",
      TouchableWithoutFeedback: "Pressable",
      TextInput: "Input",
      FlatList: "FlatList",
      SectionList: "SectionList",
    };

    return {
      ImportDeclaration(node) {
        if (node.source.value !== "react-native") return;

        node.specifiers.forEach(specifier => {
          if (specifier.type === "ImportSpecifier") {
            const importedName = specifier.imported.name;

            if (componentMap[importedName]) {
              context.report({
                node: specifier,
                messageId: "noDirectRNImport",
                data: {
                  importName: importedName,
                  suggestion: componentMap[importedName],
                },
              });
            }
          }
        });
      },
    };
  },
};
