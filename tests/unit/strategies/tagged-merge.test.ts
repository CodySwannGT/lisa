/* eslint-disable max-lines,sonarjs/no-duplicate-string -- Comprehensive test suite requires extensive test cases with repeated fixtures */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs-extra";
import * as path from "node:path";
import { TaggedMergeStrategy } from "../../../src/strategies/tagged-merge.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

describe("TaggedMergeStrategy", () => {
  let strategy: TaggedMergeStrategy;
  let tempDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(async () => {
    strategy = new TaggedMergeStrategy();
    tempDir = await createTempDir();
    srcDir = path.join(tempDir, "src");
    destDir = path.join(tempDir, "dest");
    await fs.ensureDir(srcDir);
    await fs.ensureDir(destDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Create a strategy context for testing
   * @param overrides Config overrides to apply
   * @returns Strategy context for test execution
   */
  function createContext(overrides: Partial<LisaConfig> = {}): StrategyContext {
    const config: LisaConfig = {
      lisaDir: srcDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      ...overrides,
    };

    return {
      config,
      recordFile: () => {},
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };
  }

  // Core behavior tests
  describe("core behavior", () => {
    it("has correct name", () => {
      expect(strategy.name).toBe("tagged-merge");
    });

    it("copies file when destination does not exist", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");
      await fs.writeJson(srcFile, {
        scripts: { test: "vitest" },
      });

      const result = await strategy.apply(
        srcFile,
        destFile,
        "package.json",
        createContext()
      );

      expect(result.action).toBe("copied");
      expect(await fs.pathExists(destFile)).toBe(true);
      const content = await fs.readJson(destFile);
      expect(content.scripts.test).toBe("vitest");
    });

    it("backs up file before merging", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");
      await fs.writeJson(srcFile, {
        "//lisa-force-test": "description",
        test: "value",
        "//end-lisa-force-test": "",
      });
      await fs.writeJson(destFile, {
        existing: "value",
      });

      let backupCalled = false;
      const context = {
        ...createContext(),
        backupFile: async () => {
          backupCalled = true;
        },
      };

      await strategy.apply(srcFile, destFile, "package.json", context);
      expect(backupCalled).toBe(true);
    });

    it("calls recordFile for processed files", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");
      await fs.writeJson(srcFile, { name: "lisa" });
      await fs.writeJson(destFile, { name: "project" });

      let recordCalled = false;
      const context = {
        ...createContext(),
        recordFile: () => {
          recordCalled = true;
        },
      };

      await strategy.apply(srcFile, destFile, "package.json", context);
      expect(recordCalled).toBe(true);
    });

    it("skips when no changes detected", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");
      const content = {
        scripts: { test: "vitest" },
      };
      await fs.writeJson(srcFile, content);
      await fs.writeJson(destFile, content);

      const result = await strategy.apply(
        srcFile,
        destFile,
        "package.json",
        createContext()
      );

      expect(result.action).toBe("skipped");
    });

    it("respects dry-run mode", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");
      await fs.writeJson(srcFile, {
        "//lisa-force-test": "description",
        new: "value",
        "//end-lisa-force-test": "",
      });
      await fs.writeJson(destFile, { existing: "value" });

      const originalContent = await fs.readJson(destFile);
      const result = await strategy.apply(
        srcFile,
        destFile,
        "package.json",
        createContext({ dryRun: true })
      );

      // File should not be modified in dry-run
      const finalContent = await fs.readJson(destFile);
      expect(finalContent).toEqual(originalContent);
      expect(result.action).toBe("merged");
    });
  });

  // Force behavior tests
  describe("force behavior", () => {
    it("replaces force section with Lisa version", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      // Lisa provides enforced values
      await fs.writeJson(srcFile, {
        "//lisa-force-scripts": "Required scripts",
        scripts: {
          test: "vitest",
          build: "tsc",
        },
        "//end-lisa-force-scripts": "",
      });

      // Project has different values
      await fs.writeJson(destFile, {
        "//lisa-force-scripts": "Required scripts",
        scripts: {
          test: "jest",
          build: "rollup",
          custom: "custom-build",
        },
        "//end-lisa-force-scripts": "",
      });

      const result = await strategy.apply(
        srcFile,
        destFile,
        "package.json",
        createContext()
      );

      expect(result.action).toBe("merged");

      const content = await fs.readJson(destFile);
      expect(content.scripts).toEqual({
        test: "vitest",
        build: "tsc",
      });
    });

    it("preserves tag structure in force sections", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      await fs.writeJson(srcFile, {
        "//lisa-force-deps": "description",
        devDeps: { a: "1.0.0" },
        "//end-lisa-force-deps": "",
      });

      await fs.writeJson(destFile, {
        "//lisa-force-deps": "old description",
        devDeps: { b: "2.0.0" },
        "//end-lisa-force-deps": "",
      });

      await strategy.apply(srcFile, destFile, "package.json", createContext());

      const result = await fs.readJson(destFile);
      expect(result["//lisa-force-deps"]).toBe("description");
      expect(result["//end-lisa-force-deps"]).toBe("");
    });

    it("handles multiple force sections", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      await fs.writeJson(srcFile, {
        "//lisa-force-scripts": "Scripts",
        scripts: { test: "vitest" },
        "//end-lisa-force-scripts": "",
        "//lisa-force-engines": "Engines",
        engines: { node: "20.x" },
        "//end-lisa-force-engines": "",
      });

      await fs.writeJson(destFile, {
        "//lisa-force-scripts": "Scripts",
        scripts: { test: "jest" },
        "//end-lisa-force-scripts": "",
        "//lisa-force-engines": "Engines",
        engines: { node: "18.x" },
        "//end-lisa-force-engines": "",
        custom: "value",
      });

      await strategy.apply(srcFile, destFile, "package.json", createContext());

      const result = await fs.readJson(destFile);
      expect(result.scripts).toEqual({ test: "vitest" });
      expect(result.engines).toEqual({ node: "20.x" });
      expect(result.custom).toBe("value");
    });

    it("preserves untagged content from project", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      await fs.writeJson(srcFile, {
        "//lisa-force-scripts": "Scripts",
        scripts: { test: "vitest" },
        "//end-lisa-force-scripts": "",
      });

      await fs.writeJson(destFile, {
        "//lisa-force-scripts": "Scripts",
        scripts: { test: "jest" },
        "//end-lisa-force-scripts": "",
        customField: "customValue",
        name: "my-project",
      });

      await strategy.apply(srcFile, destFile, "package.json", createContext());

      const result = await fs.readJson(destFile);
      expect(result.customField).toBe("customValue");
      expect(result.name).toBe("my-project");
    });
  });

  // Defaults behavior tests
  describe("defaults behavior", () => {
    it("preserves project content in defaults section", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      // Lisa provides defaults with npm
      await fs.writeJson(srcFile, {
        "//lisa-defaults-engines": "Default engines",
        engines: {
          node: "18.x",
          npm: "please-use-bun",
        },
        "//end-lisa-defaults-engines": "",
      });

      // Project overrides with different node version
      await fs.writeJson(destFile, {
        "//lisa-defaults-engines": "Default engines",
        engines: {
          node: "20.x",
        },
        "//end-lisa-defaults-engines": "",
      });

      // The defaults behavior: since project has the section, use project's content as-is
      const result = await strategy.apply(
        srcFile,
        destFile,
        "package.json",
        createContext()
      );

      // No change expected - project content is used as-is for defaults
      expect(result.action).toBe("skipped");

      const content = await fs.readJson(destFile);
      expect(content.engines.node).toBe("20.x");
      // npm should not be added (project didn't have it, defaults behavior preserves as-is)
      expect(content.engines.npm).toBeUndefined();
    });

    it("uses Lisa content when project has no defaults section", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      await fs.writeJson(srcFile, {
        "//lisa-defaults-engines": "Default engines",
        engines: {
          node: "18.x",
          npm: "please-use-bun",
        },
        "//end-lisa-defaults-engines": "",
      });

      await fs.writeJson(destFile, {
        name: "my-project",
      });

      await strategy.apply(srcFile, destFile, "package.json", createContext());

      const content = await fs.readJson(destFile);
      expect(content.engines.node).toBe("18.x");
      expect(content.engines.npm).toBe("please-use-bun");
    });

    it("handles empty defaults section in project", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      await fs.writeJson(srcFile, {
        "//lisa-defaults-engines": "Default engines",
        node: "18.x",
        "//end-lisa-defaults-engines": "",
      });

      await fs.writeJson(destFile, {
        "//lisa-defaults-engines": "Default engines",
        "//end-lisa-defaults-engines": "",
      });

      await strategy.apply(srcFile, destFile, "package.json", createContext());

      const content = await fs.readJson(destFile);
      expect(content.node).toBe("18.x");
    });
  });

  // Array merge behavior tests
  describe("array merge behavior", () => {
    it("combines arrays from Lisa and project without duplicates", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      // Lisa provides some trusted dependencies
      await fs.writeJson(srcFile, {
        "//lisa-merge-trusted": "Trusted dependencies",
        trustedDependencies: ["@ast-grep/cli"],
        "//end-lisa-merge-trusted": "",
      });

      // Project adds more
      await fs.writeJson(destFile, {
        "//lisa-merge-trusted": "Trusted dependencies",
        trustedDependencies: ["@ast-grep/cli", "esbuild"],
        "//end-lisa-merge-trusted": "",
      });

      const result = await strategy.apply(
        srcFile,
        destFile,
        "package.json",
        createContext()
      );

      expect(result.action).toBe("skipped"); // No change since all Lisa items are in project

      const content = await fs.readJson(destFile);
      expect(content.trustedDependencies).toContain("@ast-grep/cli");
      expect(content.trustedDependencies).toContain("esbuild");
    });

    it("deduplicates array items by JSON value", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      await fs.writeJson(srcFile, {
        "//lisa-merge-deps": "Dependencies",
        deps: ["a", "b"],
        "//end-lisa-merge-deps": "",
      });

      await fs.writeJson(destFile, {
        "//lisa-merge-deps": "Dependencies",
        deps: ["b", "c"],
        "//end-lisa-merge-deps": "",
      });

      await strategy.apply(srcFile, destFile, "package.json", createContext());

      const content = await fs.readJson(destFile);
      // Lisa items first, then project items not in Lisa
      expect(content.deps).toEqual(["a", "b", "c"]);
    });

    it("handles object items in merge arrays", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      const lisaItem = { name: "esbuild", version: "^0.20.0" };
      const projectItem = { name: "rollup", version: "^3.0.0" };

      await fs.writeJson(srcFile, {
        "//lisa-merge-items": "Items",
        items: [lisaItem],
        "//end-lisa-merge-items": "",
      });

      await fs.writeJson(destFile, {
        "//lisa-merge-items": "Items",
        items: [lisaItem, projectItem],
        "//end-lisa-merge-items": "",
      });

      await strategy.apply(srcFile, destFile, "package.json", createContext());

      const content = await fs.readJson(destFile);
      expect(content.items).toHaveLength(2);
      expect(content.items).toContainEqual(lisaItem);
      expect(content.items).toContainEqual(projectItem);
    });

    it("preserves array order with Lisa items first", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      await fs.writeJson(srcFile, {
        "//lisa-merge-list": "List",
        list: ["a", "b"],
        "//end-lisa-merge-list": "",
      });

      await fs.writeJson(destFile, {
        "//lisa-merge-list": "List",
        list: ["c", "d"],
        "//end-lisa-merge-list": "",
      });

      await strategy.apply(srcFile, destFile, "package.json", createContext());

      const content = await fs.readJson(destFile);
      expect(content.list).toEqual(["a", "b", "c", "d"]);
    });
  });

  // Complex scenarios
  describe("complex scenarios", () => {
    it("handles mixed behaviors in single file", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      await fs.writeJson(srcFile, {
        "//lisa-force-scripts": "Required",
        scripts: { test: "vitest" },
        "//end-lisa-force-scripts": "",
        "//lisa-defaults-engines": "Defaults",
        engines: { node: "18.x" },
        "//end-lisa-defaults-engines": "",
        "//lisa-merge-deps": "Merge",
        deps: ["a"],
        "//end-lisa-merge-deps": "",
      });

      await fs.writeJson(destFile, {
        "//lisa-force-scripts": "Required",
        scripts: { test: "jest", custom: "value" },
        "//end-lisa-force-scripts": "",
        "//lisa-defaults-engines": "Defaults",
        engines: { node: "20.x" },
        "//end-lisa-defaults-engines": "",
        "//lisa-merge-deps": "Merge",
        deps: ["b"],
        "//end-lisa-merge-deps": "",
      });

      await strategy.apply(srcFile, destFile, "package.json", createContext());

      const content = await fs.readJson(destFile);
      // Force: Lisa wins
      expect(content.scripts).toEqual({ test: "vitest" });
      // Defaults: Project wins
      expect(content.engines.node).toBe("20.x");
      // Merge: Combined
      expect(content.deps).toEqual(["a", "b"]);
    });

    it("preserves order from Lisa template with untagged content", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      await fs.writeJson(srcFile, {
        "//lisa-force-test": "Test",
        key1: "value1",
        "//end-lisa-force-test": "",
        untagged: "untagged-value",
      });

      await fs.writeJson(destFile, {
        "//lisa-force-test": "Test",
        key1: "old",
        "//end-lisa-force-test": "",
        untagged: "old-untagged",
        custom: "custom-value",
      });

      await strategy.apply(srcFile, destFile, "package.json", createContext());

      const result = await fs.readJson(destFile);
      const keys = Object.keys(result);

      // Lisa tags should come first
      const forceSectionStart = keys.indexOf("//lisa-force-test");
      const untaggedIndex = keys.indexOf("untagged");
      const customIndex = keys.indexOf("custom");

      expect(forceSectionStart).toBeLessThan(untaggedIndex);
      expect(untaggedIndex).toBeLessThan(customIndex);
    });

    it("handles deeply nested tagged structures", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      const nestedSource = {
        "//lisa-force-config": "Config",
        config: {
          nested: {
            deep: "lisa-value",
          },
        },
        "//end-lisa-force-config": "",
      };

      const nestedDest = {
        "//lisa-force-config": "Config",
        config: {
          nested: {
            deep: "project-value",
            extra: "extra-value",
          },
        },
        "//end-lisa-force-config": "",
      };

      await fs.writeJson(srcFile, nestedSource);
      await fs.writeJson(destFile, nestedDest);

      await strategy.apply(srcFile, destFile, "package.json", createContext());

      const result = await fs.readJson(destFile);
      expect(result.config.nested.deep).toBe("lisa-value");
    });
  });

  // Edge cases
  describe("edge cases", () => {
    it("handles empty JSON objects", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      await fs.writeJson(srcFile, {});
      await fs.writeJson(destFile, {});

      const result = await strategy.apply(
        srcFile,
        destFile,
        "package.json",
        createContext()
      );

      expect(result.action).toBe("skipped");
    });

    it("handles files with only tags", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      await fs.writeJson(srcFile, {
        "//lisa-force-test": "desc",
        "//end-lisa-force-test": "",
      });

      await fs.writeJson(destFile, {
        custom: "value",
      });

      const result = await strategy.apply(
        srcFile,
        destFile,
        "package.json",
        createContext()
      );

      expect(result.action).toBe("merged");

      const content = await fs.readJson(destFile);
      expect(content.custom).toBe("value");
      expect(content["//lisa-force-test"]).toBe("desc");
    });

    it("handles null and undefined values gracefully", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      await fs.writeJson(srcFile, {
        "//lisa-force-test": "test",
        nullValue: null,
        "//end-lisa-force-test": "",
      });

      await fs.writeJson(destFile, {
        "//lisa-force-test": "test",
        nullValue: "something",
        "//end-lisa-force-test": "",
      });

      await strategy.apply(srcFile, destFile, "package.json", createContext());

      const content = await fs.readJson(destFile);
      expect(content.nullValue).toBeNull();
    });

    it("handles string keys that look like tags but aren't", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      await fs.writeJson(srcFile, {
        "//notAtag": "value1",
        "//lisa-force-valid": "valid",
        key: "content",
        "//end-lisa-force-valid": "",
      });

      await fs.writeJson(destFile, {
        "//notAtag": "oldvalue",
        "//lisa-force-valid": "valid",
        key: "oldcontent",
        "//end-lisa-force-valid": "",
        custom: "custom-value",
      });

      const result = await strategy.apply(
        srcFile,
        destFile,
        "package.json",
        createContext()
      );

      // Force section changes the key value, so result should be merged
      expect(result.action).toBe("merged");

      const content = await fs.readJson(destFile);
      // Valid force tags from Lisa should override
      expect(content.key).toBe("content");
      // Custom untagged content from project should be preserved
      expect(content.custom).toBe("custom-value");
      // Non-matching tag patterns should be treated as tags and preserved
      expect(content["//notAtag"]).toBe("value1");
    });

    it("handles files with duplicate item deduplication", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");

      await fs.writeJson(srcFile, {
        "//lisa-merge-list": "list",
        list: ["a", "b", "a"],
        "//end-lisa-merge-list": "",
      });

      await fs.writeJson(destFile, {
        "//lisa-merge-list": "list",
        list: ["b", "c"],
        "//end-lisa-merge-list": "",
      });

      await strategy.apply(srcFile, destFile, "package.json", createContext());

      const content = await fs.readJson(destFile);
      // Should deduplicate: ["a", "b", "a", "c"] -> ["a", "b", "c"]
      expect(content.list).toEqual(["a", "b", "c"]);
    });
  });

  // File operation tests
  describe("file operations", () => {
    it("records files in manifest correctly", async () => {
      const srcFile = path.join(srcDir, "package.json");
      const destFile = path.join(destDir, "package.json");
      await fs.writeJson(srcFile, { test: "value" });
      await fs.writeJson(destFile, { existing: "value" });

      let recordedPath = "";
      let recordedStrategy = "";
      const context = {
        ...createContext(),
        recordFile: (path: string, strategy: string) => {
          recordedPath = path;
          recordedStrategy = strategy;
        },
      };

      await strategy.apply(srcFile, destFile, "package.json", context);

      expect(recordedPath).toBe("package.json");
      expect(recordedStrategy).toBe("tagged-merge");
    });

    it("returns correct action types", async () => {
      const srcFile = path.join(srcDir, "test1.json");
      const srcFile2 = path.join(srcDir, "test2.json");
      const destFile = path.join(destDir, "test1.json");
      const destFile2 = path.join(destDir, "test2.json");

      // Test: copied (dest doesn't exist)
      await fs.writeJson(srcFile, { name: "test1" });
      const result1 = await strategy.apply(
        srcFile,
        destFile,
        "test1.json",
        createContext()
      );
      expect(result1.action).toBe("copied");

      // Test: merged (files differ with force tag)
      await fs.writeJson(srcFile2, {
        "//lisa-force-test": "test",
        test: "new-value",
        "//end-lisa-force-test": "",
      });
      await fs.writeJson(destFile2, {
        "//lisa-force-test": "test",
        test: "old-value",
        "//end-lisa-force-test": "",
      });
      const result2 = await strategy.apply(
        srcFile2,
        destFile2,
        "test2.json",
        createContext()
      );
      expect(result2.action).toBe("merged");
    });
  });
});
/* eslint-enable max-lines,sonarjs/no-duplicate-string -- End of test suite */
