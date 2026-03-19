import { getCdkVitestConfig } from "../../../src/configs/vitest/cdk.js";

const LIB_TS_GLOB = "lib/**/*.ts";
const UTIL_TS_GLOB = "util/**/*.ts";

describe("vitest.cdk", () => {
  describe("getCdkVitestConfig", () => {
    it("uses node environment", () => {
      const config = getCdkVitestConfig();

      expect(config.test?.environment).toBe("node");
    });

    it("enables globals", () => {
      const config = getCdkVitestConfig();

      expect(config.test?.globals).toBe(true);
    });

    it("sets root to test directory", () => {
      const config = getCdkVitestConfig();

      expect(config.test?.root).toBe("test");
    });

    it("includes test, spec, and integration patterns", () => {
      const config = getCdkVitestConfig();
      const include = config.test?.include as string[];

      expect(include).toContain("**/*.test.ts");
      expect(include).toContain("**/*.spec.ts");
      expect(include).toContain("**/*.integration-test.ts");
      expect(include).toContain("**/*.integration-spec.ts");
    });

    it("sets 10 second timeout", () => {
      const config = getCdkVitestConfig();

      expect(config.test?.testTimeout).toBe(10000);
    });

    it("uses v8 coverage provider", () => {
      const config = getCdkVitestConfig();
      const coverage = config.test?.coverage as Record<string, unknown>;

      expect(coverage.provider).toBe("v8");
    });

    it("collects coverage from lib/ and util/ directories", () => {
      const config = getCdkVitestConfig();
      const coverage = config.test?.coverage as Record<string, unknown>;
      const include = coverage.include as string[];

      expect(include).toContain(LIB_TS_GLOB);
      expect(include).toContain(UTIL_TS_GLOB);
    });

    it("does not collect coverage from bin/ directory", () => {
      const config = getCdkVitestConfig();
      const coverage = config.test?.coverage as Record<string, unknown>;
      const include = coverage.include as string[];

      expect(include).not.toContain("bin/**/*.ts");
    });

    it("applies default 70% thresholds", () => {
      const config = getCdkVitestConfig();
      const coverage = config.test?.coverage as Record<string, unknown>;
      const thresholds = coverage.thresholds as Record<string, number>;

      expect(thresholds.statements).toBe(70);
      expect(thresholds.branches).toBe(70);
      expect(thresholds.functions).toBe(70);
      expect(thresholds.lines).toBe(70);
    });

    it("applies custom thresholds", () => {
      const config = getCdkVitestConfig({
        thresholds: { global: { statements: 90, branches: 85 } },
      });
      const coverage = config.test?.coverage as Record<string, unknown>;
      const thresholds = coverage.thresholds as Record<string, number>;

      expect(thresholds.statements).toBe(90);
      expect(thresholds.branches).toBe(85);
    });
  });
});
