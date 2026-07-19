/**
 * Tests for the threshold ratchet comparator, Tier 1: the designed tunable
 * files. Coverage/e2e minimums may only rise; eslint/rubocop maximums may
 * only fall; removals and file deletions are conservative weakenings.
 * Tier 2/3 families and enforcement-layer wiring are covered in
 * threshold-ratchet-gates.test.ts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FAMILIES_REL = "plugins/src/base/hooks/threshold-ratchet-families.mjs";
const COMPARE_REL = "plugins/src/base/hooks/threshold-ratchet-compare.mjs";

const VITEST_FILE = "vitest.thresholds.json";
const ESLINT_FILE = "eslint.thresholds.json";
const RUBOCOP_FILE = "rubocop.thresholds.yml";
const E2E_FILE = "e2e.thresholds.json";
const KEY_LINES = "global.lines";
const METHOD_LENGTH_SECTION = "Metrics/MethodLength:";
const ABC_SIZE_SECTION = "Metrics/AbcSize:";
const MAX_20 = "  Max: 20";

/** One reported ratchet violation. */
interface Finding {
  readonly file: string;
  readonly key: string;
  readonly type: string;
  readonly message: string;
}

describe("threshold-ratchet tier 1", () => {
  let familyFor: (relPath: string) => { id: string } | undefined;
  let compareFile: (
    relPath: string,
    baselineText: string | null,
    currentText: string | null
  ) => Finding[];
  let formatReport: (findings: Finding[]) => string;

  beforeAll(async () => {
    const families = await import(
      pathToFileURL(path.join(REPO_ROOT, FAMILIES_REL)).href
    );
    const compare = await import(
      pathToFileURL(path.join(REPO_ROOT, COMPARE_REL)).href
    );
    familyFor = families.familyFor;
    compareFile = compare.compareFile;
    formatReport = compare.formatReport;
  });

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
      expect(familyFor("audit.ignore.local.json")?.id).toBe("audit-ignore");
      expect(familyFor(".lisa.config.json")?.id).toBe("lisa-config");
    });

    it("ignores unrelated files", () => {
      expect(familyFor("package.json")).toBeUndefined();
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
