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
    expect(result.relativePath).toBe(GITIGNORE);
    expect(await fs.pathExists(destFile)).toBe(false);
    const merged = await fs.readFile(destGitignore, "utf-8");
    expect(merged).toContain("custom-entry");
    expect(merged).toContain("node_modules");
  });
});

describe("all/copy-contents/gitignore shipped content", () => {
  const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
  const readShared = (): string =>
    fs.readFileSync(
      path.join(REPO_ROOT, "all/copy-contents/gitignore"),
      "utf-8"
    );

  it("orders the broad tasks.json ignore before the re-include (last-match-wins)", () => {
    // gitignore is last-match-wins: a broad `tasks.json` after `!tasks/tasks.json`
    // would re-ignore the tracked file. The broad rule must come first. Compare
    // the actual rule lines (comments may mention either token).
    const rules = readShared()
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("#"));
    const broad = rules.indexOf("tasks.json");
    const reinclude = rules.indexOf("!tasks/tasks.json");
    expect(broad).toBeGreaterThan(-1);
    expect(reinclude).toBeGreaterThan(-1);
    expect(broad).toBeLessThan(reinclude);
  });

  it("ignores the NestJS boot-check scratch dir", () => {
    // .build-boot/ is written by the NestJS pre-push AppModule boot check and
    // must not be caught by `git add -A`.
    expect(readShared()).toContain(".build-boot/");
  });
});
