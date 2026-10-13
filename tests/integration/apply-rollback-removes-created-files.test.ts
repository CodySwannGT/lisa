/**
 * A failed `lisa apply` must leave the host tree exactly as it found it
 * (CodySwannGT/lisa#4459).
 *
 * Observed applying Lisa 4.80.2 to a caller repo: a strategy refused partway
 * through, the apply rolled back, and the rollback restored every file it had
 * MODIFIED but left behind every file it had CREATED — 126 untracked files,
 * plus the `.lisabak/<timestamp>/` copies of the files it had just restored.
 * The next apply or commit then tripped over that debris.
 *
 * These cases drive the real orchestrator, `Lisa.apply()`, against a real git
 * fixture and judge the outcome with `git status` — the observation an
 * operator makes — rather than asserting on the backup service alone.
 *
 * The failure is induced on the real path: a `merge` template whose host
 * destination is unparseable JSON makes the merge strategy throw
 * `JsonMergeError`. `merge` runs after `copy-overwrite`, `copy-contents` and
 * `create-only` (COPY_STRATEGIES order), so by the time it throws the apply
 * has already created new files, created new nested directories, and modified
 * a tracked file.
 * @module tests/integration/apply-rollback-removes-created-files
 */
import * as fs from "fs-extra";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LisaConfig } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import { BackupService } from "../../src/transaction/index.js";
import { createTempDir, cleanupTempDir } from "../helpers/test-utils.js";
import { AutoAcceptPrompter } from "../../src/cli/prompts.js";
import { cleanGitEnv, GIT_BIN } from "../support/git-executable.js";

/** Tracked host file the copy-contents template modifies before the failure. */
const MODIFIED_TRACKED = ".gitignore";

/** Host bytes of the modified file, asserted byte-identical after rollback. */
const ORIGINAL_GITIGNORE = "node_modules\n";

/** Host file whose unparseable JSON makes the merge strategy throw. */
const BROKEN_MERGE_TARGET = "broken.json";

/** Paths the apply creates before failing — none may survive rollback. */
const CREATED_BY_APPLY = [
  "fresh-overwrite.txt",
  "created/nested/deeper/overwrite.txt",
  "seeded/create-only.md",
];

/**
 * Run git in the fixture and return stdout.
 * @param cwd - Fixture repository
 * @param args - Git arguments
 * @returns Trimmed stdout
 */
function git(cwd: string, ...args: readonly string[]): string {
  return execFileSync(GIT_BIN, [...args], {
    cwd,
    encoding: "utf8",
    // Every test child carries a deadline (#2940); a local git call needs
    // well under a second, so this only ever fires on a wedged process.
    timeout: 30_000,
    env: {
      ...cleanGitEnv(),
      GIT_AUTHOR_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    },
  }).trim();
}

/**
 * Write a file, creating parents.
 * @param file - Absolute path
 * @param content - File content
 */
async function put(file: string, content: string): Promise<void> {
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, content);
}

describe("a failed lisa apply rolls the host tree back completely (#4459)", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");

    await put(
      path.join(lisaDir, "all/copy-overwrite/fresh-overwrite.txt"),
      "a\n"
    );
    await put(
      path.join(
        lisaDir,
        "all/copy-overwrite/created/nested/deeper/overwrite.txt"
      ),
      "b\n"
    );
    await put(
      path.join(lisaDir, "all/copy-contents", MODIFIED_TRACKED),
      "# BEGIN: AI GUARDRAILS\ndist\n# END: AI GUARDRAILS\n"
    );
    await put(
      path.join(lisaDir, "all/create-only/seeded/create-only.md"),
      "c\n"
    );
    await put(
      path.join(lisaDir, "all/merge", BROKEN_MERGE_TARGET),
      `${JSON.stringify({ lisa: true })}\n`
    );

    await put(path.join(destDir, MODIFIED_TRACKED), ORIGINAL_GITIGNORE);
    await put(path.join(destDir, BROKEN_MERGE_TARGET), "{ not json");
    await put(
      path.join(destDir, "package.json"),
      `${JSON.stringify({ name: "fixture-host", version: "1.0.0" }, undefined, 2)}\n`
    );
    git(destDir, "init", "-q");
    git(destDir, "add", "-A");
    git(destDir, "commit", "-q", "-m", "fixture");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Run the real apply against the fixture.
   * @returns Whether the apply reported success
   */
  async function runApply(): Promise<boolean> {
    const config: LisaConfig = {
      lisaDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
    };
    const logger = new SilentLogger();
    const deps: LisaDependencies = {
      logger,
      prompter: new AutoAcceptPrompter(),
      backupService: new BackupService(logger),
      detectorRegistry: new DetectorRegistry(),
      strategyRegistry: new StrategyRegistry(),
      gitService: new NoOpGitService(),
      migrationRegistry: new MigrationRegistry(),
    };
    const result = await new Lisa(config, deps).apply();
    return result.success;
  }

  it("leaves git status clean and tracked bytes unchanged", async () => {
    expect(await runApply()).toBe(false);

    expect(git(destDir, "status", "--porcelain", "--untracked-files=all")).toBe(
      ""
    );
    expect(
      await fs.readFile(path.join(destDir, MODIFIED_TRACKED), "utf8")
    ).toBe(ORIGINAL_GITIGNORE);
    for (const created of CREATED_BY_APPLY) {
      expect(await fs.pathExists(path.join(destDir, created))).toBe(false);
    }
    expect(await fs.pathExists(path.join(destDir, "created"))).toBe(false);
    expect(await fs.pathExists(path.join(destDir, ".lisabak"))).toBe(false);
  });

  it("positive control: the apply did create and modify files before failing", async () => {
    // Without this, the clean status above could mean the apply failed before
    // writing anything — a green that proves nothing about rollback. Swapping
    // the broken target for valid JSON lets the same apply run to completion,
    // and the same paths must then exist.
    await put(path.join(destDir, BROKEN_MERGE_TARGET), "{}\n");
    git(destDir, "commit", "-q", "-am", "valid");

    expect(await runApply()).toBe(true);

    for (const created of CREATED_BY_APPLY) {
      expect(await fs.pathExists(path.join(destDir, created))).toBe(true);
    }
    expect(
      await fs.readFile(path.join(destDir, MODIFIED_TRACKED), "utf8")
    ).not.toBe(ORIGINAL_GITIGNORE);
  });

  it("keeps an untracked file that existed before the apply", async () => {
    const preExisting = path.join(destDir, "created", "mine.txt");
    await put(preExisting, "host-owned\n");

    expect(await runApply()).toBe(false);

    expect(await fs.readFile(preExisting, "utf8")).toBe("host-owned\n");
    expect(git(destDir, "status", "--porcelain", "--untracked-files=all")).toBe(
      "?? created/mine.txt"
    );
  });
});
