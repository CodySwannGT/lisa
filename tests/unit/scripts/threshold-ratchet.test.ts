/**
 * Tests for the threshold ratchet comparator, Tier 1: the designed tunable
 * files. Coverage/e2e minimums may only rise; eslint/rubocop maximums may
 * only fall; removals and file deletions are conservative weakenings.
 * Tier 2/3 families and enforcement-layer wiring are covered in
 * threshold-ratchet-gates.test.ts.
 *
 * The two modules under test are imported STATICALLY and by relative path, not
 * through `import(pathToFileURL(...).href)`. The difference is not cosmetic: a
 * URL assembled at runtime is invisible to Vite's module graph, so the mutation
 * gate cannot see that this file exercises them and reports every mutant in
 * both as uncovered. Keep these static — an import rewritten back to a runtime
 * URL silently drops 415 mutants of ratchet logic out of the gate.
 */
import { describe, expect, it } from "vitest";

import {
  compareFile,
  formatReport,
} from "../../../plugins/src/base/hooks/threshold-ratchet-compare.mjs";
import { familyFor } from "../../../plugins/src/base/hooks/threshold-ratchet-families.mjs";

const VITEST_FILE = "vitest.thresholds.json";
const ESLINT_FILE = "eslint.thresholds.json";
const RUBOCOP_FILE = "rubocop.thresholds.yml";
const E2E_FILE = "e2e.thresholds.json";
const LIGHTHOUSE_FILE = "lighthouserc-config.json";
const PERFORMANCE_SCORE = "performance.minScore";
const KEY_LINES = "global.lines";
const METHOD_LENGTH_SECTION = "Metrics/MethodLength:";
const ABC_SIZE_SECTION = "Metrics/AbcSize:";
const MAX_20 = "  Max: 20";

