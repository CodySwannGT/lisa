import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs-extra";
import * as path from "node:path";
import { CreateOnlyStrategy } from "../../../src/strategies/create-only.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

describe("CreateOnlyStrategy", () => {
  let strategy: CreateOnlyStrategy;
  let tempDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(async () => {
    strategy = new CreateOnlyStrategy();
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
   *
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
    expect(strategy.name).toBe("create-only");
  });

  it("creates file when destination does not exist", async () => {
    const srcFile = path.join(srcDir, "README.md");
    const destFile = path.join(destDir, "README.md");
    await fs.writeFile(srcFile, "# My Project\n");

    const result = await strategy.apply(
      srcFile,
      destFile,
      "README.md",
      createContext()
    );

    expect(result.action).toBe("created");
    expect(await fs.pathExists(destFile)).toBe(true);
    expect(await fs.readFile(destFile, "utf-8")).toBe("# My Project\n");
  });

  it("skips when file exists (identical content)", async () => {
    const srcFile = path.join(srcDir, "README.md");
    const destFile = path.join(destDir, "README.md");
    await fs.writeFile(srcFile, "# Default\n");
    await fs.writeFile(destFile, "# Default\n");

    const result = await strategy.apply(
      srcFile,
      destFile,
      "README.md",
      createContext()
    );

    expect(result.action).toBe("skipped");
  });

  it("skips when file exists (different content)", async () => {
    const srcFile = path.join(srcDir, "README.md");
    const destFile = path.join(destDir, "README.md");
    await fs.writeFile(srcFile, "# Default\n");
    await fs.writeFile(destFile, "# Custom Content\n");

    const result = await strategy.apply(
      srcFile,
      destFile,
      "README.md",
      createContext()
    );

    expect(result.action).toBe("skipped");
    // Original content should be preserved
    expect(await fs.readFile(destFile, "utf-8")).toBe("# Custom Content\n");
  });

  it("records file in manifest when creating", async () => {
    const srcFile = path.join(srcDir, "README.md");
    const destFile = path.join(destDir, "README.md");
    await fs.writeFile(srcFile, "# Test\n");

    let recorded: { path: string; strategy: string } | null = null;
    const context = {
      ...createContext(),
      recordFile: (relativePath: string, strat: string) => {
        recorded = { path: relativePath, strategy: strat };
      },
    };

    await strategy.apply(srcFile, destFile, "README.md", context);

    expect(recorded).toEqual({ path: "README.md", strategy: "create-only" });
  });

  it("does not record file in manifest when skipping", async () => {
    const srcFile = path.join(srcDir, "README.md");
    const destFile = path.join(destDir, "README.md");
    await fs.writeFile(srcFile, "# Default\n");
    await fs.writeFile(destFile, "# Custom\n");

    let recorded = false;
    const context = {
      ...createContext(),
      recordFile: () => {
        recorded = true;
      },
    };

    await strategy.apply(srcFile, destFile, "README.md", context);

    expect(recorded).toBe(false);
  });

  it("creates parent directories when needed", async () => {
    const srcFile = path.join(srcDir, "docs", "README.md");
    const destFile = path.join(destDir, "docs", "README.md");
    await fs.ensureDir(path.dirname(srcFile));
    await fs.writeFile(srcFile, "# Docs\n");

    await strategy.apply(srcFile, destFile, "docs/README.md", createContext());

    expect(await fs.pathExists(destFile)).toBe(true);
  });

  it("does not modify files in dry run mode", async () => {
    const srcFile = path.join(srcDir, "README.md");
    const destFile = path.join(destDir, "README.md");
    await fs.writeFile(srcFile, "# Test\n");

    const result = await strategy.apply(
      srcFile,
      destFile,
      "README.md",
      createContext({ dryRun: true })
    );

    expect(result.action).toBe("created");
    expect(await fs.pathExists(destFile)).toBe(false);
  });
});
