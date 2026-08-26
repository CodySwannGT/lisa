/**
 * The reproduction from CodySwannGT/lisa#3033, as a test.
 *
 * A consumer repository bumped `3.46.3 → 3.70.0`. Its fork-drift guard went
 * green → red on three `copy-overwrite` assets that nobody had edited —
 * upstream moved and the repository did not. `.lisa/apply-receipt.json`
 * recorded `apply_mode: "postinstall-safe"`.
 *
 * The reduced mode is CORRECT and these tests defend it. postinstall runs
 * unattended, and replacing a hand-edited root config with nobody to ask is
 * #3026 — where `createPrompter()` read the absence of a terminal as consent.
 * Nothing here widens what postinstall overwrites; the byte-for-byte assertion
 * below fails if anything ever does.
 *
 * What was wrong is that the finding did not survive the install. The apply
 * names the stale files once, into `bun install` scroll-back, and then nothing
 * in the repository records it. So these tests pin the two halves that make it
 * durable and actionable: the run REPORTS which files it left behind, and the
 * remedy it prints is the flag the unattended path actually honours, scoped one
 * path at a time — the bare `--refresh-templates` is repo-wide and would revert
 * every deliberate fork in a single command.
 *
 * Driven through the real orchestrator with the postinstall's own flags
 * (`--yes --skip-git-check`), because the defect is about what a completed
 * apply hands back and says, not about any one strategy in isolation.
 * @module tests/integration/postinstall-safe-reports-stale-root-configs
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LisaConfig, LisaResult } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import type { ILogger } from "../../src/logging/logger.interface.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { AutoAcceptPrompter } from "../../src/cli/prompts.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import { BackupService } from "../../src/transaction/index.js";
import { createTempDir, cleanupTempDir } from "../helpers/test-utils.js";

/** A managed root config the fleet legitimately customises. */
const MANAGED = "knip.json";

/** Where the TypeScript stack authors it. */
const MANAGED_SOURCE = path.join("typescript", "copy-overwrite", MANAGED);

/** A block-managed hook that follows the copy-contents path. */
const MANAGED_HOOK = path.join(".husky", "pre-push");

/** Where the TypeScript stack authors that hook. */
const MANAGED_HOOK_SOURCE = path.join(
  "typescript",
  "copy-contents",
  MANAGED_HOOK
);

const BEGIN_MARKER = "# BEGIN: AI GUARDRAILS";
const END_MARKER = "# END: AI GUARDRAILS";
const PACKAGED_HOOK = `${BEGIN_MARKER}\ncurrent-hook\n${END_MARKER}\n`;
const HOST_HOOK = `host-hook\n${BEGIN_MARKER}\nold-hook\n${END_MARKER}\n`;

/** The host's edit, and the only place this text appears. */
const HOST_MARKER = "host-owned-package";

/** Records every line the apply printed, so the remedy can be asserted on. */
class RecordingLogger implements ILogger {
  readonly lines: string[] = [];

  /**
   * Record an informational line.
   * @param message - Line to record
   */
  info(message: string): void {
    this.lines.push(message);
  }

  /**
   * Record a success line.
   * @param message - Line to record
   */
  success(message: string): void {
    this.lines.push(message);
  }

  /**
   * Record a warning line.
   * @param message - Line to record
   */
  warn(message: string): void {
    this.lines.push(message);
  }

  /**
   * Record an error line.
   * @param message - Line to record
   */
  error(message: string): void {
    this.lines.push(message);
  }

  /**
   * Record a dry-run line.
   * @param message - Line to record
   */
  dry(message: string): void {
    this.lines.push(message);
  }

  /**
   * Everything the apply printed, as one searchable string.
   * @returns Joined output
   */
  get output(): string {
    return this.lines.join("\n");
  }
}

