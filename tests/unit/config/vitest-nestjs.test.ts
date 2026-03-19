import { describe, it, expect } from "@jest/globals";
import { getNestjsVitestConfig } from "../../../src/configs/vitest/nestjs.js";

const SPEC_GLOB = "**/*.spec.ts";

describe("vitest.nestjs", () => {
  describe("getNestjsVitestConfig", () => {
    it("uses node environment", () => {
      const config = getNestjsVitestConfig();

      expect(config.test?.environment).toBe("node");
    });

    it("enables globals", () => {
      const config = getNestjsVitestConfig();

      expect(config.test?.globals).toBe(true);
    });

    it("sets root to src directory", () => {
      const config = getNestjsVitestConfig();

      expect(config.test?.root).toBe("src");
    });

    it("includes spec.ts test files", () => {
      const config = getNestjsVitestConfig();

      expect(config.test?.include).toContain(SPEC_GLOB);
    });

    it("sets 10 second timeout", () => {
      const config = getNestjsVitestConfig();

      expect(config.test?.testTimeout).toBe(10000);
    });

    it("uses v8 coverage provider", () => {
      const config = getNestjsVitestConfig();
      const coverage = config.test?.coverage as Record<string, unknown>;

      expect(coverage.provider).toBe("v8");
    });

    it("collects coverage from all TypeScript files", () => {
      const config = getNestjsVitestConfig();
      const coverage = config.test?.coverage as Record<string, unknown>;
      const include = coverage.include as string[];

      expect(include).toContain("**/*.ts");
    });

    it("excludes NestJS boilerplate from coverage", () => {
      const config = getNestjsVitestConfig();
      const coverage = config.test?.coverage as Record<string, unknown>;
      const exclude = coverage.exclude as string[];

      expect(exclude).toContain("**/*.entity.ts");
      expect(exclude).toContain("**/*.dto.ts");
      expect(exclude).toContain("**/*.module.ts");
      expect(exclude).toContain("**/database/migrations/**");
      expect(exclude).toContain("**/main.ts");
    });

    it("applies default 70% thresholds", () => {
      const config = getNestjsVitestConfig();
      const coverage = config.test?.coverage as Record<string, unknown>;
      const thresholds = coverage.thresholds as Record<string, number>;

      expect(thresholds.statements).toBe(70);
      expect(thresholds.branches).toBe(70);
      expect(thresholds.functions).toBe(70);
      expect(thresholds.lines).toBe(70);
    });

    it("applies custom thresholds", () => {
      const config = getNestjsVitestConfig({
        thresholds: { global: { statements: 90 } },
      });
      const coverage = config.test?.coverage as Record<string, unknown>;
      const thresholds = coverage.thresholds as Record<string, number>;

      expect(thresholds.statements).toBe(90);
    });
  });
});
