import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs-extra";
import * as path from "node:path";
import { MergeStrategy } from "../../../src/strategies/merge.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

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
    const srcFile = path.join(srcDir, "package.json");
    const destFile = path.join(destDir, "package.json");
    await fs.writeJson(srcFile, { name: "test", scripts: { build: "tsc" } });

    const result = await strategy.apply(
      srcFile,
      destFile,
      "package.json",
      createContext()
    );

    expect(result.action).toBe("copied");
    expect(await fs.pathExists(destFile)).toBe(true);
    const content = await fs.readJson(destFile);
    expect(content).toEqual({ name: "test", scripts: { build: "tsc" } });
  });

  it("deep merges objects with project values taking precedence", async () => {
    const srcFile = path.join(srcDir, "package.json");
    const destFile = path.join(destDir, "package.json");

    // Lisa provides defaults
    await fs.writeJson(srcFile, {
      scripts: { test: "vitest", build: "tsc" },
      devDependencies: { vitest: "^1.0.0" },
    });

    // Project has its own values
    await fs.writeJson(destFile, {
      name: "my-project",
      scripts: { build: "rollup" }, // Should override Lisa's build script
    });

    const result = await strategy.apply(
      srcFile,
      destFile,
      "package.json",
      createContext()
    );

    expect(result.action).toBe("merged");

    const content = await fs.readJson(destFile);
    expect(content).toEqual({
      name: "my-project",
      scripts: {
        test: "vitest", // Added from Lisa
        build: "rollup", // Project value preserved
      },
      devDependencies: { vitest: "^1.0.0" }, // Added from Lisa
    });
  });

  it("skips when merged result is same as destination", async () => {
    const srcFile = path.join(srcDir, "package.json");
    const destFile = path.join(destDir, "package.json");

    await fs.writeJson(srcFile, { scripts: { test: "vitest" } });
    await fs.writeJson(destFile, { scripts: { test: "vitest" } });

    const result = await strategy.apply(
      srcFile,
      destFile,
      "package.json",
      createContext()
    );

    expect(result.action).toBe("skipped");
  });

  it("backs up file before merging", async () => {
    const srcFile = path.join(srcDir, "package.json");
    const destFile = path.join(destDir, "package.json");
    await fs.writeJson(srcFile, { new: "value" });
    await fs.writeJson(destFile, { existing: "value" });

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

  it("handles nested objects", async () => {
    const srcFile = path.join(srcDir, "settings.json");
    const destFile = path.join(destDir, "settings.json");

    await fs.writeJson(srcFile, {
      editor: {
        tabSize: 2,
        formatOnSave: true,
      },
    });

    await fs.writeJson(destFile, {
      editor: {
        tabSize: 4, // User prefers 4 spaces
      },
    });

    await strategy.apply(srcFile, destFile, "settings.json", createContext());

    const content = await fs.readJson(destFile);
    expect(content.editor.tabSize).toBe(4); // User value preserved
    expect(content.editor.formatOnSave).toBe(true); // Lisa value added
  });

  it("handles arrays (merges by index)", async () => {
    const srcFile = path.join(srcDir, "config.json");
    const destFile = path.join(destDir, "config.json");

    await fs.writeJson(srcFile, { plugins: ["a", "b"] });
    await fs.writeJson(destFile, { plugins: ["c"] });

    await strategy.apply(srcFile, destFile, "config.json", createContext());

    const content = await fs.readJson(destFile);
    // lodash.merge merges arrays by index - dest[0]='c' overwrites src[0]='a', src[1]='b' is kept
    expect(content.plugins).toEqual(["c", "b"]);
  });

  it("does not modify files in dry run mode", async () => {
    const srcFile = path.join(srcDir, "package.json");
    const destFile = path.join(destDir, "package.json");
    await fs.writeJson(srcFile, { new: "value" });
    await fs.writeJson(destFile, { existing: "value" });

    const result = await strategy.apply(
      srcFile,
      destFile,
      "package.json",
      createContext({ dryRun: true })
    );

    expect(result.action).toBe("merged");
    const content = await fs.readJson(destFile);
    expect(content).toEqual({ existing: "value" }); // Unchanged
  });

  it("throws error for invalid source JSON", async () => {
    const srcFile = path.join(srcDir, "invalid.json");
    const destFile = path.join(destDir, "invalid.json");
    await fs.writeFile(srcFile, "not valid json");
    await fs.writeJson(destFile, { valid: true });

    await expect(
      strategy.apply(srcFile, destFile, "invalid.json", createContext())
    ).rejects.toThrow();
  });

  it("throws error for invalid destination JSON", async () => {
    const srcFile = path.join(srcDir, "valid.json");
    const destFile = path.join(destDir, "invalid.json");
    await fs.writeJson(srcFile, { valid: true });
    await fs.writeFile(destFile, "not valid json");

    await expect(
      strategy.apply(srcFile, destFile, "invalid.json", createContext())
    ).rejects.toThrow();
  });
});
