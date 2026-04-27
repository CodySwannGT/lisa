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

/**
 * Returns true when `filePattern` is fully shadowed by `ignorePattern`.
 *
 * Handles two cases:
 * - Exact match: `"components/ui/**"` shadows `"components/ui/**"`
 * - Directory glob: `"components/ui/**"` shadows any path that starts with
 *   `"components/ui/"` such as `"components/ui/**\/\*.tsx"`
 * @param filePattern - The override file glob to test (e.g. `"components/ui/**\/*.tsx"`)
 * @param ignorePattern - The ignore pattern to test against (e.g. `"components/ui/**"`)
 * @returns true if `filePattern` is entirely covered by `ignorePattern`
 */
const isShadowedByIgnore = (
  filePattern: string,
  ignorePattern: string
): boolean => {
  if (filePattern === ignorePattern) return true;
  if (ignorePattern.endsWith("/**")) {
    const prefix = ignorePattern.slice(0, -2); // removes "**", keeps the trailing "/"
    return filePattern.startsWith(prefix);
  }
  return false;
};

describe("oxlint/expo.json", () => {
  describe("ignorePatterns vs overrides consistency", () => {
    it("has no override file pattern that is also in ignorePatterns (unreachable override guard)", () => {
      const ignoredPatterns = config.ignorePatterns ?? [];
      const overrides = config.overrides ?? [];

      const unreachableOverrides = overrides.filter(override =>
        override.files.some(filePattern =>
          ignoredPatterns.some(ignorePattern =>
            isShadowedByIgnore(filePattern, ignorePattern)
          )
        )
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
