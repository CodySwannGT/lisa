/**
 * Scoped refresh behavior for block-managed copy-contents files.
 *
 * A dirty checkout requires `--skip-git-check`, but that waiver must not erase
 * the operator's separate decision to refresh one named managed template.
 * @module tests/unit/strategies/copy-contents-refresh-templates
 */
import * as fs from "fs-extra";
import * as path from "node:path";

import type { LisaConfig } from "../../../src/core/config.js";
import { CopyContentsStrategy } from "../../../src/strategies/copy-contents.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const MANAGED_PATH = ".husky/pre-push";
const BEGIN_MARKER = "# BEGIN: AI GUARDRAILS";
const END_MARKER = "# END: AI GUARDRAILS";
const SOURCE_CONTENT = `${BEGIN_MARKER}\ncurrent-hook\n${END_MARKER}\n`;

describe("CopyContentsStrategy scoped template refresh", () => {
  let strategy: CopyContentsStrategy;
  let tempDir: string;
  let srcFile: string;
  let destFile: string;

  beforeEach(async () => {
    strategy = new CopyContentsStrategy();
    tempDir = await createTempDir();
    srcFile = path.join(tempDir, "src", MANAGED_PATH);
    destFile = path.join(tempDir, "dest", MANAGED_PATH);
    await fs.outputFile(srcFile, SOURCE_CONTENT);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build the dirty-worktree strategy context used by the CLI apply path.
   * @param refreshPaths - Repo-relative paths explicitly approved for refresh
   * @param backupFile - Backup observer for the case
   * @returns Strategy context for the case
   */
  function createContext(
    refreshPaths: readonly string[],
    backupFile: StrategyContext["backupFile"] = async () => {}
  ): StrategyContext {
    const config: LisaConfig = {
      lisaDir: path.join(tempDir, "src"),
      destDir: path.join(tempDir, "dest"),
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: true,
      refreshTemplates: { mode: "paths", paths: refreshPaths },
      harness: "claude",
    };
    return {
      config,
      backupFile,
      promptOverwrite: async () => true,
    };
  }

  it("honors a matching scope, backs up once, and is idempotent", async () => {
    const destination = `host-hook\n${BEGIN_MARKER}\nold-hook\n${END_MARKER}\n`;
    await fs.outputFile(destFile, destination);
    let backupCount = 0;
    const context = createContext([MANAGED_PATH], async () => {
      backupCount += 1;
    });

    const first = await strategy.apply(
      srcFile,
      destFile,
      MANAGED_PATH,
      context
    );
    const second = await strategy.apply(
      srcFile,
      destFile,
      MANAGED_PATH,
      context
    );

    expect(first.action).toBe("merged");
    expect(second.action).toBe("skipped");
    expect(backupCount).toBe(1);
    expect(await fs.readFile(destFile, "utf-8")).toBe(
      `host-hook\n${SOURCE_CONTENT}`
    );
  });

  it("leaves the file stale when the scoped refresh does not match", async () => {
    const destination = `${BEGIN_MARKER}\nold-hook\n${END_MARKER}\n`;
    await fs.outputFile(destFile, destination);
    let backupCalled = false;

    const result = await strategy.apply(
      srcFile,
      destFile,
      MANAGED_PATH,
      createContext(["scripts/another-file.mjs"], async () => {
        backupCalled = true;
      })
    );

    expect(result.action).toBe("stale");
    expect(backupCalled).toBe(false);
    expect(await fs.readFile(destFile, "utf-8")).toBe(destination);
  });
});
