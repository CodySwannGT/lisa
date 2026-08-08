import * as fs from "fs-extra";
import * as path from "node:path";
import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

const TEST_FILE = "TEST_FILE";
const NEW_CONTENT = "new content";
const OLD_CONTENT = "old content";
const KNIP_JSON = "knip.json";
const TSCONFIG_JSON = "tsconfig.json";
const IDENTICAL_TXT = "identical.txt";
const CHANGED_TXT = "changed.txt";

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
      skipGitCheck: false,
      harness: "claude",
      ...overrides,
    };

    return {
      config,
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

  it("preserves host-owned config during skip-git-check applies", async () => {
    const srcFile = path.join(srcDir, KNIP_JSON);
    const destFile = path.join(destDir, KNIP_JSON);
    await fs.writeJson(srcFile, { ignoreDependencies: ["from-lisa"] });
    await fs.writeJson(destFile, { ignoreDependencies: ["shell-quote"] });

    const result = await strategy.apply(
      srcFile,
      destFile,
      KNIP_JSON,
      createContext({ skipGitCheck: true })
    );

    // Preserved, as before — but reported as `stale`, not `skipped`. The file
    // is out of date with the packaged template and the operator has to be
    // able to see that.
    expect(result.action).toBe("stale");
    expect(await fs.readJson(destFile)).toEqual({
      ignoreDependencies: ["shell-quote"],
    });
  });

  it("preserves any existing host file during skip-git-check applies", async () => {
    const srcFile = path.join(srcDir, TSCONFIG_JSON);
    const destFile = path.join(destDir, TSCONFIG_JSON);
    await fs.writeJson(srcFile, { extends: "./tsconfig.base.json" });
    await fs.writeJson(destFile, {});

    const result = await strategy.apply(
      srcFile,
      destFile,
      TSCONFIG_JSON,
      createContext({ skipGitCheck: true })
    );

    expect(result.action).toBe("stale");
    expect(await fs.readJson(destFile)).toEqual({});
  });

  it("distinguishes an out-of-date file from an identical one", async () => {
    // The regression this exists to stop. Both cases leave the file untouched,
    // so folding them into one `skipped` count made an undelivered template
    // change indistinguishable from a clean no-op. A guard fix could ship in a
    // release and reach nobody, with nothing in the summary to say so.
    const identicalSrc = path.join(srcDir, IDENTICAL_TXT);
    const identicalDest = path.join(destDir, IDENTICAL_TXT);
    await fs.writeFile(identicalSrc, NEW_CONTENT);
    await fs.writeFile(identicalDest, NEW_CONTENT);

    const changedSrc = path.join(srcDir, CHANGED_TXT);
    const changedDest = path.join(destDir, CHANGED_TXT);
    await fs.writeFile(changedSrc, NEW_CONTENT);
    await fs.writeFile(changedDest, OLD_CONTENT);

    const context = createContext({ skipGitCheck: true });

    expect(
      (
        await strategy.apply(
          identicalSrc,
          identicalDest,
          IDENTICAL_TXT,
          context
        )
      ).action
    ).toBe("skipped");
    expect(
      (await strategy.apply(changedSrc, changedDest, CHANGED_TXT, context))
        .action
    ).toBe("stale");
  });

  it("reports an out-of-date enforcement guard rather than swallowing it", async () => {
    // The concrete case: a released fix to a PreToolUse guard reaching a
    // project that already has the old one. It is still not overwritten
    // without a prompt, but it can no longer be invisible.
    const rel = "scripts/lisa-hooks/block-no-verify.sh";
    const srcFile = path.join(srcDir, rel);
    const destFile = path.join(destDir, rel);
    await fs.ensureDir(path.dirname(srcFile));
    await fs.ensureDir(path.dirname(destFile));
    await fs.writeFile(srcFile, "#!/usr/bin/env bash\n# fixed\n");
    await fs.writeFile(destFile, "#!/usr/bin/env bash\n# vulnerable\n");

    const result = await strategy.apply(
      srcFile,
      destFile,
      rel,
      createContext({ skipGitCheck: true })
    );

    expect(result.action).toBe("stale");
    expect(result.relativePath).toBe(rel);
    expect(await fs.readFile(destFile, "utf-8")).toContain("vulnerable");
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
