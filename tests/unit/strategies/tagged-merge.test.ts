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

  // Core behavior tests
  describe("core behavior", () => {
    it("has correct name", () => {
      expect(strategy.name).toBe("tagged-merge");
    });

    it("copies file when destination does not exist", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);
      await fs.writeJson(srcFile, {
        scripts: { test: "vitest" },
      });

      const result = await strategy.apply(
        srcFile,
        destFile,
        PACKAGE_JSON,
        createContext()
      );

      expect(result.action).toBe("copied");
      expect(await fs.pathExists(destFile)).toBe(true);
      const content = await fs.readJson(destFile);
      expect(content.scripts.test).toBe("vitest");
    });

    it("backs up file before merging", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);
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

      await strategy.apply(srcFile, destFile, PACKAGE_JSON, context);
      expect(backupCalled).toBe(true);
    });

    it("skips when no changes detected", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);
      const content = {
        scripts: { test: "vitest" },
      };
      await fs.writeJson(srcFile, content);
      await fs.writeJson(destFile, content);

      const result = await strategy.apply(
        srcFile,
        destFile,
        PACKAGE_JSON,
        createContext()
      );

      expect(result.action).toBe("skipped");
    });

    it("respects dry-run mode", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);
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
        PACKAGE_JSON,
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
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

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
        PACKAGE_JSON,
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
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

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

      await strategy.apply(srcFile, destFile, PACKAGE_JSON, createContext());

      const result = await fs.readJson(destFile);
      expect(result["//lisa-force-deps"]).toBe("description");
      expect(result["//end-lisa-force-deps"]).toBe("");
    });

    it("handles multiple force sections", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

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

      await strategy.apply(srcFile, destFile, PACKAGE_JSON, createContext());

      const result = await fs.readJson(destFile);
      expect(result.scripts).toEqual({ test: "vitest" });
      expect(result.engines).toEqual({ node: "20.x" });
      expect(result.custom).toBe("value");
    });

    it("preserves untagged content from project", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

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

      await strategy.apply(srcFile, destFile, PACKAGE_JSON, createContext());

      const result = await fs.readJson(destFile);
      expect(result.customField).toBe("customValue");
      expect(result.name).toBe("my-project");
    });
  });
});
