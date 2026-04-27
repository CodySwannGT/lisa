/**
 * Unit tests that pin the oxlint configuration for the Expo stack.
 *
 * Background: `oxlint/expo.json` ships a shadcn-style generated UI pattern in
 * `ignorePatterns` to skip linting those files entirely. There must be no
 * corresponding `overrides[].files` entry that references the same pattern,
 * because oxlint (and ESLint) skip files matching `ignorePatterns` before
 * evaluating any `overrides` — making such an override permanently dead code.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 *
 */
interface OxlintOverride {
  readonly files: readonly string[];
  readonly rules: Record<string, unknown>;
}

/**
 *
 */
interface OxlintConfig {
  readonly ignorePatterns?: readonly string[];
  readonly overrides?: readonly OxlintOverride[];
}

const configPath = join(process.cwd(), "oxlint", "expo.json");
const config = JSON.parse(readFileSync(configPath, "utf8")) as OxlintConfig;

describe("oxlint/expo.json", () => {
  describe("ignorePatterns vs overrides consistency", () => {
    it("has no override file pattern that is also in ignorePatterns (unreachable override guard)", () => {
      const ignoredPatterns = new Set(config.ignorePatterns ?? []);
      const overrides = config.overrides ?? [];

      const unreachableOverrides = overrides.filter(override =>
        override.files.some(filePattern => ignoredPatterns.has(filePattern))
      );

      expect(unreachableOverrides).toHaveLength(0);
    });

    it("does not have a components/ui/** override since those files are fully ignored", () => {
      const overrides = config.overrides ?? [];
      const hasUiOverride = overrides.some(override =>
        override.files.includes("components/ui/**")
      );
      expect(hasUiOverride).toBe(false);
    });
  });

  describe("ignorePatterns", () => {
    it("ignores components/ui/** (shadcn-style generated UI)", () => {
      expect(config.ignorePatterns).toContain("components/ui/**");
    });
  });
});
