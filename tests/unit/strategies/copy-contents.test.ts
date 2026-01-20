import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs-extra";
import * as path from "node:path";
import { CopyContentsStrategy } from "../../../src/strategies/copy-contents.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

const GITIGNORE = ".gitignore";
const BEGIN_MARKER = "# BEGIN: AI GUARDRAILS";
const END_MARKER = "# END: AI GUARDRAILS";

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
    const sourceContent = `${BEGIN_MARKER}\nnode_modules\n.env\n${END_MARKER}\n`;
    await fs.writeFile(srcFile, sourceContent);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext()
    );

    expect(result.action).toBe("copied");
    expect(await fs.pathExists(destFile)).toBe(true);
    expect(await fs.readFile(destFile, "utf-8")).toBe(sourceContent);
  });

  it("skips when files are identical", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    const content = "node_modules\n";
    await fs.writeFile(srcFile, content);
    await fs.writeFile(destFile, content);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext()
    );

    expect(result.action).toBe("skipped");
  });

  it("replaces block when markers exist in destination", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    const sourceContent = `${BEGIN_MARKER}\ndist\ncoverage\n${END_MARKER}`;
    const destContent = `# My custom entries\nmy-dir\n${BEGIN_MARKER}\nold-entry\n${END_MARKER}\n# End\n`;

    await fs.writeFile(srcFile, sourceContent);
    await fs.writeFile(destFile, destContent);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext()
    );

    expect(result.action).toBe("merged");

    const content = await fs.readFile(destFile, "utf-8");
    expect(content).toContain("# My custom entries");
    expect(content).toContain("my-dir");
    expect(content).toContain("# End");
    expect(content).toContain("dist");
    expect(content).toContain("coverage");
    expect(content).not.toContain("old-entry");
  });

  it("appends when markers do not exist in destination", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    const sourceContent = `${BEGIN_MARKER}\nnode_modules\ndist\n${END_MARKER}`;
    const destContent = "# My custom entries\nmy-dir\n";

    await fs.writeFile(srcFile, sourceContent);
    await fs.writeFile(destFile, destContent);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext()
    );

    expect(result.action).toBe("merged");

    const content = await fs.readFile(destFile, "utf-8");
    expect(content).toContain("# My custom entries");
    expect(content).toContain("my-dir");
    expect(content).toContain(sourceContent);
  });

  it("adds double newline when appending to file without trailing newline", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    const sourceContent = `${BEGIN_MARKER}\ndist\n${END_MARKER}`;
    await fs.writeFile(srcFile, sourceContent);
    await fs.writeFile(destFile, "my-dir"); // No trailing newline

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext()
    );

    expect(result.action).toBe("merged");

    const content = await fs.readFile(destFile, "utf-8");
    // When appending without trailing newline, add \n\n for visual separation
    expect(content).toBe(`my-dir\n\n${sourceContent}`);
  });

  it("adds double newline when appending to file with trailing newline", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    const sourceContent = `${BEGIN_MARKER}\ndist\n${END_MARKER}`;
    await fs.writeFile(srcFile, sourceContent);
    await fs.writeFile(destFile, "my-dir\n"); // With trailing newline

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext()
    );

    expect(result.action).toBe("merged");

    const content = await fs.readFile(destFile, "utf-8");
    expect(content).toBe(`my-dir\n\n${sourceContent}`);
  });

  it("backs up file before merging", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    const sourceContent = `${BEGIN_MARKER}\ndist\n${END_MARKER}`;
    const destContent = `${BEGIN_MARKER}\nold\n${END_MARKER}`;

    await fs.writeFile(srcFile, sourceContent);
    await fs.writeFile(destFile, destContent);

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
    const sourceContent = `${BEGIN_MARKER}\ndist\n${END_MARKER}`;
    const destContent = `${BEGIN_MARKER}\nold\n${END_MARKER}`;

    await fs.writeFile(srcFile, sourceContent);
    await fs.writeFile(destFile, destContent);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext({ dryRun: true })
    );

    expect(result.action).toBe("merged");
    expect(await fs.readFile(destFile, "utf-8")).toBe(destContent);
  });

  it("skips when merged content is identical to destination", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    const content = `${BEGIN_MARKER}\nnode_modules\n${END_MARKER}`;

    await fs.writeFile(srcFile, content);
    await fs.writeFile(destFile, content);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext()
    );

    expect(result.action).toBe("skipped");
  });

  it("handles only begin marker without end marker", async () => {
    const srcFile = path.join(srcDir, GITIGNORE);
    const destFile = path.join(destDir, GITIGNORE);
    const sourceContent = `${BEGIN_MARKER}\ndist\n${END_MARKER}`;
    const destContent = `${BEGIN_MARKER}\nold-content\n`;

    await fs.writeFile(srcFile, sourceContent);
    await fs.writeFile(destFile, destContent);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GITIGNORE,
      createContext()
    );

    // Markers incomplete, should append
    expect(result.action).toBe("merged");

    const content = await fs.readFile(destFile, "utf-8");
    expect(content).toContain(destContent);
    expect(content).toContain(sourceContent);
  });
});
