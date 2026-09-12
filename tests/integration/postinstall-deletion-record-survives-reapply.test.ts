/**
 * The reproduction from CodySwannGT/lisa#4071, as a test.
 *
 * A plain `bun install` in a consumer worktree removes tracked files, silently.
 * The removals themselves can be entirely legitimate — Lisa retires artifacts it
 * once shipped, and two of the current forced removals are owner rulings against
 * workflows that were actively harmful. What was wrong is that every channel the
 * install-time apply speaks on is closed by the time it speaks: package managers
 * hide postinstall stdout, and the reconciliation trampoline that same install
 * schedules is spawned detached with `stdio: "ignore"` (#3505).
 *
 * #3656 answered that by recording the removals in the apply receipt, which is a
 * file and therefore survives. This is the hole left in that answer, measured in
 * a scratch fixture before it was closed:
 *
 * 1. the postinstall apply removes the file and records it — `deleted_paths`
 *    names it;
 * 2. the trampoline re-applies, finds the file already gone, deletes nothing,
 *    and writes its receipt over the first — `deleted_paths` becomes `[]`;
 * 3. git still shows the file deleted, and no surface anywhere names it.
 *
 * The only durable record of a removal was erased by the one process least able
 * to report doing so. So the record is what these cases pin: it must survive the
 * re-apply, it must carry WHY, and something an operator runs must read it back.
 *
 * Driven through the real orchestrator with the postinstall's own flags, against
 * a real git fixture, because the claim is about what a completed install leaves
 * behind rather than about any one function.
 * @module tests/integration/postinstall-deletion-record-survives-reapply
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkApplyDeletions } from "../../src/cli/doctor-apply-deletions.js";
import {
  readApplyReceipt,
  recordSuccessfulApply,
} from "../../src/core/apply-receipt.js";
import type { LisaConfig, LisaResult } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { AutoAcceptPrompter } from "../../src/cli/prompts.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import { BackupService } from "../../src/transaction/index.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { cleanGitEnv, GIT_BIN } from "../support/git-executable.js";
import { createTempDir, cleanupTempDir } from "../helpers/test-utils.js";

/** The tracked file the fixture's manifest retires. */
const RETIRED = path.posix.join(".github", "workflows", "retired-check.yml");

/** The ruling the fixture's manifest cites for removing it. */
const RULING =
  "Retired fleet-wide by a recorded ruling; an edited copy is no safer.";

/** A path the fixture declares with no basis at all, to pin the fail-closed arm. */
const UNCLASSIFIED = path.posix.join(
  ".github",
  "workflows",
  "host-authored.yml"
);

describe("a consumer install that removes a tracked file (#4071)", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");

    // A minimal packaged tree: nothing but the deletions manifest, so the case
    // measures the deletion decision rather than a stack's whole template set.
    await fs.outputJson(path.join(lisaDir, "all", "deletions.json"), {
      paths: [RETIRED, UNCLASSIFIED],
      force: { [RETIRED]: RULING },
    });

    await fs.outputFile(
      path.join(destDir, RETIRED),
      "name: retired-check\non: workflow_dispatch\n"
    );
    await fs.outputFile(
      path.join(destDir, UNCLASSIFIED),
      "name: host-authored\non: workflow_dispatch\n"
    );
    await fs.writeJson(path.join(destDir, "package.json"), {
      name: "placeholder-host",
      version: "1.0.0",
    });

    initFixtureRepo();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Run a fixture git command with a budget and an uncontaminated environment.
   * @param args - Arguments after the executable
   * @returns The command's stdout, trimmed
   */
  function git(...args: readonly string[]): string {
    return boundedSpawnSync({
      command: GIT_BIN,
      args,
      cwd: destDir,
      env: cleanGitEnv(),
      label: `git ${args[0] ?? ""}`,
    }).stdout.trim();
  }

  /** Commit the fixture so a removal is visible as a change to tracked state. */
  function initFixtureRepo(): void {
    git("init", "--quiet", "--initial-branch", "main");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    git("add", "--all");
    git("commit", "--quiet", "--no-verify", "--message", "fixture");
  }

  /**
   * Run the apply exactly as an install does, then record the receipt exactly as
   * `cli/apply.ts` does on a completed apply.
   * @returns The apply result
   */
  async function installApply(): Promise<LisaResult> {
    const config: LisaConfig = {
      lisaDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: true,
      postinstall: true,
      harness: "claude",
    };
    const deps: LisaDependencies = {
      logger: new SilentLogger(),
      prompter: new AutoAcceptPrompter(),
      backupService: new BackupService(new SilentLogger()),
      detectorRegistry: new DetectorRegistry(),
      strategyRegistry: new StrategyRegistry(),
      gitService: new NoOpGitService(),
      migrationRegistry: new MigrationRegistry(),
    };
    const result = await new Lisa(config, deps).apply();
    await recordSuccessfulApply(destDir, {
      lisaVersion: "0.0.0-fixture",
      harness: "claude",
      applyMode: "postinstall-safe",
      stalePaths: result.stalePaths,
      deletedPaths: result.deletedPaths,
      deletionNotices: result.deletionNotices,
    });
    return result;
  }

  it("keeps naming the removed file after the reconciling re-apply", async () => {
    await installApply();

    // Step one: the file is gone, and git agrees it was a TRACKED file that went.
    expect(await fs.pathExists(path.join(destDir, RETIRED))).toBe(false);
    expect(
      git("diff", "--name-only", "--diff-filter=D", "HEAD", "--", RETIRED)
    ).toBe(RETIRED);

    const afterInstall = await readApplyReceipt(destDir);
    expect(afterInstall?.deleted_paths).toContain(RETIRED);

    // Step two: the trampoline's re-apply. Idempotent by construction — the file
    // it would remove is already gone — so it reports zero deletions and used to
    // write that emptiness over the only record of the removal.
    const reapply = await installApply();
    expect(reapply.deletedPaths).toHaveLength(0);

    const afterReapply = await readApplyReceipt(destDir);
    expect(afterReapply?.deleted_paths).toContain(RETIRED);
    expect(afterReapply?.deletions_recorded_at).toBe(
      afterInstall?.deletions_recorded_at
    );

    // Step three: the file really is still missing, so the carried-forward
    // record describes the present rather than over-reporting a repaired repo.
    expect(await fs.pathExists(path.join(destDir, RETIRED))).toBe(false);
  });

  it("records why the file went, not only that it went", async () => {
    await installApply();
    const receipt = await readApplyReceipt(destDir);
    expect(receipt?.deletion_notices.join("\n")).toContain(RULING);
  });

  it("reports the removal on a surface an operator runs", async () => {
    await installApply();
    await installApply();

    const check = await checkApplyDeletions(destDir);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain(RETIRED);
    expect(check.detail).toContain(RULING);
  });

  it("leaves a declared path alone when the manifest does not say why", async () => {
    await installApply();

    // The fail-closed arm, on the same run as the forced removal, so the case
    // cannot pass by refusing everything. Uncertainty keeps the file AND says so.
    expect(await fs.pathExists(path.join(destDir, UNCLASSIFIED))).toBe(true);
    expect(git("status", "--porcelain", "--", UNCLASSIFIED)).toBe("");

    const receipt = await readApplyReceipt(destDir);
    expect(receipt?.deletion_notices.join("\n")).toContain(UNCLASSIFIED);
  });
});
