import {
  defaultThresholds,
  defaultCoverageExclusions,
  mergeThresholds,
  mergeConfigs,
  worktreeTestPathIgnorePatterns,
} from "../../../src/configs/jest/base.js";

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
        {} as Parameters<typeof mergeThresholds>[0]
      );

      expect(result?.global).toEqual(defaultThresholds?.global);
    });

    it("overrides specific threshold values", () => {
      const overrides: Parameters<typeof mergeThresholds>[0] = {
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
      const overrides: Parameters<typeof mergeThresholds>[0] = {
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
      const overrides: Parameters<typeof mergeThresholds>[0] = {
        global: { statements: 50 },
      };

      const result = mergeThresholds(
        {} as Parameters<typeof mergeThresholds>[0],
        overrides
      );

      expect((result?.global as Record<string, number>)?.statements).toBe(50);
    });

    it("preserves per-path keys from overrides", () => {
      const overrides: Parameters<typeof mergeThresholds>[0] = {
        global: { statements: 80 },
        "./src/api/": { branches: 90 },
      };

      const result = mergeThresholds(defaultThresholds, overrides);
      const resultRecord = result as Record<string, unknown>;

      expect(resultRecord["./src/api/"]).toEqual({ branches: 90 });
    });

    it("preserves per-path keys from defaults when not in overrides", () => {
      const defaults: Parameters<typeof mergeThresholds>[0] = {
        global: { statements: 70 },
        "./src/core/": { lines: 95 },
      };
      const overrides: Parameters<typeof mergeThresholds>[0] = {
        global: { statements: 80 },
      };

      const result = mergeThresholds(defaults, overrides);
      const resultRecord = result as Record<string, unknown>;

      expect(resultRecord["./src/core/"]).toEqual({ lines: 95 });
      expect((result?.global as Record<string, number>)?.statements).toBe(80);
    });

    it("override per-path keys take precedence over default per-path keys", () => {
      const defaults: Parameters<typeof mergeThresholds>[0] = {
        global: { statements: 70 },
        "./src/api/": { branches: 50 },
      };
      const overrides: Parameters<typeof mergeThresholds>[0] = {
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
      const base: Parameters<typeof mergeConfigs>[0] = {
        testEnvironment: "node",
        testTimeout: 5000,
      };
      const override: Parameters<typeof mergeConfigs>[0] = {
        testTimeout: 10000,
      };

      const result = mergeConfigs(base, override);

      expect(result.testEnvironment).toBe("node");
      expect(result.testTimeout).toBe(10000);
    });

    it("concatenates and deduplicates arrays", () => {
      const base: Parameters<typeof mergeConfigs>[0] = {
        testMatch: [TESTS_GLOB],
      };
      const override: Parameters<typeof mergeConfigs>[0] = {
        testMatch: [SRC_GLOB, TESTS_GLOB],
      };

      const result = mergeConfigs(base, override);

      expect(result.testMatch).toEqual([TESTS_GLOB, SRC_GLOB]);
    });

    it("shallow-merges objects", () => {
      const base: Parameters<typeof mergeConfigs>[0] = {
        transform: { "^.+\\.tsx?$": "ts-jest" },
      };
      const override: Parameters<typeof mergeConfigs>[0] = {
        transform: { "^.+\\.jsx?$": "babel-jest" },
      };

      const result = mergeConfigs(base, override);

      expect(result.transform).toEqual({
        "^.+\\.tsx?$": "ts-jest",
        "^.+\\.jsx?$": "babel-jest",
      });
    });

    it("handles empty configs", () => {
      const base: Parameters<typeof mergeConfigs>[0] = {
        testEnvironment: "node",
      };

      const result = mergeConfigs(base, {});

      expect(result.testEnvironment).toBe("node");
    });

    it("merges three or more configs in order", () => {
      const base: Parameters<typeof mergeConfigs>[0] = { testTimeout: 5000 };
      const mid: Parameters<typeof mergeConfigs>[0] = {
        testTimeout: 10000,
        testEnvironment: "node",
      };
      const top: Parameters<typeof mergeConfigs>[0] = {
        testEnvironment: "jsdom",
      };

      const result = mergeConfigs(base, mid, top);

      expect(result.testTimeout).toBe(10000);
      expect(result.testEnvironment).toBe("jsdom");
    });

    it("returns empty config when no args provided", () => {
      const result = mergeConfigs();

      expect(result).toEqual({});
    });
  });

  describe("worktreeTestPathIgnorePatterns", () => {
    const originalCwd = process.cwd;

    afterEach(() => {
      process.cwd = originalCwd;
    });

    it("returns the worktree ignore pattern when cwd is outside a worktree", () => {
      process.cwd = () => "/some/project";

      expect(worktreeTestPathIgnorePatterns()).toEqual(["/.claude/worktrees/"]);
    });

    it("returns an empty array when cwd is inside a .claude/worktrees path", () => {
      process.cwd = () => "/some/project/.claude/worktrees/feature-branch";

      expect(worktreeTestPathIgnorePatterns()).toEqual([]);
    });

    it("detects worktree in any path segment", () => {
      process.cwd = () => "/Users/dev/project/.claude/worktrees/SE-123/subdir";

      expect(worktreeTestPathIgnorePatterns()).toEqual([]);
    });

    it("returns an empty array when cwd is a Windows-style worktree path", () => {
      process.cwd = () => "C:\\projects\\.claude\\worktrees\\feature-branch";

      expect(worktreeTestPathIgnorePatterns()).toEqual([]);
    });

    it("returns an empty array when cwd is a Windows worktree path with subdirectory", () => {
      process.cwd = () =>
        "C:\\Users\\dev\\project\\.claude\\worktrees\\SE-123\\subdir";

      expect(worktreeTestPathIgnorePatterns()).toEqual([]);
    });

    it("returns the ignore pattern for a Windows-style path outside a worktree", () => {
      process.cwd = () => "C:\\projects\\my-app";

      expect(worktreeTestPathIgnorePatterns()).toEqual(["/.claude/worktrees/"]);
    });
  });
});
