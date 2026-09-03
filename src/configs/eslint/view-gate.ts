/**
 * The View half of the Container/View pattern: no statements, no hooks.
 *
 * Stated as those two properties rather than as "Views are pure functions",
 * which is a guarantee neither rule delivers — `{Date.now()}` and
 * `{Math.random() > 0.5 ? … : …}` sit happily in an expression body. The skill
 * claiming an enforcement it did not have is what let a hook live in a View for
 * years; the fix must not repeat the shape of the defect.
 *
 * Extracted from `expo.ts` so the factory stays under its own `max-lines`
 * threshold, not because a second stack needs it yet.
 * @module configs/eslint/view-gate
 */

/** The glob pair every View override is keyed on. */
const VIEW_FILES = ["**/*View.tsx", "**/*View.jsx"];

/**
 * React's hook named exports, banned from a View's import list.
 *
 * An enumeration is correct HERE and nowhere else: React's hook set is fixed and
 * published, and this is the import-line axis. The call-site axis
 * (`component-structure/no-hooks-in-view`) matches by shape precisely because a
 * project-local custom hook can never appear on a list like this one.
 */
export const REACT_HOOK_IMPORT_NAMES = [
  "useActionState",
  "useCallback",
  "useContext",
  "useDebugValue",
  "useDeferredValue",
  "useEffect",
  "useEffectEvent",
  "useId",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
  "useOptimistic",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
];

/** What a developer is told when a View reaches for a hook. */
export const VIEW_HOOK_IMPORT_MESSAGE =
  "View components must not use hooks. Move the hook into the corresponding Container and pass its result down as a prop.";

/**
 * The View-scoped config blocks a stack should append.
 *
 * Two blocks, because they have different scopes: the statement gate applies to
 * every View, while the hook gate skips the directories the Container/View
 * pattern's own applicability table marks as outside it.
 *
 * The hook gate itself is two independent axes. `no-hooks-in-view` matches the
 * CALL by shape (`use` + uppercase), so a project-local custom hook is caught
 * where an enumerated name list would miss it; `no-restricted-imports` catches
 * the IMPORT LINE, before a call site exists. Neither subsumes the other: a
 * hook re-exported through a barrel escapes the import patterns, and an import
 * with no call yet escapes the call matcher.
 * @param sourceRoot - Prefix for source-relative globs, e.g. `"src/"`.
 * @returns Flat-config blocks, in the order they must be appended.
 */
export function getViewGateConfigs(
  sourceRoot: string
): import("eslint").Linter.Config[] {
  return [
    {
      files: VIEW_FILES,
      rules: {
        "component-structure/no-return-in-view": "error",
      },
    },
    {
      files: VIEW_FILES,
      ignores: [
        `${sourceRoot}components/ui/**`,
        `${sourceRoot}components/shared/**`,
        `${sourceRoot}components/icons/**`,
      ],
      rules: {
        "component-structure/no-hooks-in-view": "error",
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "react",
                importNames: REACT_HOOK_IMPORT_NAMES,
                message: VIEW_HOOK_IMPORT_MESSAGE,
              },
            ],
            patterns: [
              // Objects, not a mix: `no-restricted-imports` accepts an array of
              // strings OR an array of objects, never both, and a mixed array
              // is a schema error that disables the whole override.
              //
              // `@/features/*/*` is the base config's restriction, carried
              // forward because a flat-config override replaces a rule's
              // options wholesale — omitting it would silently delete the
              // shared restriction for every View in the project.
              { group: ["@/features/*/*"] },
              {
                group: ["**/hooks/**", "@/hooks/**", "~/hooks/**"],
                message: VIEW_HOOK_IMPORT_MESSAGE,
              },
            ],
          },
        ],
      },
    },
  ];
}
