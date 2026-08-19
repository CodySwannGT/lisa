/**
 * Bite tests for `ui-standards/no-unbound-design-value` — the executable-control
 * rung of the design-handoff policy.
 *
 * The defect class these guard against is a control that only ever fires or
 * only ever passes. Both halves are asserted deliberately: a typed axis with a
 * literal must report, and the *same literal in an untyped axis* must not. A
 * rule that reported both would pass a suite that only tested the first half,
 * and it would then be switched off by the first project that adopted it.
 *
 * The plugin's own directory is excluded from Vitest collection, so this file
 * is the authoritative gate for the rule — the same arrangement as
 * `eslint-plugin-phaser.test.ts`.
 * @module tests/unit/config/eslint-plugin-ui-standards-design-value
 */
import type { Rule } from "eslint";
import { RuleTester } from "eslint";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const noUnboundDesignValue =
  require("../../../eslint-plugin-ui-standards/rules/no-unbound-design-value.js") as Rule.RuleModule;
const plugin = require("../../../eslint-plugin-ui-standards/index.js") as {
  rules: Record<string, Rule.RuleModule>;
};

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

/** Colour is typed; nothing else is. The common real-world regime. */
const COLOR_TYPED = [{ typedAxes: ["color"] }];

/** Colour and radius typed, spacing deliberately left untyped. */
const COLOR_AND_RADIUS_TYPED = [{ typedAxes: ["color", "radius"] }];

ruleTester.run("no-unbound-design-value", noUnboundDesignValue, {
  valid: [
    // Regime gate: with no axis declared typed, the rule visits nothing. This
    // is the default configuration, so an unconfigured project is silent.
    {
      code: "const s = { backgroundColor: '#3A7BD5', borderRadius: 8 };",
      options: [{}],
    },
    // The same literal in an UNTYPED axis is the legitimate primary source.
    {
      code: "const s = { padding: 12, marginTop: 24, gap: 6 };",
      options: COLOR_AND_RADIUS_TYPED,
    },
    // Bound values are the happy path, in every axis.
    {
      code: "const s = { backgroundColor: tokens.surface.raised, borderRadius: tokens.radius.card };",
      options: COLOR_AND_RADIUS_TYPED,
    },
    // A theme/token module is where the literals belong — it mirrors the
    // published variables rather than copying them.
    {
      code: "const palette = { backgroundColor: '#3A7BD5' };",
      filename: "/repo/src/theme/palette.ts",
      options: COLOR_TYPED,
    },
    // Zero and one are not token-worthy numbers; reporting them is the noise
    // that gets a rule disabled.
    {
      code: "const s = { borderRadius: 0, borderWidth: 1 };",
      options: COLOR_AND_RADIUS_TYPED,
    },
    // A CSS template that references a variable is bound, not literal.
    {
      code: "const B = styled.button`color: var(--brand-primary);`;",
      options: COLOR_TYPED,
    },
    // A non-CSS tagged template is not a style surface.
    {
      code: "const q = gql`query { color: '#3A7BD5' }`;",
      options: COLOR_TYPED,
    },
  ],
  invalid: [
    // Condition 2, the most important one: a literal painted directly in a
    // typed axis. The design looks finished and has nothing to extract.
    {
      code: "const s = { backgroundColor: '#3A7BD5' };",
      options: COLOR_TYPED,
      errors: [{ messageId: "unboundDesignValue" }],
    },
    // Colour is self-identifying: caught by shape even under an unknown prop.
    {
      code: "const s = { overlayTint: 'rgba(58, 123, 213, 0.4)' };",
      options: COLOR_TYPED,
      errors: [{ messageId: "unboundDesignValue" }],
    },
    // A numeric axis is caught by property name.
    {
      code: "const s = { borderRadius: 12 };",
      options: COLOR_AND_RADIUS_TYPED,
      errors: [{ messageId: "unboundDesignValue" }],
    },
    // JSX props carry style values too.
    {
      code: "const V = () => <Icon tintColor='#3A7BD5' />;",
      options: COLOR_TYPED,
      errors: [{ messageId: "unboundDesignValue" }],
    },
    // Styled-component bodies are opaque to a property-name visitor — the
    // declarations live inside a string — so they are parsed explicitly.
    {
      code: "const B = styled.button`color: #3A7BD5;`;",
      options: COLOR_TYPED,
      errors: [{ messageId: "unboundDesignValue" }],
    },
    {
      code: "const B = css`border-radius: 12px;`;",
      options: COLOR_AND_RADIUS_TYPED,
      errors: [{ messageId: "unboundDesignValue" }],
    },
  ],
});

describe("no-unbound-design-value wiring", () => {
  it("is exported from the plugin under its rule name", () => {
    expect(plugin.rules["no-unbound-design-value"]).toBe(noUnboundDesignValue);
  });

  it("explains itself in plain language a non-technical reader can act on", () => {
    const message = String(
      noUnboundDesignValue.meta?.messages?.["unboundDesignValue"] ?? ""
    );
    expect(message).toContain("design variables");
    expect(message).toContain("ask for one to be published");
    expect(message).not.toMatch(/AST|node|literal|token type/iu);
  });

  it("declares typed axes as an option rather than hardcoding a regime", () => {
    const schema = noUnboundDesignValue.meta?.schema as
      | { properties?: Record<string, unknown> }[]
      | undefined;
    expect(schema?.[0]?.properties?.["typedAxes"]).toBeDefined();
  });
});
