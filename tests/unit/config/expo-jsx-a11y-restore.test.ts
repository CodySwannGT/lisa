/**
 * Expo keeps four jsx-a11y `strict` rules blocking after the oxlint preset
 * (CodySwannGT/lisa#4508).
 *
 * From eslint-plugin-oxlint 1.63.0–1.65.0, `flat/jsx-a11y` turns these rules
 * off in ESLint because oxlint implements them, but oxlint reports them only as
 * correctness-category warnings, which never fail lint. Lisa forces the oxlint
 * pair as `>=1.62.0 <1.86.0`, so a host can resolve either side of that
 * change. The installed 1.62.0 preset does not touch these rules, so checking
 * only the final value would pass with or without the restore. These cases pin
 * the restore by position instead: the last config entry setting each rule
 * must come after every oxlint preset entry and carry `strict`'s exact value.
 */
import { createRequire } from "node:module";
import * as path from "node:path";

import type { Linter } from "eslint";
import { describe, expect, it } from "vitest";

import {
  getExpoConfig,
  OXLINT_HANDED_OFF_A11Y_RULES,
} from "../../../src/configs/eslint/expo.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const require = createRequire(import.meta.url);
const strictRules = (
  require("eslint-plugin-jsx-a11y") as {
    flatConfigs: { strict: { rules: Record<string, Linter.RuleEntry> } };
  }
).flatConfigs.strict.rules;

const configs: readonly Linter.Config[] = getExpoConfig({
  tsconfigRootDir: REPO_ROOT,
});

/**
 * Index of the last config entry matching a predicate.
 * @param matches - The predicate an entry must satisfy
 * @returns The entry's index, or -1 when none matches
 */
const lastIndexWhere = (matches: (config: Linter.Config) => boolean): number =>
  configs.reduce((last, config, index) => (matches(config) ? index : last), -1);

/**
 * Index of the last config entry that sets a rule.
 * @param rule - The rule name to look for
 * @returns The entry's index, or -1 when no entry sets it
 */
const lastSetterIndex = (rule: string): number =>
  lastIndexWhere(config => config.rules?.[rule] !== undefined);

const lastOxlintPresetIndex = lastIndexWhere(config =>
  (config.name ?? "").startsWith("oxlint/")
);

/**
 * Severity of a rule entry, whether given bare or with options.
 * @param entry - The rule entry
 * @returns The severity part
 */
const severityOf = (entry: Linter.RuleEntry | undefined): unknown =>
  Array.isArray(entry) ? entry[0] : entry;

describe("Expo jsx-a11y strict rules survive the oxlint preset", () => {
  it("spreads the oxlint jsx-a11y preset (premise check)", () => {
    expect(lastOxlintPresetIndex).toBeGreaterThan(-1);
  });

  it.each(OXLINT_HANDED_OFF_A11Y_RULES)(
    "%s is last set, for every file, after every oxlint preset entry",
    rule => {
      const index = lastSetterIndex(rule);

      expect(index).toBeGreaterThan(lastOxlintPresetIndex);
      // A restore narrowed to some files would leave the rest to the preset.
      expect(configs[index]?.files).toBeUndefined();
    }
  );

  it.each(OXLINT_HANDED_OFF_A11Y_RULES)(
    "%s keeps strict's exact blocking value, options included",
    rule => {
      const final = configs[lastSetterIndex(rule)]?.rules?.[rule];

      expect(severityOf(strictRules[rule])).toBe("error");
      expect(final).toEqual(strictRules[rule]);
    }
  );
});
