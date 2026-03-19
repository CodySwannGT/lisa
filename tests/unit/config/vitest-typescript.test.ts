import { getTypescriptVitestConfig } from "../../../src/configs/vitest/typescript.js";

const TESTS_GLOB = "tests/**/*.test.ts";
const SRC_TEST_GLOB = "src/**/*.test.ts";
const SRC_TS_GLOB = "src/**/*.ts";

describe("vitest.typescript", () => {
  describe("getTypescriptVitestConfig", () => {
    it("uses node environment", () => {
      const config = getTypescriptVitestConfig();

      expect(config.test?.environment).toBe("node");
    });

    it("enables globals", () => {
      const config = getTypescriptVitestConfig();

      expect(config.test?.globals).toBe(true);
    });

    it("includes test directories", () => {
      const config = getTypescriptVitestConfig();

      expect(config.test?.include).toContain(TESTS_GLOB);
      expect(config.test?.include).toContain(SRC_TEST_GLOB);
    });

    it("excludes node_modules and dist", () => {
      const config = getTypescriptVitestConfig();

      expect(config.test?.exclude).toContain("**/node_modules/**");
      expect(config.test?.exclude).toContain("**/dist/**");
    });

    it("sets 10 second timeout", () => {
      const config = getTypescriptVitestConfig();

      expect(config.test?.testTimeout).toBe(10000);
    });

    it("uses v8 coverage provider", () => {
      const config = getTypescriptVitestConfig();
      const coverage = config.test?.coverage as Record<string, unknown>;

      expect(coverage.provider).toBe("v8");
    });

    it("collects coverage from src/**/*.ts", () => {
      const config = getTypescriptVitestConfig();
      const coverage = config.test?.coverage as Record<string, unknown>;
      const include = coverage.include as string[];

      expect(include).toContain(SRC_TS_GLOB);
    });

    it("applies default 70% thresholds", () => {
      const config = getTypescriptVitestConfig();
      const coverage = config.test?.coverage as Record<string, unknown>;
      const thresholds = coverage.thresholds as Record<string, number>;

      expect(thresholds.statements).toBe(70);
      expect(thresholds.branches).toBe(70);
      expect(thresholds.functions).toBe(70);
      expect(thresholds.lines).toBe(70);
    });

    it("applies custom thresholds", () => {
      const config = getTypescriptVitestConfig({
        thresholds: { global: { statements: 90, branches: 85 } },
      });
      const coverage = config.test?.coverage as Record<string, unknown>;
      const thresholds = coverage.thresholds as Record<string, number>;

      expect(thresholds.statements).toBe(90);
      expect(thresholds.branches).toBe(85);
    });

    it("excludes coverage exclusion patterns from coverage", () => {
      const config = getTypescriptVitestConfig();
      const coverage = config.test?.coverage as Record<string, unknown>;
      const exclude = coverage.exclude as string[];

      expect(exclude).toContain("**/*.d.ts");
      expect(exclude).toContain("**/*.test.ts");
      expect(exclude).toContain("**/index.ts");
    });
  });
});