describe("threshold-ratchet tier 1", () => {
  describe("familyFor", () => {
    it("watches every Tier 1/2/3 family", () => {
      expect(familyFor(VITEST_FILE)?.id).toBe("coverage");
      expect(familyFor("packages/api/jest.thresholds.json")?.id).toBe(
        "coverage"
      );
      expect(familyFor(E2E_FILE)?.id).toBe("e2e");
      expect(familyFor(ESLINT_FILE)?.id).toBe("eslint");
      expect(familyFor("simplecov.thresholds.json")?.id).toBe("simplecov");
      expect(familyFor(RUBOCOP_FILE)?.id).toBe("rubocop");
      expect(familyFor("stryker.conf.json")?.id).toBe("stryker");
      expect(familyFor(".github/k6/thresholds/normal.json")?.id).toBe("k6");
      expect(familyFor(".lisa.config.json")?.id).toBe("lisa-config");
      expect(familyFor(LIGHTHOUSE_FILE)?.id).toBe("lighthouse");
      expect(familyFor("lighthouserc.json")?.id).toBe("lighthouse");
      expect(familyFor(".lighthouserc.json")?.id).toBe("lighthouse");
    });

    it("ignores unrelated files", () => {
      expect(familyFor("package.json")).toBeUndefined();
      // Audit ignore lists are deliberately unwatched: the
      // security-audit-handling ladder authorizes documented additions, and
      // doctor readiness (B5) audits that each entry carries a decision.
      expect(familyFor("audit.ignore.local.json")).toBeUndefined();
      expect(familyFor("audit.ignore.config.json")).toBeUndefined();
      expect(familyFor("src/thresholds.json.ts")).toBeUndefined();
      expect(familyFor("docs/e2e.thresholds.json.md")).toBeUndefined();
    });
  });

  describe("coverage minimums (vitest/jest/simplecov/e2e)", () => {
    const base = JSON.stringify({ global: { lines: 70, branches: 70 } });

    it("blocks lowering a minimum", () => {
      const current = JSON.stringify({ global: { lines: 50, branches: 70 } });
      const findings = compareFile(VITEST_FILE, base, current);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ key: KEY_LINES, type: "weakened" });
    });

    it("allows raising and keeping minimums", () => {
      const current = JSON.stringify({ global: { lines: 80, branches: 70 } });
      expect(compareFile("jest.thresholds.json", base, current)).toHaveLength(
        0
      );
    });

    it("blocks removing a tuned key", () => {
      const current = JSON.stringify({ global: { lines: 70 } });
      const findings = compareFile(VITEST_FILE, base, current);
      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe("removed");
    });

    it("allows adding a new key", () => {
      const current = JSON.stringify({
        global: { lines: 70, branches: 70, functions: 60 },
      });
      expect(compareFile(VITEST_FILE, base, current)).toHaveLength(0);
    });

    it("ignores underscore-prefixed documentation keys", () => {
      const withComment = JSON.stringify({
        _comment: "docs",
        playwright: { routes: 80 },
      });
      const changedComment = JSON.stringify({
        _comment: "different docs",
        playwright: { routes: 80 },
      });
      expect(compareFile(E2E_FILE, withComment, changedComment)).toHaveLength(
        0
      );
    });

    it("blocks deleting the whole file", () => {
      const findings = compareFile(VITEST_FILE, base, null);
      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe("file-deleted");
    });

    it("allows a brand-new file", () => {
      expect(compareFile(VITEST_FILE, null, base)).toHaveLength(0);
    });

    it("blocks replacing the file with invalid JSON", () => {
      const findings = compareFile(VITEST_FILE, base, "{oops");
      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe("unparseable");
    });
  });

  describe("complexity maximums (eslint/rubocop)", () => {
    it("blocks raising an eslint maximum", () => {
      const base = JSON.stringify({ maxLines: 300, cognitiveComplexity: 10 });
      const current = JSON.stringify({
        maxLines: 500,
        cognitiveComplexity: 10,
      });
      const findings = compareFile(ESLINT_FILE, base, current);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ key: "maxLines", type: "weakened" });
    });

    it("allows lowering an eslint maximum (tightening)", () => {
      const base = JSON.stringify({ maxLines: 300 });
      const current = JSON.stringify({ maxLines: 200 });
      expect(compareFile(ESLINT_FILE, base, current)).toHaveLength(0);
    });

    it("blocks raising a rubocop Metrics maximum", () => {
      const base = [
        "# comment",
        METHOD_LENGTH_SECTION,
        MAX_20,
        "",
        ABC_SIZE_SECTION,
        "  Max: 25",
      ].join("\n");
      const current = base.replace("Max: 20", "Max: 40");
      const findings = compareFile(RUBOCOP_FILE, base, current);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        key: "Metrics/MethodLength.Max",
        type: "weakened",
      });
    });

    it("allows the nightly tightening of a rubocop maximum", () => {
      const base = [METHOD_LENGTH_SECTION, MAX_20].join("\n");
      const current = [METHOD_LENGTH_SECTION, "  Max: 15"].join("\n");
      expect(compareFile(RUBOCOP_FILE, base, current)).toHaveLength(0);
    });

    it("tolerates trailing comments on rubocop scalar lines", () => {
      const base = [ABC_SIZE_SECTION, "  Max: 25 # tuned"].join("\n");
      const current = [ABC_SIZE_SECTION, "  Max: 30"].join("\n");
      const findings = compareFile(RUBOCOP_FILE, base, current);
      expect(findings).toHaveLength(1);
      expect(findings[0].key).toBe("Metrics/AbcSize.Max");
    });

    it("skips empty-value rubocop lines instead of reading them as 0", () => {
      const base = [
        METHOD_LENGTH_SECTION,
        MAX_20,
        "  Exclude:",
        "    - 'db/**/*'",
      ].join("\n");
      const current = [METHOD_LENGTH_SECTION, MAX_20].join("\n");
      expect(compareFile(RUBOCOP_FILE, base, current)).toHaveLength(0);
    });
  });

  describe("Lighthouse budgets", () => {
    const config = (assertions: object) => JSON.stringify({ assertions });
    const standardConfig = (assertions: object) =>
      JSON.stringify({ ci: { assert: { assertions } } });

    it("blocks lowering a score floor", () => {
      const findings = compareFile(
        LIGHTHOUSE_FILE,
        config({ performance: { minScore: 0.9 } }),
        config({ performance: { minScore: 0.8 } })
      );

      expect(findings).toEqual([
        expect.objectContaining({
          key: PERFORMANCE_SCORE,
          type: "weakened",
          base: 0.9,
          current: 0.8,
        }),
      ]);
    });

    it.each(["maxNumericValue", "maxLength"])(
      "blocks raising the %s ceiling",
      key => {
        const findings = compareFile(
          LIGHTHOUSE_FILE,
          config({ audit: { [key]: 2 } }),
          config({ audit: { [key]: 3 } })
        );

        expect(findings).toEqual([
          expect.objectContaining({ key: `audit.${key}`, type: "weakened" }),
        ]);
      }
    );

    it("allows floors to rise and ceilings to fall", () => {
      const base = config({
        performance: { minScore: 0.8 },
        totalByteWeight: { maxNumericValue: 500000 },
        unusedJavascript: { maxLength: 3 },
      });
      const current = config({
        performance: { minScore: 0.9 },
        totalByteWeight: { maxNumericValue: 450000 },
        unusedJavascript: { maxLength: 2 },
      });

      expect(compareFile(LIGHTHOUSE_FILE, base, current)).toEqual([]);
    });

    it("blocks removing a known budget", () => {
      const findings = compareFile(
        LIGHTHOUSE_FILE,
        config({ performance: { minScore: 0.9 } }),
        config({ performance: {} })
      );

      expect(findings).toEqual([
        expect.objectContaining({
          key: PERFORMANCE_SCORE,
          type: "removed",
        }),
      ]);
    });

    it("reads standard nested Lighthouse CI severity-array assertions", () => {
      const findings = compareFile(
        LIGHTHOUSE_FILE,
        standardConfig({
          performance: ["error", { minScore: 0.9 }],
          "first-contentful-paint": ["warn", { maxNumericValue: 2_000 }],
        }),
        standardConfig({
          performance: ["error", { minScore: 0.8 }],
          "first-contentful-paint": ["warn", { maxNumericValue: 2_500 }],
        })
      );

      expect(findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: PERFORMANCE_SCORE,
            type: "weakened",
          }),
          expect.objectContaining({
            key: "first-contentful-paint.maxNumericValue",
            type: "weakened",
          }),
        ])
      );
      expect(findings).toHaveLength(2);
    });

    it.each([
      ["error", "warn"],
      ["error", "off"],
      ["warn", "off"],
    ])("blocks weakening an assertion level from %s to %s", (base, current) => {
      expect(
        compareFile(
          LIGHTHOUSE_FILE,
          standardConfig({ performance: [base, { minScore: 0.9 }] }),
          standardConfig({ performance: [current, { minScore: 0.9 }] })
        )
      ).toEqual([
        expect.objectContaining({
          key: "performance.$level",
          type: "weakened",
        }),
      ]);
    });

    it("ignores inherited direction-table properties", () => {
      expect(
        compareFile(
          LIGHTHOUSE_FILE,
          standardConfig({ audit: ["error", { constructor: 1 }] }),
          standardConfig({ audit: ["error", { constructor: 2 }] })
        )
      ).toEqual([]);
    });

    it("ignores unknown keys and malformed arrays instead of guessing", () => {
      expect(
        compareFile(
          LIGHTHOUSE_FILE,
          config({ audit: { unknownBudget: 3 } }),
          config({ audit: { unknownBudget: 30 } })
        )
      ).toEqual([]);
      expect(
        compareFile(
          LIGHTHOUSE_FILE,
          JSON.stringify({ assertions: [] }),
          JSON.stringify({ assertions: [{ minScore: 0.1 }] })
        )
      ).toEqual([]);
    });
  });

  describe("report", () => {
    it("explains the ratchet in operator-readable language", () => {
      const findings = compareFile(
        VITEST_FILE,
        JSON.stringify({ global: { lines: 70 } }),
        JSON.stringify({ global: { lines: 50 } })
      );
      const report = formatReport(findings);
      expect(report).toContain("one-way ratchet");
      expect(report).toContain("70 → 50");
      expect(report).toContain("thresholdRatchet.allow");
    });
  });
});
