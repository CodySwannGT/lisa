import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs-extra";
import * as path from "node:path";
import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

const TEST_FILE = "TEST_FILE";
const NEW_CONTENT = "new content";
const OLD_CONTENT = "old content";

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
    expect(strategy.name).toBe("copy-overwrite");
  });

  it("copies new file when destination does not exist", async () => {
    const srcFile = path.join(srcDir, TEST_FILE);
    const destFile = path.join(destDir, TEST_FILE);
    await fs.writeFile(srcFile, "hello world");

    const result = await strategy.apply(
      srcFile,
      destFile,
      TEST_FILE,
      createContext()
    );

    expect(result.action).toBe("copied");
    expect(await fs.pathExists(destFile)).toBe(true);
    expect(await fs.readFile(destFile, "utf-8")).toBe("hello world");
  });

  it("skips when files are identical", async () => {
    const srcFile = path.join(srcDir, TEST_FILE);
    const destFile = path.join(destDir, TEST_FILE);
    await fs.writeFile(srcFile, "same content");
    await fs.writeFile(destFile, "same content");

    const result = await strategy.apply(
      srcFile,
      destFile,
      TEST_FILE,
      createContext()
    );

    expect(result.action).toBe("skipped");
  });

  it("overwrites when files differ and promptOverwrite returns true", async () => {
    const srcFile = path.join(srcDir, TEST_FILE);
    const destFile = path.join(destDir, TEST_FILE);
    await fs.writeFile(srcFile, NEW_CONTENT);
    await fs.writeFile(destFile, OLD_CONTENT);

    let backupCalled = false;
    const context = {
      ...createContext(),
      backupFile: async () => {
        backupCalled = true;
      },
      promptOverwrite: async () => true,
    };

    const result = await strategy.apply(srcFile, destFile, TEST_FILE, context);

    expect(result.action).toBe("overwritten");
    expect(backupCalled).toBe(true);
    expect(await fs.readFile(destFile, "utf-8")).toBe(NEW_CONTENT);
  });

  it("calls backupFile with correct path before overwriting", async () => {
    const srcFile = path.join(srcDir, TEST_FILE);
    const destFile = path.join(destDir, TEST_FILE);
    await fs.writeFile(srcFile, NEW_CONTENT);
    await fs.writeFile(destFile, OLD_CONTENT);

    let backupPath: string | null = null;
    const context = {
      ...createContext(),
      backupFile: async (path: string) => {
        backupPath = path;
      },
      promptOverwrite: async () => true,
    };

    await strategy.apply(srcFile, destFile, TEST_FILE, context);

    expect(backupPath).toBe(destFile);
  });

  it("skips when files differ and promptOverwrite returns false", async () => {
    const srcFile = path.join(srcDir, TEST_FILE);
    const destFile = path.join(destDir, TEST_FILE);
    await fs.writeFile(srcFile, NEW_CONTENT);
    await fs.writeFile(destFile, OLD_CONTENT);

    const context = {
      ...createContext(),
      promptOverwrite: async () => false,
    };

    const result = await strategy.apply(srcFile, destFile, TEST_FILE, context);

    expect(result.action).toBe("skipped");
    expect(await fs.readFile(destFile, "utf-8")).toBe(OLD_CONTENT);
  });

  it("records file in manifest when copying", async () => {
    const srcFile = path.join(srcDir, TEST_FILE);
    const destFile = path.join(destDir, TEST_FILE);
    await fs.writeFile(srcFile, "content");

    let recorded: { path: string; strategy: string } | null = null;
    const context = {
      ...createContext(),
      recordFile: (relativePath: string, strat: string) => {
        recorded = { path: relativePath, strategy: strat };
      },
    };

    await strategy.apply(srcFile, destFile, TEST_FILE, context);

    expect(recorded).toEqual({ path: TEST_FILE, strategy: "copy-overwrite" });
  });

  it("creates parent directories when needed", async () => {
    const srcFile = path.join(srcDir, TEST_FILE);
    const destFile = path.join(destDir, "nested", "deep", TEST_FILE);
    await fs.writeFile(srcFile, "content");

    await strategy.apply(
      srcFile,
      destFile,
      `nested/deep/${TEST_FILE}`,
      createContext()
    );

    expect(await fs.pathExists(destFile)).toBe(true);
  });

  it("does not modify files in dry run mode", async () => {
    const srcFile = path.join(srcDir, TEST_FILE);
    const destFile = path.join(destDir, TEST_FILE);
    await fs.writeFile(srcFile, "content");

    const result = await strategy.apply(
      srcFile,
      destFile,
      TEST_FILE,
      createContext({ dryRun: true })
    );

    expect(result.action).toBe("copied");
    expect(await fs.pathExists(destFile)).toBe(false);
  });

  it("returns overwritten action in dry run when files differ", async () => {
    const srcFile = path.join(srcDir, TEST_FILE);
    const destFile = path.join(destDir, TEST_FILE);
    await fs.writeFile(srcFile, "new");
    await fs.writeFile(destFile, "old");

    const result = await strategy.apply(
      srcFile,
      destFile,
      TEST_FILE,
      createContext({ dryRun: true })
    );

    expect(result.action).toBe("overwritten");
    expect(await fs.readFile(destFile, "utf-8")).toBe("old");
  });
});
