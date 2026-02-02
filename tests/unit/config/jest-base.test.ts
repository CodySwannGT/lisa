import { describe, it, expect } from "@jest/globals";
import type { Config } from "jest";
import {
  defaultThresholds,
  defaultCoverageExclusions,
  mergeThresholds,
  mergeConfigs,
} from "../../../jest.base.js";

const TESTS_GLOB = "<rootDir>/tests/**/*.test.ts";
const SRC_GLOB = "<rootDir>/src/**/*.test.ts";

describe("jest.base", () => {
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
    it("excludes type definitions", () => {
      expect(defaultCoverageExclusions).toContain("!**/*.d.ts");
    });

    it("excludes test files", () => {
      expect(defaultCoverageExclusions).toContain("!**/*.test.ts");
      expect(defaultCoverageExclusions).toContain("!**/*.spec.ts");
    });

    it("excludes index files", () => {
      expect(defaultCoverageExclusions).toContain("!**/index.ts");
    });

    it("excludes node_modules and dist", () => {
      expect(defaultCoverageExclusions).toContain("!**/node_modules/**");
      expect(defaultCoverageExclusions).toContain("!**/dist/**");
    });
  });

  describe("mergeThresholds", () => {
    it("returns defaults when overrides have no global", () => {
      const result = mergeThresholds(
        defaultThresholds,
        {} as Config["coverageThreshold"]
      );

      expect(result?.global).toEqual(defaultThresholds?.global);
    });

    it("overrides specific threshold values", () => {
      const overrides: Config["coverageThreshold"] = {
        global: {
          statements: 90,
          branches: 80,
        },
      };

      const result = mergeThresholds(defaultThresholds, overrides);

      expect(result?.global).toEqual({
        statements: 90,
        branches: 80,
        functions: 70,
        lines: 70,
      });
    });

    it("preserves defaults for non-overridden values", () => {
      const overrides: Config["coverageThreshold"] = {
        global: {
          functions: 85,
        },
      };

      const result = mergeThresholds(defaultThresholds, overrides);

      expect((result?.global as Record<string, number>)?.statements).toBe(70);
      expect((result?.global as Record<string, number>)?.branches).toBe(70);
      expect((result?.global as Record<string, number>)?.functions).toBe(85);
      expect((result?.global as Record<string, number>)?.lines).toBe(70);
    });

    it("handles empty defaults", () => {
      const overrides: Config["coverageThreshold"] = {
        global: { statements: 50 },
      };

      const result = mergeThresholds(
        {} as Config["coverageThreshold"],
        overrides
      );

      expect((result?.global as Record<string, number>)?.statements).toBe(50);
    });

    it("preserves per-path keys from overrides", () => {
      const overrides: Config["coverageThreshold"] = {
        global: { statements: 80 },
        "./src/api/": { branches: 90 },
      };

      const result = mergeThresholds(defaultThresholds, overrides);
      const resultRecord = result as Record<string, unknown>;

      expect(resultRecord["./src/api/"]).toEqual({ branches: 90 });
    });

    it("preserves per-path keys from defaults when not in overrides", () => {
      const defaults: Config["coverageThreshold"] = {
        global: { statements: 70 },
        "./src/core/": { lines: 95 },
      };
      const overrides: Config["coverageThreshold"] = {
        global: { statements: 80 },
      };

      const result = mergeThresholds(defaults, overrides);
      const resultRecord = result as Record<string, unknown>;

      expect(resultRecord["./src/core/"]).toEqual({ lines: 95 });
      expect((result?.global as Record<string, number>)?.statements).toBe(80);
    });

    it("override per-path keys take precedence over default per-path keys", () => {
      const defaults: Config["coverageThreshold"] = {
        global: { statements: 70 },
        "./src/api/": { branches: 50 },
      };
      const overrides: Config["coverageThreshold"] = {
        global: { statements: 80 },
        "./src/api/": { branches: 90 },
      };

      const result = mergeThresholds(defaults, overrides);
      const resultRecord = result as Record<string, unknown>;

      expect(resultRecord["./src/api/"]).toEqual({ branches: 90 });
    });
  });

  describe("mergeConfigs", () => {
    it("merges scalar values with later configs taking precedence", () => {
      const base: Config = { testEnvironment: "node", testTimeout: 5000 };
      const override: Config = { testTimeout: 10000 };

      const result = mergeConfigs(base, override);

      expect(result.testEnvironment).toBe("node");
      expect(result.testTimeout).toBe(10000);
    });

    it("concatenates and deduplicates arrays", () => {
      const base: Config = {
        testMatch: [TESTS_GLOB],
      };
      const override: Config = {
        testMatch: [SRC_GLOB, TESTS_GLOB],
      };

      const result = mergeConfigs(base, override);

      expect(result.testMatch).toEqual([TESTS_GLOB, SRC_GLOB]);
    });

    it("shallow-merges objects", () => {
      const base: Config = {
        transform: { "^.+\\.tsx?$": "ts-jest" },
      };
      const override: Config = {
        transform: { "^.+\\.jsx?$": "babel-jest" },
      };

      const result = mergeConfigs(base, override);

      expect(result.transform).toEqual({
        "^.+\\.tsx?$": "ts-jest",
        "^.+\\.jsx?$": "babel-jest",
      });
    });

    it("handles empty configs", () => {
      const base: Config = { testEnvironment: "node" };

      const result = mergeConfigs(base, {});

      expect(result.testEnvironment).toBe("node");
    });

    it("merges three or more configs in order", () => {
      const base: Config = { testTimeout: 5000 };
      const mid: Config = { testTimeout: 10000, testEnvironment: "node" };
      const top: Config = { testEnvironment: "jsdom" };

      const result = mergeConfigs(base, mid, top);

      expect(result.testTimeout).toBe(10000);
      expect(result.testEnvironment).toBe("jsdom");
    });

    it("returns empty config when no args provided", () => {
      const result = mergeConfigs();

      expect(result).toEqual({});
    });
  });
});
