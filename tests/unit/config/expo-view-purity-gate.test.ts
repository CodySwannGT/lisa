/**
 * Proof that the View "no statements, no hooks" gate is ARMED, not merely
 * written.
 *
 * `eslint-plugin-component-structure/__tests__` proves the two rules report.
 * That is not the same claim as this file's: a rule can be correct and never
 * reach a file, which is exactly what `no-return-in-view` was for its whole
 * life — one `ArrowFunctionExpression` visitor, no requirement anywhere that a
 * View be an arrow function, so `function XView() {}` was a silent and complete
 * opt-out while `require-memo-in-view` kept passing on the export.
 *
 * So this suite asserts both halves: that the shipped Expo config wires the
 * rules at `error` on `**\/*View.tsx`, and that the wiring a consumer receives
 * in the copy-overwrite template says the same thing. A gate proven only by
 * reading is the failure mode being fixed.
 * @module tests/unit/config/expo-view-purity-gate
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

import { getExpoConfig } from "../../../src/configs/eslint/expo.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TEMPLATE = path.join(REPO_ROOT, "expo", "copy-overwrite");

/** The glob both View overrides are keyed on. */
const VIEW_FILES = ["**/*View.tsx", "**/*View.jsx"];

/** The rule carrying the call-site half of the hook ban. */
const NO_HOOKS_IN_VIEW = "component-structure/no-hooks-in-view";

/** The core rule carrying the import-line half of the hook ban. */
const RESTRICTED_IMPORTS = "no-restricted-imports";

/** One block of a flat config, reduced to what this suite reads. */
type FlatEntry = {
  readonly files?: readonly string[];
  readonly rules?: Readonly<Record<string, unknown>>;
};

/**
 * The View-scoped entries of the shipped Expo flat config.
 * @returns Every config block keyed exactly on the View globs.
 */
const viewOverrides = (): readonly FlatEntry[] =>
  (
    getExpoConfig({
      tsconfigRootDir: REPO_ROOT,
      ignorePatterns: [],
    }) as readonly FlatEntry[]
  ).filter(
    entry =>
      Array.isArray(entry.files) &&
      entry.files.length === VIEW_FILES.length &&
      entry.files.every((glob, index) => glob === VIEW_FILES[index])
  );

/**
 * The configuration a View override gives a rule.
 * @param ruleId - Fully qualified rule id.
 * @returns The configured entry, or undefined when nothing arms it.
 */
const armedAs = (ruleId: string): unknown =>
  viewOverrides()
    .map(entry => entry.rules?.[ruleId])
    .find(value => value !== undefined);

/** The restriction shape `no-restricted-imports` is configured with. */
type RestrictedImports = readonly [
  string,
  {
    readonly paths: readonly { readonly importNames: readonly string[] }[];
    readonly patterns: readonly { readonly group: readonly string[] }[];
  },
];

describe("expo config arms the View gate", () => {
  it("wires no-return-in-view as an error on View files", () => {
    expect(armedAs("component-structure/no-return-in-view")).toBe("error");
  });

  it("wires no-hooks-in-view as an error on View files", () => {
    expect(armedAs(NO_HOOKS_IN_VIEW)).toBe("error");
  });

  it("restricts React's hook named imports in View files", () => {
    const restricted = armedAs(RESTRICTED_IMPORTS) as RestrictedImports;
    expect(restricted[0]).toBe("error");
    expect(restricted[1].paths[0]?.importNames).toContain("useMemo");
    expect(restricted[1].paths[0]?.importNames).toContain("useState");
  });

  it("restricts hooks-directory imports in View files", () => {
    const restricted = armedAs(RESTRICTED_IMPORTS) as RestrictedImports;
    const groups = restricted[1].patterns.flatMap(entry => entry.group);
    expect(groups).toContain("**/hooks/**");
  });

  it("carries the base @/features/*/* restriction forward", () => {
    // A flat-config override replaces a rule's options wholesale, so an
    // override that forgets this silently deletes the shared restriction for
    // every View in the project.
    const restricted = armedAs(RESTRICTED_IMPORTS) as RestrictedImports;
    const groups = restricted[1].patterns.flatMap(entry => entry.group);
    expect(groups).toContain("@/features/*/*");
  });
});

describe("the copied Expo factory template arms the same gate", () => {
  /**
   * The template a consumer receives.
   * @returns Its source text.
   */
  const template = (): string =>
    readFileSync(path.join(TEMPLATE, "eslint.expo.ts"), "utf8");

  it("wires no-hooks-in-view", () => {
    expect(template()).toContain(`"${NO_HOOKS_IN_VIEW}": "error"`);
  });

  it("wires the hook import restriction", () => {
    expect(template()).toContain("REACT_HOOK_IMPORT_NAMES");
    expect(template()).toContain('"**/hooks/**"');
  });
});

describe("the two rules bite on the shapes that caused the gap", () => {
  /**
   * Lint a snippet through the real plugin at the shipped severities.
   * @param code - Source to lint.
   * @param filename - The path ESLint should believe it came from.
   * @returns Rule ids reported, in report order.
   */
  const lint = (code: string, filename: string): string[] => {
    const plugin = require(
      path.join(REPO_ROOT, "eslint-plugin-component-structure", "index.js")
    ) as { rules: Record<string, unknown> };

    return new Linter()
      .verify(
        code,
        [
          {
            // Flat config only lints extensions a block claims, and `.tsx` is
            // not in the default set — without this the Linter answers "no
            // matching configuration" and every assertion below passes or fails
            // for the wrong reason.
            files: ["**/*.tsx", "**/*.jsx"],
            plugins: { "component-structure": plugin },
            languageOptions: {
              ecmaVersion: 2020,
              sourceType: "module",
              parserOptions: { ecmaFeatures: { jsx: true } },
            },
            rules: {
              "component-structure/no-return-in-view": "error",
              [NO_HOOKS_IN_VIEW]: "error",
            },
          },
        ] as never,
        filename
      )
      .map(message => message.ruleId ?? "");
  };

  const VIEW = "features/example/components/MyView.tsx";

  it("reports a declaration-form View", () => {
    expect(
      lint(
        `function MyView({ label }) { return <Text>{label}</Text>; }
         export default memo(MyView);`,
        VIEW
      )
    ).toContain("component-structure/no-return-in-view");
  });

  it("reports a hook called inline in JSX from an expression body", () => {
    // The case the expression-body requirement alone cannot catch: this View is
    // already in the shape no-return-in-view demands.
    expect(
      lint(
        `const MyView = ({ label }) => (<Box>{useFlag() ? <Text>{label}</Text> : null}</Box>);
         export default memo(MyView);`,
        VIEW
      )
    ).toContain(NO_HOOKS_IN_VIEW);
  });

  it("reports a project-local custom hook a name list would miss", () => {
    expect(
      lint(
        `const MyView = () => (<Box>{useCreateNoteQuickActionEnabled() ? <A /> : null}</Box>);
         export default memo(MyView);`,
        VIEW
      )
    ).toContain(NO_HOOKS_IN_VIEW);
  });

  it("stays silent on a compliant View", () => {
    expect(
      lint(
        `const MyView = ({ label }) => (<Box><Text>{label}</Text></Box>);
         export default memo(MyView);`,
        VIEW
      )
    ).toEqual([]);
  });
});
