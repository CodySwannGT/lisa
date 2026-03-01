/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Unit tests for the single-component-per-file ESLint rule
 *
 * Tests that View and Container files contain exactly one React component.
 * Ensures components/ui/** and components/shared/** directories are excluded from the rule.
 * @module eslint-plugin-component-structure/tests
 */

const { RuleTester } = require("eslint");

const rule = require("../rules/single-component-per-file");

const FEATURE_EXAMPLE_COMPONENTS_PATH = "/features/example/components";
const SHARED_COMPONENTS_PATH = "/components/shared";
const UI_COMPONENTS_PATH = "/components/ui";

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

ruleTester.run("single-component-per-file", rule, {
  valid: [
    // 1. Single component - arrow function
    {
      code: `
        const MyView = () => <div>Hello</div>;
        MyView.displayName = "MyView";
        export default MyView;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
    },
    // 2. Single component - memo wrapped
    {
      code: `
        import { memo } from "react";
        const MyView = memo(() => <div>Hello</div>);
        MyView.displayName = "MyView";
        export default MyView;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
    },
    // 3. Single component - React.memo wrapped
    {
      code: `
        import React from "react";
        const MyView = React.memo(() => <div>Hello</div>);
        MyView.displayName = "MyView";
        export default MyView;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
    },
    // 4. Single component - function declaration
    {
      code: `
        function MyView() {
          return <div>Hello</div>;
        }
        export default MyView;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
    },
    // 5. Single component - TypeScript React.FC (parser will handle TypeScript syntax)
    {
      code: `
        const MyView: React.FC = () => <div>Hello</div>;
        MyView.displayName = "MyView";
        export default MyView;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
      languageOptions: {
        parser: require("@typescript-eslint/parser"),
      },
    },
    // 6. Single component in Container file
    {
      code: `
        const MyContainer = () => {
          return <div>Hello</div>;
        };
        export default MyContainer;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyContainer.tsx`,
    },
    // 7. PascalCase function that doesn't return JSX (not a component)
    {
      code: `
        const MyView = () => <div>Hello</div>;
        const HelperFunction = () => {
          return "not JSX";
        };
        export default MyView;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
    },
    // 8. Non-View/Container file (rule should not apply)
    {
      code: `
        const Component1 = () => <div>1</div>;
        const Component2 = () => <div>2</div>;
        export { Component1, Component2 };
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/utils.tsx`,
    },
    // 9. Excluded directory - UI components
    {
      code: `
        const Component1 = () => <div>1</div>;
        const Component2 = () => <div>2</div>;
        export { Component1, Component2 };
      `,
      filename: `${UI_COMPONENTS_PATH}/MyView.tsx`,
    },
    // 10. Excluded directory - Shared components
    {
      code: `
        const Component1 = () => <div>1</div>;
        const Component2 = () => <div>2</div>;
        export { Component1, Component2 };
      `,
      filename: `${SHARED_COMPONENTS_PATH}/MyView.tsx`,
    },
    // 11. Single component - conditional expression
    {
      code: `
        const MyView = ({ show }) => show ? <div>Visible</div> : <div>Hidden</div>;
        export default MyView;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
    },
    // 12. Single component - logical expression
    {
      code: `
        const MyView = ({ show }) => show && <div>Content</div>;
        export default MyView;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
    },
  ],
  invalid: [
    // 1. Two arrow function components
    {
      code: `
        const Component1 = () => <div>First</div>;
        const Component2 = () => <div>Second</div>;
        export default Component1;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
      errors: [
        {
          messageId: "multipleComponents",
          data: {
            componentName: "Component2",
            firstComponentName: "Component1",
          },
        },
      ],
    },
    // 2. Two memo-wrapped components
    {
      code: `
        import { memo } from "react";
        const Component1 = memo(() => <div>First</div>);
        const Component2 = memo(() => <div>Second</div>);
        export default Component1;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
      errors: [
        {
          messageId: "multipleComponents",
          data: {
            componentName: "Component2",
            firstComponentName: "Component1",
          },
        },
      ],
    },
    // 3. Main component and helper component (realistic violation)
    {
      code: `
        import React from "react";
        const MessageItem = ({ item }) => <div>{item}</div>;
        const MessageListView = ({ messages }) => (
          <div>{messages.map(msg => <MessageItem item={msg} />)}</div>
        );
        export default MessageListView;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MessageListView.tsx`,
      errors: [
        {
          messageId: "multipleComponents",
          data: {
            componentName: "MessageListView",
            firstComponentName: "MessageItem",
          },
        },
      ],
    },
    // 4. Function declaration and arrow function
    {
      code: `
        function Component1() {
          return <div>First</div>;
        }
        const Component2 = () => <div>Second</div>;
        export default Component1;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
      errors: [
        {
          messageId: "multipleComponents",
          data: {
            componentName: "Component2",
            firstComponentName: "Component1",
          },
        },
      ],
    },
    // 5. Three components (multiple violations)
    {
      code: `
        const Component1 = () => <div>First</div>;
        const Component2 = () => <div>Second</div>;
        const Component3 = () => <div>Third</div>;
        export default Component1;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
      errors: [
        {
          messageId: "multipleComponents",
          data: {
            componentName: "Component2",
            firstComponentName: "Component1",
          },
        },
        {
          messageId: "multipleComponents",
          data: {
            componentName: "Component3",
            firstComponentName: "Component1",
          },
        },
      ],
    },
    // 6. Container file with multiple components
    {
      code: `
        const Helper = () => <div>Helper</div>;
        const MyContainer = () => <div><Helper /></div>;
        export default MyContainer;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyContainer.tsx`,
      errors: [
        {
          messageId: "multipleComponents",
          data: {
            componentName: "MyContainer",
            firstComponentName: "Helper",
          },
        },
      ],
    },
    // 7. Multiple components with conditional expressions
    {
      code: `
        const Component1 = ({ show }) => show ? <div>First</div> : null;
        const Component2 = ({ show }) => show && <div>Second</div>;
        export default Component1;
      `,
      filename: `${FEATURE_EXAMPLE_COMPONENTS_PATH}/MyView.tsx`,
      errors: [
        {
          messageId: "multipleComponents",
          data: {
            componentName: "Component2",
            firstComponentName: "Component1",
          },
        },
      ],
    },
  ],
});
