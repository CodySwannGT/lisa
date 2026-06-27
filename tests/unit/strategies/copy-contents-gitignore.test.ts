import * as fs from "fs-extra";
import * as path from "node:path";
import { CopyContentsStrategy } from "../../../src/strategies/copy-contents.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

const GITIGNORE = ".gitignore";
const DOTLESS = "gitignore";
const BEGIN_MARKER = "# BEGIN: AI GUARDRAILS";
const END_MARKER = "# END: AI GUARDRAILS";

describe("CopyContentsStrategy — dotless gitignore shipping", () => {
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
   * Create a strategy context for testing.
   * @returns Strategy context with test defaults
   */
  function createContext(): StrategyContext {
    const config: LisaConfig = {
      lisaDir: srcDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
    };
    return {
      config,
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };
  }

  it("restores a dotless `gitignore` template to `.gitignore` at the destination", async () => {
    // npm strips .gitignore from published tarballs, so templates ship as
    // `gitignore` (no dot). The core passes that dotless name through; the
    // strategy must write the real dotfile so downstream projects get it.
    const srcFile = path.join(srcDir, DOTLESS);
    const destFile = path.join(destDir, DOTLESS);
    const sourceContent = `${BEGIN_MARKER}\nnode_modules\n${END_MARKER}\n`;
    await fs.writeFile(srcFile, sourceContent);

    const result = await strategy.apply(
      srcFile,
      destFile,
      DOTLESS,
      createContext()
    );

    expect(result.action).toBe("copied");
    expect(result.relativePath).toBe(GITIGNORE);
    expect(await fs.pathExists(path.join(destDir, GITIGNORE))).toBe(true);
    expect(await fs.pathExists(destFile)).toBe(false);
    expect(await fs.readFile(path.join(destDir, GITIGNORE), "utf-8")).toBe(
      sourceContent
    );
  });

  it("merges a dotless `gitignore` template into an existing `.gitignore`", async () => {
    const srcFile = path.join(srcDir, DOTLESS);
    const destFile = path.join(destDir, DOTLESS);
    const destGitignore = path.join(destDir, GITIGNORE);
    await fs.writeFile(
      srcFile,
      `${BEGIN_MARKER}\nnode_modules\n${END_MARKER}\n`
    );
    await fs.writeFile(destGitignore, "custom-entry\n");

    const result = await strategy.apply(
      srcFile,
      destFile,
      DOTLESS,
      createContext()
    );

    expect(result.action).toBe("merged");
    const merged = await fs.readFile(destGitignore, "utf-8");
    expect(merged).toContain("custom-entry");
    expect(merged).toContain("node_modules");
  });
});
