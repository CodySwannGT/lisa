/**
 * Unit tests that pin the `@typescript-eslint/no-unused-vars` rule
 * configuration in Lisa's shared ESLint rule set.
 *
 * Background: TypeScript's `noUnusedLocals` / `noUnusedParameters` have no
 * escape hatch for intentional unused values. Lisa removed those flags from
 * `tsconfig/typescript.json` and relies on ESLint's version of the rule,
 * which supports `^_`-prefix exemption patterns. This guard test ensures all
 * four ignore patterns (plus `ignoreRestSiblings`) stay configured so the
 * long-established `_foo` convention continues to work.
 */
import { describe, expect, it } from "vitest";

import {
  defaultThresholds,
  getSharedRules,
} from "../../../src/configs/eslint/base.js";

/**
 * Shape of the options object passed to `@typescript-eslint/no-unused-vars`.
 * Only the fields we assert on are listed.
 */
interface NoUnusedVarsOptions {
  readonly argsIgnorePattern?: string;
  readonly varsIgnorePattern?: string;
  readonly caughtErrorsIgnorePattern?: string;
  readonly destructuredArrayIgnorePattern?: string;
  readonly ignoreRestSiblings?: boolean;
}

/**
 * ESLint rule entry shape: the `[severity, options]` tuple emitted by
 * `getSharedRules` for `@typescript-eslint/no-unused-vars`.
 */
type NoUnusedVarsRule = readonly ["error", NoUnusedVarsOptions];

describe("@typescript-eslint/no-unused-vars rule configuration", () => {
  const rules = getSharedRules(defaultThresholds) as Record<string, unknown>;
  const rule = rules["@typescript-eslint/no-unused-vars"] as NoUnusedVarsRule;

  it("is enabled at error severity", () => {
    expect(Array.isArray(rule)).toBe(true);
    expect(rule[0]).toBe("error");
  });

  it("exempts unused arguments prefixed with _", () => {
    expect(rule[1].argsIgnorePattern).toBe("^_");
  });

  it("exempts unused variables prefixed with _", () => {
    // The varsIgnorePattern also allows `unstable_settings` and `React` for
    // framework compatibility; assert `^_` is present as an alternation.
    expect(rule[1].varsIgnorePattern).toMatch(/\^_/u);
  });

  it("exempts caught errors prefixed with _", () => {
    expect(rule[1].caughtErrorsIgnorePattern).toBe("^_");
  });

  it("exempts destructured array elements prefixed with _", () => {
    expect(rule[1].destructuredArrayIgnorePattern).toBe("^_");
  });

  it("ignores unused rest siblings (e.g. `const { a, ...rest } = obj`)", () => {
    expect(rule[1].ignoreRestSiblings).toBe(true);
  });
});
