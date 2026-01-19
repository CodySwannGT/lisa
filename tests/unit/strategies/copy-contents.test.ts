import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs-extra";
import * as path from "node:path";
import { CopyContentsStrategy } from "../../../src/strategies/copy-contents.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

const GITIGNORE = ".gitignore";
const NODE_MODULES = "node_modules\n";
const NODE_MODULES_ENV = "node_modules\n.env\n";
const ENV_ONLY = ".env\n";

describe("CopyContentsStrategy", () => {
  let strategy: CopyContentsStrategy;
  let tempDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(async () => {
    strategy = new CopyContentsStrategy();
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
    expect(strategy.name).toBe("copy-contents");
  });

  it("copies new file when destination does not exist", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    await fs.writeFile(srcFile, NODE_MODULES_ENV);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext()
    );

    expect(result.action).toBe("copied");
    expect(await fs.pathExists(destFile)).toBe(true);
    expect(await fs.readFile(destFile, "utf-8")).toBe(NODE_MODULES_ENV);
  });

  it("skips when files are identical", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    await fs.writeFile(srcFile, NODE_MODULES);
    await fs.writeFile(destFile, NODE_MODULES);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext()
    );

    expect(result.action).toBe("skipped");
  });

  it("appends missing lines", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    await fs.writeFile(srcFile, "node_modules\n.env\ndist\n");
    await fs.writeFile(destFile, NODE_MODULES);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext()
    );

    expect(result.action).toBe("appended");
    expect(result.linesAdded).toBe(2);

    const content = await fs.readFile(destFile, "utf-8");
    expect(content).toContain(ENV_ONLY.trim());
    expect(content).toContain("dist");
  });

  it("does not add duplicate lines", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    await fs.writeFile(srcFile, NODE_MODULES_ENV);
    await fs.writeFile(destFile, NODE_MODULES_ENV);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext()
    );

    expect(result.action).toBe("skipped");
  });

  it("ignores empty lines in source", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    await fs.writeFile(srcFile, "node_modules\n\n\n.env\n");
    await fs.writeFile(destFile, NODE_MODULES_ENV);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext()
    );

    expect(result.action).toBe("skipped");
  });

  it("handles lines with different endings", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    await fs.writeFile(srcFile, NODE_MODULES);
    await fs.writeFile(destFile, "node_modules\r\n"); // Windows ending

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext()
    );

    // Should skip because the line content is the same after trimming
    expect(result.action).toBe("skipped");
  });

  it("backs up file before appending", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    await fs.writeFile(srcFile, NODE_MODULES_ENV);
    await fs.writeFile(destFile, NODE_MODULES);

    let backupCalled = false;
    const context = {
      ...createContext(),
      backupFile: async () => {
        backupCalled = true;
      },
    };

    await strategy.apply(srcFile, destFile, GITIGNORE, context);

    expect(backupCalled).toBe(true);
  });

  it("does not modify files in dry run mode", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    await fs.writeFile(srcFile, NODE_MODULES_ENV);
    await fs.writeFile(destFile, NODE_MODULES);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext({ dryRun: true })
    );

    expect(result.action).toBe("appended");
    expect(result.linesAdded).toBe(1);
    expect(await fs.readFile(destFile, "utf-8")).toBe(NODE_MODULES);
  });

  it("adds newline before appending if destination does not end with newline", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    await fs.writeFile(srcFile, ".env\n");
    await fs.writeFile(destFile, "node_modules"); // No trailing newline

    await strategy.apply(srcFile, destFile, GITIGNORE, createContext());

    const content = await fs.readFile(destFile, "utf-8");
    expect(content).toBe("node_modules\n.env\n");
  });
});