describe("a postinstall-safe apply over a customised root config (#3033)", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;
  let hostCopy: string;
  let packagedCopy: string;
  let logger: RecordingLogger;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    logger = new RecordingLogger();

    hostCopy = `${JSON.stringify({ entry: ["src/index.ts"], ignoreDependencies: [HOST_MARKER] }, undefined, 2)}\n`;
    packagedCopy = `${JSON.stringify({ entry: ["src/**/*.ts"], ignoreDependencies: [] }, undefined, 2)}\n`;

    const packaged = path.join(lisaDir, MANAGED_SOURCE);
    await fs.ensureDir(path.dirname(packaged));
    await fs.writeFile(packaged, packagedCopy);

    const installed = path.join(destDir, MANAGED);
    await fs.ensureDir(destDir);
    await fs.writeFile(installed, hostCopy);
    await fs.outputFile(path.join(lisaDir, MANAGED_HOOK_SOURCE), PACKAGED_HOOK);
    await fs.outputFile(path.join(destDir, MANAGED_HOOK), HOST_HOOK);
    // Present so the TypeScript detector fires and the stack's tree applies.
    await fs.writeJson(path.join(destDir, "tsconfig.json"), {
      compilerOptions: { strict: true },
    });
    await fs.writeJson(path.join(destDir, "package.json"), {
      name: "placeholder-host",
      version: "1.0.0",
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Run the apply with the postinstall's exact flags: `--yes` and
   * `--skip-git-check`, which is what a package manager invokes.
   * @param overrides - Config fields a case varies
   * @returns The apply result
   */
  async function runPostinstallSafeApply(
    overrides: Partial<LisaConfig> = {}
  ): Promise<LisaResult> {
    const config: LisaConfig = {
      lisaDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: true,
      harness: "claude",
      ...overrides,
    };
    const deps: LisaDependencies = {
      logger,
      prompter: new AutoAcceptPrompter(),
      backupService: new BackupService(logger),
      detectorRegistry: new DetectorRegistry(),
      strategyRegistry: new StrategyRegistry(),
      gitService: new NoOpGitService(),
      migrationRegistry: new MigrationRegistry(),
    };
    return new Lisa(config, deps).apply();
  }

  /**
   * The managed file as it stands in the project after the apply.
   * @returns Contents of the installed file
   */
  async function installedContents(): Promise<string> {
    return fs.readFile(path.join(destDir, MANAGED), "utf8");
  }

  it("hands the caller the path it left out of date", async () => {
    // The count was already reported. A count is not something a caller can
    // record or an operator can act on, so nothing downstream — the receipt,
    // and through it `lisa doctor` — could name the file.
    const result = await runPostinstallSafeApply();

    expect(result.stalePaths).toContain(MANAGED);
  });

  it("does not overwrite it to achieve that", async () => {
    // The guard on the non-fix. Detecting staleness must never become licence
    // to replace a file nobody was asked about (#3026).
    await runPostinstallSafeApply();

    expect(await installedContents()).toBe(hostCopy);
    expect(await installedContents()).toContain(HOST_MARKER);
  });

  it("prints the flag the unattended path actually honours", async () => {
    // `--refresh-templates` is the only exit `applyNonInteractive` recognises,
    // and the output named `lisa apply .` interactively instead — a route no
    // agent, script, or CI run has, since none of them has a terminal.
    await runPostinstallSafeApply();

    expect(logger.output).toContain("--refresh-templates=<path>");
  });

  it("tells the operator to scope that flag one path at a time", async () => {
    await runPostinstallSafeApply();

    expect(logger.output).toContain("ONE AT A TIME");
    expect(logger.output).toContain("repo-wide");
  });

  it("says what being left out of date costs", async () => {
    await runPostinstallSafeApply();

    expect(logger.output).toContain("security fixes");
  });

  it("positive control: the same fixture IS refreshable when asked by name", async () => {
    // Without this, every assertion above could pass because the apply never
    // reached the file — a green that proves nothing. The scoped flag replaces
    // it, so the preservation above is a routing decision, not an inert setup.
    const result = await runPostinstallSafeApply({
      refreshTemplates: { mode: "paths", paths: [MANAGED] },
    });

    expect(await installedContents()).toBe(packagedCopy);
    expect(result.stalePaths).not.toContain(MANAGED);
  });

  it("refreshes a named copy-contents file under the dirty-worktree waiver", async () => {
    const result = await runPostinstallSafeApply({
      refreshTemplates: { mode: "paths", paths: [MANAGED_HOOK] },
    });

    expect(await fs.readFile(path.join(destDir, MANAGED_HOOK), "utf8")).toBe(
      `host-hook\n${PACKAGED_HOOK}`
    );
    expect(result.stalePaths).not.toContain(MANAGED_HOOK);
    expect(result.stalePaths).toContain(MANAGED);
  });

  it("reports no stale paths when the project matches upstream", async () => {
    await fs.writeFile(path.join(destDir, MANAGED), packagedCopy);

    const result = await runPostinstallSafeApply();

    expect(result.stalePaths).not.toContain(MANAGED);
  });
});
