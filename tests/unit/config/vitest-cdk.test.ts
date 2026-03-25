/**
 * Unit tests for the CDK Vitest configuration factory.
 *
 * Validates that getCdkVitestConfig produces the correct environment,
 * globals, include patterns, timeout, coverage settings, and
 * threshold merging behavior.
 *
 * @see src/configs/vitest/cdk.ts
 */
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

    it("does not set root (defaults to project root for coverage)", () => {
      const config = getCdkVitestConfig();

      expect(config.test?.root).toBeUndefined();
    });

    it("includes test patterns prefixed with test/ directory", () => {
      const config = getCdkVitestConfig();
      const include = config.test?.include as string[];

      expect(include).toContain("test/**/*.test.ts");
      expect(include).toContain("test/**/*.spec.ts");
      expect(include).toContain("test/**/*.integration-test.ts");
      expect(include).toContain("test/**/*.integration-spec.ts");
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
      expect(thresholds.functions).toBe(70);
      expect(thresholds.lines).toBe(70);
    });
  });
});
