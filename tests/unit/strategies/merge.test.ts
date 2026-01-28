import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs-extra";
import * as path from "node:path";
import { MergeStrategy } from "../../../src/strategies/merge.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

const PACKAGE_JSON = "package.json";
const SETTINGS_JSON = "settings.json";
const CONFIG_JSON = "config.json";
const INVALID_JSON = "invalid.json";
const VALID_JSON = "valid.json";

describe("MergeStrategy", () => {
  let strategy: MergeStrategy;
  let tempDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(async () => {
    strategy = new MergeStrategy();
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
   * @param overrides - Configuration overrides
   * @returns Strategy context with test defaults
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

  it("has correct name", () => {
    expect(strategy.name).toBe("merge");
  });

  it("copies file when destination does not exist", async () => {
    const srcFile = path.join(srcDir, PACKAGE_JSON);
    const destFile = path.join(destDir, PACKAGE_JSON);
    await fs.writeJson(srcFile, { name: "test", scripts: { build: "tsc" } });

    const result = await strategy.apply(
      srcFile,
      destFile,
      PACKAGE_JSON,
      createContext()
    );

    expect(result.action).toBe("copied");
    expect(await fs.pathExists(destFile)).toBe(true);
    const content = await fs.readJson(destFile);
    expect(content).toEqual({ name: "test", scripts: { build: "tsc" } });
  });

  it("deep merges objects with Lisa values taking precedence", async () => {
    const srcFile = path.join(srcDir, PACKAGE_JSON);
    const destFile = path.join(destDir, PACKAGE_JSON);

    // Lisa provides enforced values
    await fs.writeJson(srcFile, {
      scripts: { test: "vitest", build: "tsc" },
      devDependencies: { vitest: "^1.0.0" },
    });

    // Project has its own values
    await fs.writeJson(destFile, {
      name: "my-project",
      scripts: { build: "rollup" }, // Lisa's build script overrides this
    });

    const result = await strategy.apply(
      srcFile,
      destFile,
      PACKAGE_JSON,
      createContext()
    );

    expect(result.action).toBe("merged");

    const content = await fs.readJson(destFile);
    expect(content).toEqual({
      name: "my-project",
      scripts: {
        test: "vitest", // Added from Lisa
        build: "tsc", // Lisa value wins
      },
      devDependencies: { vitest: "^1.0.0" }, // Added from Lisa
    });
  });

  it("skips when merged result is same as destination", async () => {
    const srcFile = path.join(srcDir, PACKAGE_JSON);
    const destFile = path.join(destDir, PACKAGE_JSON);

    await fs.writeJson(srcFile, { scripts: { test: "vitest" } });
    await fs.writeJson(destFile, { scripts: { test: "vitest" } });

    const result = await strategy.apply(
      srcFile,
      destFile,
      PACKAGE_JSON,
      createContext()
    );

    expect(result.action).toBe("skipped");
  });

  it("backs up file before merging", async () => {
    const srcFile = path.join(srcDir, PACKAGE_JSON);
    const destFile = path.join(destDir, PACKAGE_JSON);
    await fs.writeJson(srcFile, { new: "value" });
    await fs.writeJson(destFile, { existing: "value" });

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

  it("handles nested objects", async () => {
    const srcFile = path.join(srcDir, SETTINGS_JSON);
    const destFile = path.join(destDir, SETTINGS_JSON);

    await fs.writeJson(srcFile, {
      editor: {
        tabSize: 2,
        formatOnSave: true,
      },
    });

    await fs.writeJson(destFile, {
      editor: {
        tabSize: 4, // Project prefers 4 spaces
      },
    });

    await strategy.apply(srcFile, destFile, SETTINGS_JSON, createContext());

    const content = await fs.readJson(destFile);
    expect(content.editor.tabSize).toBe(2); // Lisa value wins
    expect(content.editor.formatOnSave).toBe(true); // Lisa value added
  });

  it("handles arrays (merges by index)", async () => {
    const srcFile = path.join(srcDir, CONFIG_JSON);
    const destFile = path.join(destDir, CONFIG_JSON);

    await fs.writeJson(srcFile, { plugins: ["a", "b"] });
    await fs.writeJson(destFile, { plugins: ["c"] });

    await strategy.apply(srcFile, destFile, CONFIG_JSON, createContext());

    const content = await fs.readJson(destFile);
    // lodash.merge merges arrays by index - src[0]='a' overwrites dest[0]='c', src[1]='b' is kept
    expect(content.plugins).toEqual(["a", "b"]);
  });

  it("does not modify files in dry run mode", async () => {
    const srcFile = path.join(srcDir, PACKAGE_JSON);
    const destFile = path.join(destDir, PACKAGE_JSON);
    await fs.writeJson(srcFile, { new: "value" });
    await fs.writeJson(destFile, { existing: "value" });

    const result = await strategy.apply(
      srcFile,
      destFile,
      PACKAGE_JSON,
      createContext({ dryRun: true })
    );

    expect(result.action).toBe("merged");
    const content = await fs.readJson(destFile);
    expect(content).toEqual({ existing: "value" }); // Unchanged
  });

  it("throws error for invalid source JSON", async () => {
    const srcFile = path.join(srcDir, INVALID_JSON);
    const destFile = path.join(destDir, INVALID_JSON);
    await fs.writeFile(srcFile, "not valid json");
    await fs.writeJson(destFile, { valid: true });

    await expect(
      strategy.apply(srcFile, destFile, INVALID_JSON, createContext())
    ).rejects.toThrow();
  });

  it("throws error for invalid destination JSON", async () => {
    const srcFile = path.join(srcDir, VALID_JSON);
    const destFile = path.join(destDir, INVALID_JSON);
    await fs.writeJson(srcFile, { valid: true });
    await fs.writeFile(destFile, "not valid json");

    await expect(
      strategy.apply(srcFile, destFile, INVALID_JSON, createContext())
    ).rejects.toThrow();
  });
});
