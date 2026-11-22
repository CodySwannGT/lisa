import * as fs from "fs-extra";
import * as path from "node:path";
import { TaggedMergeStrategy } from "../../../src/strategies/tagged-merge.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";
import {
  PACKAGE_JSON,
  buildTaggedMergeContext,
} from "./tagged-merge-fixtures.js";

/** A host-authored value that must survive the merge. */
const CUSTOM_VALUE = "custom-value";

/** The first of two files merged in one run. */
const TEST1_JSON = "test1.json";

/** The second of two files merged in one run. */
const TEST2_JSON = "test2.json";

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
    return buildTaggedMergeContext(srcDir, destDir, overrides);
  }

  // Complex scenarios
  describe("complex scenarios", () => {
    it("handles mixed behaviors in single file", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

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

      await strategy.apply(srcFile, destFile, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destFile);
      // Force: Lisa wins
      expect(content.scripts).toEqual({ test: "vitest" });
      // Defaults: Project wins
      expect(content.engines.node).toBe("20.x");
      // Merge: Combined
      expect(content.deps).toEqual(["a", "b"]);
    });

    it("preserves order from Lisa template with untagged content", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

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
        custom: CUSTOM_VALUE,
      });

      await strategy.apply(srcFile, destFile, PACKAGE_JSON, createContext());

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
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

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

      await strategy.apply(srcFile, destFile, PACKAGE_JSON, createContext());

      const result = await fs.readJson(destFile);
      expect(result.config.nested.deep).toBe("lisa-value");
    });
  });

  // Edge cases
  describe("edge cases", () => {
    it("handles empty JSON objects", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

      await fs.writeJson(srcFile, {});
      await fs.writeJson(destFile, {});

      const result = await strategy.apply(
        srcFile,
        destFile,
        PACKAGE_JSON,
        createContext()
      );

      expect(result.action).toBe("skipped");
    });

    it("handles files with only tags", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

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
        PACKAGE_JSON,
        createContext()
      );

      expect(result.action).toBe("merged");

      const content = await fs.readJson(destFile);
      expect(content.custom).toBe("value");
      expect(content["//lisa-force-test"]).toBe("desc");
    });

    it("handles null and undefined values gracefully", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

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

      await strategy.apply(srcFile, destFile, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destFile);
      expect(content.nullValue).toBeNull();
    });

    it("handles string keys that look like tags but aren't", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

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
        custom: CUSTOM_VALUE,
      });

      const result = await strategy.apply(
        srcFile,
        destFile,
        PACKAGE_JSON,
        createContext()
      );

      // Force section changes the key value, so result should be merged
      expect(result.action).toBe("merged");

      const content = await fs.readJson(destFile);
      // Valid force tags from Lisa should override
      expect(content.key).toBe("content");
      // Custom untagged content from project should be preserved
      expect(content.custom).toBe(CUSTOM_VALUE);
      // Non-matching tag patterns should be treated as tags and preserved
      expect(content["//notAtag"]).toBe("value1");
    });

    it("handles files with duplicate item deduplication", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

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

      await strategy.apply(srcFile, destFile, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destFile);
      // Should deduplicate: ["a", "b", "a", "c"] -> ["a", "b", "c"]
      expect(content.list).toEqual(["a", "b", "c"]);
    });
  });

  // File operation tests
  describe("file operations", () => {
    it("returns correct action types", async () => {
      const srcFile = path.join(srcDir, TEST1_JSON);
      const srcFile2 = path.join(srcDir, TEST2_JSON);
      const destFile = path.join(destDir, TEST1_JSON);
      const destFile2 = path.join(destDir, TEST2_JSON);

      // Test: copied (dest doesn't exist)
      await fs.writeJson(srcFile, { name: "test1" });
      const result1 = await strategy.apply(
        srcFile,
        destFile,
        TEST1_JSON,
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
        TEST2_JSON,
        createContext()
      );
      expect(result2.action).toBe("merged");
    });
  });
});
