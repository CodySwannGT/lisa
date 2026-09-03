/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Unit tests for the no-return-in-view ESLint rule.
 *
 * The rule shipped for its whole life with a single `ArrowFunctionExpression`
 * visitor, and nothing anywhere required a View to be an arrow function. So
 * `const XView = (...) => { ... }` was blocked while the byte-equivalent
 * `function XView(...) { ... }` was never visited at all — a silent, complete,
 * permanent opt-out of the only statement gate on Views, with
 * `require-memo-in-view` still passing because it checks the export.
 *
 * Every `declaration form` case below fails against that rule. They are the
 * point of this file: a suite without them is the same green-but-inert control
 * the rule itself was.
 * @module eslint-plugin-component-structure/tests/no-return-in-view
 */

const { RuleTester } = require("eslint");

const rule = require("../rules/no-return-in-view");

const FEATURE_COMPONENTS = "features/example/components";
const VIEW_FILE = `${FEATURE_COMPONENTS}/MyView.tsx`;

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

ruleTester.run("no-return-in-view", rule, {
  valid: [
    {
      // The shape the rule exists to require.
      code: `
        const MyView = ({ label }) => <Text>{label}</Text>;

        MyView.displayName = "MyView";

        export default memo(MyView);
      `,
      filename: VIEW_FILE,
    },
    {
      // Parenthesised expression body is still an expression body.
      code: `
        const MyView = ({ label }) => (
          <Box>
            <Text>{label}</Text>
          </Box>
        );

        export default memo(MyView);
      `,
      filename: VIEW_FILE,
    },
    {
      // A local render helper is NOT the View component. This is exactly the
      // case a substring ban on the word "function" gets wrong, and the reason
      // the rule is stated as "the View must be an expression-bodied arrow"
      // rather than "no function declarations in View files".
      code: `
        function renderBody(props) {
          return <Text>{props.label}</Text>;
        }

        const MyView = ({ label }) => <Box>{renderBody({ label })}</Box>;

        export default memo(MyView);
      `,
      filename: VIEW_FILE,
    },
    {
      // Not a View file.
      code: `
        function MyContainer() {
          return <MyView />;
        }

        export default MyContainer;
      `,
      filename: `${FEATURE_COMPONENTS}/MyContainer.tsx`,
    },
    {
      // Outside the directories the Container/View pattern applies to.
      code: `
        function MyView() {
          return <Box />;
        }

        export default MyView;
      `,
      filename: "lib/MyView.tsx",
    },
  ],
  invalid: [
    {
      // The case the rule already caught: block-bodied arrow.
      code: `
        const MyView = ({ label }) => {
          return <Text>{label}</Text>;
        };

        export default memo(MyView);
      `,
      filename: VIEW_FILE,
      errors: [{ messageId: "noReturnInView" }],
    },
    {
      // DECLARATION FORM. Fails against the pre-fix rule, which never visits
      // a FunctionDeclaration and reports nothing at all.
      code: `
        function MyView({ label }) {
          return <Text>{label}</Text>;
        }

        MyView.displayName = "MyView";

        export default memo(MyView);
      `,
      filename: VIEW_FILE,
      errors: [{ messageId: "mustBeArrowFunction" }],
    },
    {
      // Declaration form, exported inline.
      code: `
        export default function MyView({ label }) {
          return <Text>{label}</Text>;
        }
      `,
      filename: VIEW_FILE,
      errors: [{ messageId: "mustBeArrowFunction" }],
    },
    {
      // Function-expression form assigned to a View-named binding.
      code: `
        const MyView = function ({ label }) {
          return <Text>{label}</Text>;
        };

        export default memo(MyView);
      `,
      filename: VIEW_FILE,
      errors: [{ messageId: "mustBeArrowFunction" }],
    },
    {
      // The component the file exports, named without the word "View".
      // Reached through the default export's memo() argument, so the rule does
      // not depend on the identifier spelling.
      code: `
        function HomeScreen({ label }) {
          return <Text>{label}</Text>;
        }

        HomeScreen.displayName = "HomeScreen";

        export default memo(HomeScreen);
      `,
      filename: `features/home/screens/HomeScreenView.tsx`,
      errors: [{ messageId: "mustBeArrowFunction" }],
    },
    {
      // Declaration form in a plain components/ directory.
      code: `
        function CardView(props) {
          return <Box>{props.label}</Box>;
        }

        export default memo(CardView);
      `,
      filename: "components/Card/CardView.jsx",
      errors: [{ messageId: "mustBeArrowFunction" }],
    },
  ],
});
