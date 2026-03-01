/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Unit tests for the require-memo-in-view ESLint rule
 *
 * Tests that View components are properly wrapped with React.memo() and have displayName.
 * Ensures components/ui/** directory is excluded from the rule.
 * @module eslint-plugin-component-structure/tests
 */

const { RuleTester } = require("eslint");

const rule = require("../rules/require-memo-in-view");

const FEATURE_EXAMPLE_COMPONENTS_PATH = "features/example/components";

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

ruleTester.run("require-memo-in-view", rule, {
  valid: [
    {
      code: `
        import { memo } from "react";
        import { View } from "react-native";

        const MyView = () => <View />;

        MyView.displayName = "MyView";

        export default memo(MyView);
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
    },
    {
      code: `
        import { memo } from "react";
        import { Text } from "react-native";

        const AnotherView = () => (
          <Text>Hello</Text>
        );

        AnotherView.displayName = "AnotherView";

        export default memo(AnotherView);
      `,
      filename: "components/AnotherView.tsx",
    },
    {
      code: `
        // This should be ignored - components/ui/** is excluded
        import { View } from "react-native";

        const UIComponent = () => <View />;

        export default UIComponent;
      `,
      filename: "components/ui/Button/ButtonView.tsx",
    },
    {
      code: `
        // This should be ignored - components/custom/ui/** is excluded
        import { View } from "react-native";

        const CustomUIComponent = () => <View />;

        export default CustomUIComponent;
      `,
      filename: "components/custom/ui/Input/InputView.tsx",
    },
    {
      code: `
        // Non-View file should be ignored
        import { memo } from "react";

        const MyContainer = () => null;

        export default MyContainer;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyContainer.tsx`,
    },
    {
      code: `
        import React from "react";
        import { View } from "react-native";

        const MyView = () => <View />;

        MyView.displayName = "MyView";

        export default React.memo(MyView);
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
    },
  ],
  invalid: [
    {
      code: `
        import { View } from "react-native";

        const MyView = () => <View />;

        MyView.displayName = "MyView";

        export default MyView;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
      errors: [
        {
          messageId: "missingMemo",
          data: { componentName: "MyView" },
        },
      ],
    },
    {
      code: `
        import { memo } from "react";
        import { View } from "react-native";

        const MyView = () => <View />;

        export default memo(MyView);
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
      errors: [
        {
          messageId: "missingDisplayName",
          data: { componentName: "MyView" },
        },
      ],
    },
    {
      code: `
        import { View } from "react-native";

        const MyView = () => <View />;

        export default MyView;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
      errors: [
        {
          messageId: "missingMemo",
          data: { componentName: "MyView" },
        },
        {
          messageId: "missingDisplayName",
          data: { componentName: "MyView" },
        },
      ],
    },
    {
      code: `
        import React from "react";
        import { View } from "react-native";

        const MyView = () => <View />;

        export default React.memo(MyView);
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
      errors: [
        {
          messageId: "missingDisplayName",
          data: { componentName: "MyView" },
        },
      ],
    },
    {
      code: `
        import { View } from "react-native";

        const TestView = () => <View />;

        TestView.displayName = "TestView";

        export default TestView;
      `,
      filename: "features/test/components/TestView.jsx",
      errors: [
        {
          messageId: "missingMemo",
          data: { componentName: "TestView" },
        },
      ],
    },
  ],
});
