/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Unit tests for the no-hooks-in-view ESLint rule.
 *
 * The View half of the Container/View pattern has documented "No hooks" since
 * the skill was written, and nothing enforced it. The call that made that
 * expensive was a project-local custom hook, so the matcher here is a SHAPE —
 * `use` followed by an uppercase letter, called — and never a list of names.
 * A name list would have missed the one that mattered.
 *
 * Catching `useMemo` and `useCallback` too is the accepted cost of that shape:
 * a custom data hook and a render helper are indistinguishable by name, and the
 * skill already forbids `useMemo` in a View, so exempting it would contradict
 * the document. Exemptions are the escape hatch this gate is not allowed.
 * @module eslint-plugin-component-structure/tests/no-hooks-in-view
 */

const { RuleTester } = require("eslint");

const rule = require("../rules/no-hooks-in-view");

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

ruleTester.run("no-hooks-in-view", rule, {
  valid: [
    {
      code: `
        const MyView = ({ label }) => <Text>{label}</Text>;

        export default memo(MyView);
      `,
      filename: VIEW_FILE,
    },
    {
      // `useful` is not a hook: the shape requires an uppercase letter after
      // "use". Without that boundary the rule would report ordinary helpers.
      code: `
        const MyView = ({ items }) => <Box>{useful(items)}</Box>;

        export default memo(MyView);
      `,
      filename: VIEW_FILE,
    },
    {
      // An import of a hook is not a call. The import line is covered by
      // no-restricted-imports in the shipped config, on purpose: two
      // independent axes, not one duplicated.
      code: `
        import { useMemo } from "react";

        const MyView = ({ label }) => <Text>{label}</Text>;

        export default memo(MyView);
      `,
      filename: VIEW_FILE,
    },
    {
      // Containers own hooks.
      code: `
        const MyContainer = () => {
          const value = useMemo(() => 1, []);
          return <MyView value={value} />;
        };
      `,
      filename: `${FEATURE_COMPONENTS}/MyContainer.tsx`,
    },
    {
      // Vendored UI primitives are outside the Container/View pattern.
      code: `
        const ButtonView = () => <Pressable>{useThemeColor()}</Pressable>;
      `,
      filename: "components/ui/Button/ButtonView.tsx",
    },
    {
      code: `
        const InputView = () => <Field>{useThemeColor()}</Field>;
      `,
      filename: "components/custom/ui/Input/InputView.tsx",
    },
  ],
  invalid: [
    {
      // THE INCIDENT SHAPE. An expression-bodied arrow — legal under
      // no-return-in-view in every form — with a hook called inline in JSX.
      // This is the case the expression-body requirement alone cannot catch.
      code: `
        const MyView = ({ label }) => (
          <Box>{useFlag() ? <Text>{label}</Text> : null}</Box>
        );

        export default memo(MyView);
      `,
      filename: VIEW_FILE,
      errors: [{ messageId: "noHooksInView", data: { hook: "useFlag" } }],
    },
    {
      // A project-local custom hook. Any rule built on an enumerated name list
      // misses this, which is what made the generic shape non-negotiable.
      code: `
        const MyView = ({ label }) => (
          <Box>
            {useCreateNoteQuickActionEnabled() ? <Text>{label}</Text> : null}
          </Box>
        );

        export default memo(MyView);
      `,
      filename: VIEW_FILE,
      errors: [
        {
          messageId: "noHooksInView",
          data: { hook: "useCreateNoteQuickActionEnabled" },
        },
      ],
    },
    {
      // React's own memoisation helpers are hooks and are forbidden here too.
      code: `
        const MyView = ({ items }) => (
          <Box>{useMemo(() => items.length, [items])}</Box>
        );

        export default memo(MyView);
      `,
      filename: VIEW_FILE,
      errors: [{ messageId: "noHooksInView", data: { hook: "useMemo" } }],
    },
    {
      // Namespaced call form.
      code: `
        const MyView = ({ items }) => (
          <Box>{React.useMemo(() => items.length, [items])}</Box>
        );

        export default memo(MyView);
      `,
      filename: VIEW_FILE,
      errors: [{ messageId: "noHooksInView", data: { hook: "useMemo" } }],
    },
    {
      // A hook inside a block-bodied View: both gates fire on their own axis,
      // and this one reports independently of no-return-in-view.
      code: `
        const MyView = ({ label }) => {
          const flag = useFeatureFlag();
          return <Text>{flag ? label : null}</Text>;
        };

        export default memo(MyView);
      `,
      filename: VIEW_FILE,
      errors: [
        { messageId: "noHooksInView", data: { hook: "useFeatureFlag" } },
      ],
    },
    {
      // A hook inside a local render helper is still a hook in a View file.
      code: `
        function renderBody(props) {
          return <Text>{useTheme().color}</Text>;
        }

        const MyView = props => <Box>{renderBody(props)}</Box>;

        export default memo(MyView);
      `,
      filename: VIEW_FILE,
      errors: [{ messageId: "noHooksInView", data: { hook: "useTheme" } }],
    },
    {
      code: `
        const CardView = () => <Box>{useTranslation().t("k")}</Box>;

        export default memo(CardView);
      `,
      filename: "components/Card/CardView.jsx",
      errors: [
        { messageId: "noHooksInView", data: { hook: "useTranslation" } },
      ],
    },
  ],
});
