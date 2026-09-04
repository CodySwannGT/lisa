/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint rule banning hook calls anywhere in a View component file.
 *
 * The Container/View skill has said "View should not contain hooks" since it was
 * written, and for that whole time nothing enforced it — the skill's own table
 * of "ESLint rules that enforce the pattern" listed four rules, none of which
 * looked at a hook. This rule is the missing half.
 *
 * The matcher is a SHAPE — `use` followed by an uppercase letter, called — and
 * deliberately never a list of names. The call that made the gap expensive was a
 * project-local custom hook, so any rule built on an enumerated list would have
 * missed the one that mattered. That is also why there is no exemption list:
 * a custom data hook and a render helper are indistinguishable by name, so
 * `useMemo` and `useCallback` are caught too. The skill already forbids
 * `useMemo` in a View, so exempting it would contradict the document.
 *
 * Scope is the file, not the component body: a hook called from a local render
 * helper still runs during that View's render.
 * @module eslint-plugin-component-structure/rules/no-hooks-in-view
 */

const { isEnforcedViewFile } = require("../lib/view-file-scope");

/** `use` plus an uppercase letter — React's own definition of a hook name. */
const HOOK_NAME = /^use[A-Z]\w*$/u;

/**
 * The hook a call expression invokes, if it invokes one.
 *
 * Covers the bare call (`useFlag()`) and the namespaced one
 * (`React.useMemo()`); a computed member access is not a statically knowable
 * name and is left to `no-restricted-imports` and review.
 * @param {object} callee - The callee of a CallExpression.
 * @returns {string|null} The hook name, or null when this is not a hook call.
 */
function hookName(callee) {
  if (callee.type === "Identifier" && HOOK_NAME.test(callee.name)) {
    return callee.name;
  }

  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    HOOK_NAME.test(callee.property.name)
  ) {
    return callee.property.name;
  }

  return null;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow hook calls in View components - hooks belong in the Container",
      category: "Best Practices",
      recommended: true,
    },
    fixable: null,
    schema: [],
    messages: {
      // The message names the escape route on purpose. "No hooks in Views" with
      // no way out is what makes a developer — or an agent — reach for a disable
      // comment, and there is no disable this rule will accept.
      //
      // The Container is always a legitimate home: Containers may hold logic,
      // including a callback that returns JSX. The row-component alternative is
      // named for the `renderItem` shape, where lifting the callback moves JSX
      // rather than removing it — it is an OPTION, never a requirement.
      noHooksInView:
        "View components must not call hooks. Move {{hook}}() into the corresponding Container and pass its result down as a prop — Containers may hold logic, including a callback that returns JSX. If {{hook}}() builds a row (a renderItem or render* callback), extracting that row into its own memoised component is an equally valid alternative.",
    },
  },

  create(context) {
    if (!isEnforcedViewFile(context.getFilename())) {
      return {};
    }

    return {
      CallExpression(node) {
        const hook = hookName(node.callee);
        if (hook !== null) {
          context.report({
            node,
            messageId: "noHooksInView",
            data: { hook },
          });
        }
      },
    };
  },
};
