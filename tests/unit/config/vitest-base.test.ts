import {
  defaultThresholds,
  defaultCoverageExclusions,
  defaultTestExclusions,
  mergeThresholds,
  mergeVitestConfigs,
  mapThresholds,
} from "../../../src/configs/vitest/base.js";
import type { PortableThresholds } from "../../../src/configs/vitest/base.js";

const DSTAR_TEST_TS = "**/*.test.ts";
const TESTS_GLOB = "tests/**/*.test.ts";
const SRC_TEST_GLOB = "src/**/*.test.ts";
const SRC_TS_GLOB = "src/**/*.ts";

describe("vitest.base", () => {
  describe("defaultThresholds", () => {
    it("provides 70% defaults for all coverage metrics", () => {
      expect(defaultThresholds).toEqual({
        global: {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
      });
    });
  });

  describe("defaultCoverageExclusions", () => {
    it("excludes type definitions without negation prefix", () => {
      expect(defaultCoverageExclusions).toContain("**/*.d.ts");
    });

    it("excludes test files without negation prefix", () => {
      expect(defaultCoverageExclusions).toContain(DSTAR_TEST_TS);
      expect(defaultCoverageExclusions).toContain("**/*.spec.ts");
    });

    it("excludes index files without negation prefix", () => {
      expect(defaultCoverageExclusions).toContain("**/index.ts");
    });

    it("excludes node_modules and dist without negation prefix", () => {
      expect(defaultCoverageExclusions).toContain("**/node_modules/**");
      expect(defaultCoverageExclusions).toContain("**/dist/**");
    });

    it("does not use Jest-style negation prefixes", () => {
      const hasNegation = defaultCoverageExclusions.some(p =>
        p.startsWith("!")
      );

      expect(hasNegation).toBe(false);
    });

    it("excludes scratch worktrees from coverage", () => {
      expect(defaultCoverageExclusions).toContain("**/.claude/worktrees/**");
    });
  });

  describe("defaultTestExclusions", () => {
    it("excludes node_modules, dist, and scratch worktrees", () => {
      expect(defaultTestExclusions).toEqual([
        "**/node_modules/**",
        "**/dist/**",
        "**/.claude/worktrees/**",
      ]);
    });
  });

  describe("mapThresholds", () => {
    it("maps portable format to flat Vitest format", () => {
      const result = mapThresholds({
        global: { statements: 80, branches: 70, functions: 60, lines: 90 },
      });

      expect(result).toEqual({
        statements: 80,
        branches: 70,
        functions: 60,
        lines: 90,
      });
    });

    it("omits undefined metrics", () => {
      const result = mapThresholds({
        global: { statements: 80 },
      });

      expect(result).toEqual({ statements: 80 });
    });

    it("handles empty global", () => {
      const result = mapThresholds({ global: {} });

      expect(result).toEqual({});
    });

    it("handles missing global", () => {
      const result = mapThresholds({} as PortableThresholds);

      expect(result).toEqual({});
    });
  });

  describe("mergeThresholds", () => {
    it("returns defaults when overrides have no global", () => {
      const result = mergeThresholds(
        defaultThresholds,
        {} as PortableThresholds
      );

      expect(result.global).toEqual(defaultThresholds.global);
    });

    it("overrides specific threshold values", () => {
      const overrides: PortableThresholds = {
        global: { statements: 90, branches: 80 },
      };

      const result = mergeThresholds(defaultThresholds, overrides);

      expect(result.global).toEqual({
        statements: 90,
        branches: 80,
        functions: 70,
        lines: 70,
      });
    });

    it("preserves defaults for non-overridden values", () => {
      const overrides: PortableThresholds = {
        global: { functions: 85 },
      };

      const result = mergeThresholds(defaultThresholds, overrides);
      const global = result.global as Record<string, number>;

      expect(global.statements).toBe(70);
      expect(global.branches).toBe(70);
      expect(global.functions).toBe(85);
      expect(global.lines).toBe(70);
    });

    it("preserves per-path keys from overrides", () => {
      const overrides = {
        global: { statements: 80 },
        "./src/api/": { branches: 90 },
      };

      const result = mergeThresholds(defaultThresholds, overrides);
      const resultRecord = result as Record<string, unknown>;

      expect(resultRecord["./src/api/"]).toEqual({ branches: 90 });
    });
  });

  describe("mergeVitestConfigs", () => {
    it("merges scalar test values with later configs taking precedence", () => {
      const base = {
        test: { environment: "node" as const, testTimeout: 5000 },
      };
      const override = { test: { testTimeout: 10000 } };

      const result = mergeVitestConfigs(base, override);

      expect(result.test).toMatchObject({
        environment: "node",
        testTimeout: 10000,
      });
    });

    it("concatenates and deduplicates arrays in test config", () => {
      const base = { test: { include: [TESTS_GLOB] } };
      const override = {
        test: {
          include: [SRC_TEST_GLOB, TESTS_GLOB],
        },
      };

      const result = mergeVitestConfigs(base, override);
      const include = (result.test as Record<string, unknown>)
        .include as string[];

      expect(include).toEqual([TESTS_GLOB, SRC_TEST_GLOB]);
    });

    it("shallow-merges nested objects in test config", () => {
      const base = {
        test: {
          coverage: { provider: "v8" as const, include: [SRC_TS_GLOB] },
        },
      };
      const override = {
        test: {
          coverage: { exclude: [DSTAR_TEST_TS] },
        },
      };

      const result = mergeVitestConfigs(base, override);
      const coverage = (result.test as Record<string, unknown>)
        .coverage as Record<string, unknown>;

      expect(coverage.provider).toBe("v8");
      expect(coverage.include).toEqual([SRC_TS_GLOB]);
      expect(coverage.exclude).toEqual([DSTAR_TEST_TS]);
    });

    it("returns empty config when no args provided", () => {
      const result = mergeVitestConfigs();

      expect(result).toEqual({});
    });

    it("merges three or more configs in order", () => {
      const base = { test: { testTimeout: 5000 } };
      const mid = {
        test: { testTimeout: 10000, environment: "node" as const },
      };
      const top = { test: { environment: "jsdom" as const } };

      const result = mergeVitestConfigs(base, mid, top);

      expect(result.test).toMatchObject({
        testTimeout: 10000,
        environment: "jsdom",
      });
    });
  });
});
