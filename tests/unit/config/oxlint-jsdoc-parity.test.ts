/**
 * Unit tests that pin jsdoc rule parity between the ESLint hybrid pipeline
 * and the shipped oxlint preset.
 *
 * Background: `src/configs/eslint/base.ts` spreads
 * `oxlint.configs["flat/jsdoc"]`, which turns OFF every ESLint-side jsdoc
 * rule that oxlint's jsdoc plugin implements. Each of those rules must then
 * be enforced somewhere in the fast pipeline (`oxlint && eslint . --quiet`):
 * either re-enabled ESLint-side in `getSharedRules`, set to "error" in
 * `oxlint/base.json`, or intentionally off (JSDoc type annotations are
 * redundant under TypeScript). Before this guard existed, nine rules —
 * check-access, check-property-names, empty-tags, implements-on-classes,
 * no-defaults, require-param-name, require-property, require-property-name,
 * require-yields — were enforced NOWHERE: oxlint's `correctness` category
 * runs at "warn" (non-gating, oxlint exits 0 on warnings) and two of the
 * rules live in the off-by-default `restriction`/`pedantic` categories.
 */
import oxlint from "eslint-plugin-oxlint";
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  defaultThresholds,
  getSharedRules,
} from "../../../src/configs/eslint/base.js";

/**
 * Shape of the oxlint JSON preset relevant to this test.
 */
interface OxlintConfig {
  readonly plugins?: readonly string[];
  readonly rules?: Record<string, unknown>;
}

/**
 * JSDoc rules whose absence from both linters is intentional: JSDoc type
 * annotations ({type} braces) are redundant in TypeScript sources, matching
 * the explicit "off" entries in getSharedRules.
 */
const intentionallyUnenforced = new Set([
  "jsdoc/require-param-type",
  "jsdoc/require-returns-type",
  "jsdoc/require-property-type",
  // Off in eslint-plugin-jsdoc's own flat/recommended-typescript-flavor
  // (61.7.1) before any oxlint preset applies, so leaving them off is the
  // existing policy, not a loss. `flat/jsdoc` disables them from
  // eslint-plugin-oxlint 1.65.0 / 1.68.0 / 1.78.0 respectively (#4508).
  "jsdoc/require-throws-description",
  "jsdoc/require-yields-description",
  "jsdoc/no-blank-blocks",
]);

const oxlintBasePath = join(process.cwd(), "oxlint", "base.json");
const oxlintBase = JSON.parse(
  readFileSync(oxlintBasePath, "utf8")
) as OxlintConfig;

const sharedRules = getSharedRules(defaultThresholds) as Record<
  string,
  unknown
>;

/**
 * Extracts the severity from an ESLint rule entry ("error" or ["error", ...]).
 * @param entry - The rule configuration entry
 * @returns The severity string
 */
const severityOf = (entry: unknown): unknown =>
  Array.isArray(entry) ? entry[0] : entry;

/**
 * Rules `flat/jsdoc` turns off within Lisa's forced range (`>=1.62.0 <1.86.0`)
 * but not in the locked 1.62.0 preset (#4508). Comparing the published
 * eslint-plugin-oxlint presets: 1.65.0 adds require-throws-type,
 * require-throws-description and require-yields-type; 1.68.0 adds
 * require-yields-description; 1.78.0 adds no-blank-blocks; 1.85.0 still has
 * exactly these five. Listing them here checks them whatever version is locked,
 * because a host may resolve any release in the range.
 */
const rangeOnlyJsdocDisabledRules = [
  "jsdoc/require-throws-type",
  "jsdoc/require-throws-description",
  "jsdoc/require-yields-type",
  "jsdoc/require-yields-description",
  "jsdoc/no-blank-blocks",
];

const flatJsdocDisabledRules = [
  ...new Set([
    ...oxlint.configs["flat/jsdoc"].flatMap(config =>
      Object.keys(config.rules ?? {})
    ),
    ...rangeOnlyJsdocDisabledRules,
  ]),
];

describe("jsdoc rule parity between eslint-plugin-oxlint disables and enforcement", () => {
  it("disables at least one jsdoc rule via flat/jsdoc (premise check)", () => {
    expect(flatJsdocDisabledRules.length).toBeGreaterThan(0);
  });

  it("enables the jsdoc plugin in oxlint/base.json", () => {
    expect(oxlintBase.plugins).toContain("jsdoc");
  });

  it.each(flatJsdocDisabledRules)(
    "%s is enforced by ESLint, enforced by oxlint, or intentionally off",
    rule => {
      const reEnabledInEslint =
        rule in sharedRules && severityOf(sharedRules[rule]) !== "off";
      const enforcedInOxlint = severityOf(oxlintBase.rules?.[rule]) === "error";
      const intentional = intentionallyUnenforced.has(rule);

      expect(reEnabledInEslint || enforcedInOxlint || intentional).toBe(true);
    }
  );

  it("does not leave an intentionally-off rule active at warn in oxlint (noise guard)", () => {
    const activeIntentional = [...intentionallyUnenforced].filter(rule => {
      const severity = severityOf(oxlintBase.rules?.[rule]);
      return severity !== undefined && severity !== "off";
    });
    expect(activeIntentional).toEqual([]);
  });
});
