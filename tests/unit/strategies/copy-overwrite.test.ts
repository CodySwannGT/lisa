import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs-extra";
import * as path from "node:path";
import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

describe("CopyOverwriteStrategy", () => {
  let strategy: CopyOverwriteStrategy;
  let tempDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(async () => {
    strategy = new CopyOverwriteStrategy();
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
    expect(strategy.name).toBe("copy-overwrite");
  });

  it("copies new file when destination does not exist", async () => {
    const srcFile = path.join(srcDir, "test.txt");
    const destFile = path.join(destDir, "test.txt");
    await fs.writeFile(srcFile, "hello world");

    const result = await strategy.apply(
      srcFile,
      destFile,
      "test.txt",
      createContext()
    );

    expect(result.action).toBe("copied");
    expect(await fs.pathExists(destFile)).toBe(true);
    expect(await fs.readFile(destFile, "utf-8")).toBe("hello world");
  });

  it("skips when files are identical", async () => {
    const srcFile = path.join(srcDir, "test.txt");
    const destFile = path.join(destDir, "test.txt");
    await fs.writeFile(srcFile, "same content");
    await fs.writeFile(destFile, "same content");

    const result = await strategy.apply(
      srcFile,
      destFile,
      "test.txt",
      createContext()
    );

    expect(result.action).toBe("skipped");
  });

  it("overwrites when files differ and promptOverwrite returns true", async () => {
    const srcFile = path.join(srcDir, "test.txt");
    const destFile = path.join(destDir, "test.txt");
    await fs.writeFile(srcFile, "new content");
    await fs.writeFile(destFile, "old content");

    let backupCalled = false;
    const context = {
      ...createContext(),
      backupFile: async () => {
        backupCalled = true;
      },
      promptOverwrite: async () => true,
    };

    const result = await strategy.apply(srcFile, destFile, "test.txt", context);

    expect(result.action).toBe("overwritten");
    expect(backupCalled).toBe(true);
    expect(await fs.readFile(destFile, "utf-8")).toBe("new content");
  });

  it("skips when files differ and promptOverwrite returns false", async () => {
    const srcFile = path.join(srcDir, "test.txt");
    const destFile = path.join(destDir, "test.txt");
    await fs.writeFile(srcFile, "new content");
    await fs.writeFile(destFile, "old content");

    const context = {
      ...createContext(),
      promptOverwrite: async () => false,
    };

    const result = await strategy.apply(srcFile, destFile, "test.txt", context);

    expect(result.action).toBe("skipped");
    expect(await fs.readFile(destFile, "utf-8")).toBe("old content");
  });

  it("records file in manifest when copying", async () => {
    const srcFile = path.join(srcDir, "test.txt");
    const destFile = path.join(destDir, "test.txt");
    await fs.writeFile(srcFile, "content");

    let recorded: { path: string; strategy: string } | null = null;
    const context = {
      ...createContext(),
      recordFile: (relativePath: string, strat: string) => {
        recorded = { path: relativePath, strategy: strat };
      },
    };

    await strategy.apply(srcFile, destFile, "test.txt", context);

    expect(recorded).toEqual({ path: "test.txt", strategy: "copy-overwrite" });
  });

  it("creates parent directories when needed", async () => {
    const srcFile = path.join(srcDir, "test.txt");
    const destFile = path.join(destDir, "nested", "deep", "test.txt");
    await fs.writeFile(srcFile, "content");

    await strategy.apply(
      srcFile,
      destFile,
      "nested/deep/test.txt",
      createContext()
    );

    expect(await fs.pathExists(destFile)).toBe(true);
  });

  it("does not modify files in dry run mode", async () => {
    const srcFile = path.join(srcDir, "test.txt");
    const destFile = path.join(destDir, "test.txt");
    await fs.writeFile(srcFile, "content");

    const result = await strategy.apply(
      srcFile,
      destFile,
      "test.txt",
      createContext({ dryRun: true })
    );

    expect(result.action).toBe("copied");
    expect(await fs.pathExists(destFile)).toBe(false);
  });

  it("returns overwritten action in dry run when files differ", async () => {
    const srcFile = path.join(srcDir, "test.txt");
    const destFile = path.join(destDir, "test.txt");
    await fs.writeFile(srcFile, "new");
    await fs.writeFile(destFile, "old");

    const result = await strategy.apply(
      srcFile,
      destFile,
      "test.txt",
      createContext({ dryRun: true })
    );

    expect(result.action).toBe("overwritten");
    expect(await fs.readFile(destFile, "utf-8")).toBe("old");
  });
});
