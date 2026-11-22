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

/** The description carried by the engines defaults tag. */
const DEFAULT_ENGINES_TAG = "Default engines";

/** The preinstall value the defaults template ships. */
const PLEASE_USE_BUN = "please-use-bun";

/** A trusted dependency Lisa contributes to the merged array. */
const AST_GREP_CLI = "@ast-grep/cli";

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

  // Defaults behavior tests
  describe("defaults behavior", () => {
    it("preserves project content in defaults section", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

      // Lisa provides defaults with npm
      await fs.writeJson(srcFile, {
        "//lisa-defaults-engines": DEFAULT_ENGINES_TAG,
        engines: {
          node: "18.x",
          npm: PLEASE_USE_BUN,
        },
        "//end-lisa-defaults-engines": "",
      });

      // Project overrides with different node version
      await fs.writeJson(destFile, {
        "//lisa-defaults-engines": DEFAULT_ENGINES_TAG,
        engines: {
          node: "20.x",
        },
        "//end-lisa-defaults-engines": "",
      });

      // The defaults behavior: since project has the section, use project's content as-is
      const result = await strategy.apply(
        srcFile,
        destFile,
        PACKAGE_JSON,
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
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

      await fs.writeJson(srcFile, {
        "//lisa-defaults-engines": DEFAULT_ENGINES_TAG,
        engines: {
          node: "18.x",
          npm: PLEASE_USE_BUN,
        },
        "//end-lisa-defaults-engines": "",
      });

      await fs.writeJson(destFile, {
        name: "my-project",
      });

      await strategy.apply(srcFile, destFile, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destFile);
      expect(content.engines.node).toBe("18.x");
      expect(content.engines.npm).toBe(PLEASE_USE_BUN);
    });

    it("handles empty defaults section in project", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

      await fs.writeJson(srcFile, {
        "//lisa-defaults-engines": DEFAULT_ENGINES_TAG,
        node: "18.x",
        "//end-lisa-defaults-engines": "",
      });

      await fs.writeJson(destFile, {
        "//lisa-defaults-engines": DEFAULT_ENGINES_TAG,
        "//end-lisa-defaults-engines": "",
      });

      await strategy.apply(srcFile, destFile, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destFile);
      expect(content.node).toBe("18.x");
    });
  });

  // Array merge behavior tests
  describe("array merge behavior", () => {
    it("combines arrays from Lisa and project without duplicates", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

      // Lisa provides some trusted dependencies
      await fs.writeJson(srcFile, {
        "//lisa-merge-trusted": "Trusted dependencies",
        trustedDependencies: [AST_GREP_CLI],
        "//end-lisa-merge-trusted": "",
      });

      // Project adds more
      await fs.writeJson(destFile, {
        "//lisa-merge-trusted": "Trusted dependencies",
        trustedDependencies: [AST_GREP_CLI, "esbuild"],
        "//end-lisa-merge-trusted": "",
      });

      const result = await strategy.apply(
        srcFile,
        destFile,
        PACKAGE_JSON,
        createContext()
      );

      expect(result.action).toBe("skipped"); // No change since all Lisa items are in project

      const content = await fs.readJson(destFile);
      expect(content.trustedDependencies).toContain(AST_GREP_CLI);
      expect(content.trustedDependencies).toContain("esbuild");
    });

    it("deduplicates array items by JSON value", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

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

      await strategy.apply(srcFile, destFile, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destFile);
      // Lisa items first, then project items not in Lisa
      expect(content.deps).toEqual(["a", "b", "c"]);
    });

    it("handles object items in merge arrays", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

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

      await strategy.apply(srcFile, destFile, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destFile);
      expect(content.items).toHaveLength(2);
      expect(content.items).toContainEqual(lisaItem);
      expect(content.items).toContainEqual(projectItem);
    });

    it("preserves array order with Lisa items first", async () => {
      const srcFile = path.join(srcDir, PACKAGE_JSON);
      const destFile = path.join(destDir, PACKAGE_JSON);

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

      await strategy.apply(srcFile, destFile, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destFile);
      expect(content.list).toEqual(["a", "b", "c", "d"]);
    });
  });
});
