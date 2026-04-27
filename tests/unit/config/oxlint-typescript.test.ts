/**
 * Unit tests that pin the oxlint configuration for the TypeScript base preset.
 *
 * Background: `oxlint/typescript.json` ships an `overrides` entry that relaxes
 * `max-lines` and `max-lines-per-function` for test files. Expo (and any
 * React-based stack that extends this preset) writes tests in `.test.tsx` /
 * `.spec.tsx` as well as `.test.ts` / `.spec.ts`. All four variants must be
 * covered so test files don't produce false-positive lint errors.
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
  readonly overrides?: readonly OxlintOverride[];
}

const configPath = join(process.cwd(), "oxlint", "typescript.json");
const config = JSON.parse(readFileSync(configPath, "utf8")) as OxlintConfig;

describe("oxlint/typescript.json", () => {
  describe("test file overrides", () => {
    const overrides = config.overrides ?? [];
    const testOverride = overrides.find(
      o =>
        o.rules["max-lines"] === "off" &&
        o.rules["max-lines-per-function"] === "off"
    );

    it("has an override that relaxes max-lines for test files", () => {
      expect(testOverride).toBeDefined();
    });

    it("includes **/*.test.ts in the test file override", () => {
      expect(testOverride?.files).toContain("**/*.test.ts");
    });

    it("includes **/*.spec.ts in the test file override", () => {
      expect(testOverride?.files).toContain("**/*.spec.ts");
    });

    it("includes **/*.test.tsx in the test file override (Expo/React test files)", () => {
      expect(testOverride?.files).toContain("**/*.test.tsx");
    });

    it("includes **/*.spec.tsx in the test file override (Expo/React test files)", () => {
      expect(testOverride?.files).toContain("**/*.spec.tsx");
    });
  });
});
