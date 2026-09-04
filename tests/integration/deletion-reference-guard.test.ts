import * as fs from "fs-extra";
import * as path from "node:path";
import { AutoAcceptPrompter } from "../../src/cli/prompts.js";
import type { LisaConfig } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import { BackupService } from "../../src/transaction/index.js";
import {
  cleanupTempDir,
  createExpoProject,
  createMockLisaDir,
  createTempDir,
} from "../helpers/test-utils.js";

const WORKFLOWS = path.join(".github", "workflows");
const BUILD_YML = ".github/workflows/build.yml";
const LIGHTHOUSE_YML = ".github/workflows/lighthouse.yml";
const DEPLOY_YML = ".github/workflows/deploy.yml";

/**
 * A deploy workflow that calls build.yml as a *local* reusable — the exact
 * shape a consumer repo has when it has not yet migrated to the `@main`
 * reference. Deleting the target turns the whole deploy run into a startup
 * failure, so the guard must refuse.
 */
/**
 * The header a `copy-overwrite` template carries.
 *
 * Both manifest targets below are Lisa's own reusable workflows, so both carry
 * it. Since CodySwannGT/lisa#3656 that header is what authorises deleting a
 * `.github/workflows/` file at all: a manifest entry alone no longer removes
 * one, because the manifest names paths and a consumer can have authored an
 * unrelated file at the same path. The reference guard under test here runs
 * BEFORE that ownership gate, so `build.yml` would be kept either way — the
 * headers keep the fixture honest about what these two files are.
 */
const LISA_MANAGED_HEADER = [
  "# This file is managed by Lisa and IS replaced on each `lisa` run.",
  "# Do not edit directly — durable changes belong upstream in Lisa.",
  "",
].join("\n");

const DEPLOY_CALLING_BUILD = [
  "name: Deploy",
  "on:",
  "  push:",
  "    branches: [main]",
  "jobs:",
  "  build:",
  "    uses: ./.github/workflows/build.yml",
  "    secrets: inherit",
  "",
].join("\n");

/**
 * Logger that keeps the messages a test needs to assert on: warnings carry the
 * refusal, and dry-run lines carry the plan a `--dry-run` operator is shown.
 */
class RecordingLogger extends SilentLogger {
  public readonly warnings: string[] = [];
  public readonly dryRunLines: string[] = [];

  /**
   * Record a warning instead of discarding it
   * @param message - Warning message emitted during apply
   */
  override warn(message: string): void {
    this.warnings.push(message);
  }

  /**
   * Record a dry-run line instead of discarding it
   * @param message - Dry-run message emitted during apply
   */
  override dry(message: string): void {
    this.dryRunLines.push(message);
  }
}

describe("deletion guard for locally referenced workflows", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await createMockLisaDir(lisaDir);
    await createExpoProject(destDir);

    // Mirror the real expo manifest pair: one path a consumer still calls, one
    // genuinely orphaned. Both are listed for deletion.
    await fs.ensureDir(path.join(lisaDir, "expo"));
    // A basis is required for a path to be deletable at all
    // (CodySwannGT/lisa#3700): a manifest that does not say why a path may go
    // does not authorise removing it. This fixture is about the reference
    // guard, so both paths carry one and the reference guard stays the only
    // thing deciding.
    await fs.writeJson(path.join(lisaDir, "expo", "deletions.json"), {
      paths: [BUILD_YML, LIGHTHOUSE_YML],
      basis: { [BUILD_YML]: "needs-review", [LIGHTHOUSE_YML]: "needs-review" },
    });

    await fs.ensureDir(path.join(destDir, WORKFLOWS));
    await fs.writeFile(
      path.join(destDir, WORKFLOWS, "deploy.yml"),
      DEPLOY_CALLING_BUILD
    );
    await fs.writeFile(
      path.join(destDir, WORKFLOWS, "build.yml"),
      `${LISA_MANAGED_HEADER}on:\n  workflow_call:\n`
    );
    await fs.writeFile(
      path.join(destDir, WORKFLOWS, "lighthouse.yml"),
      `${LISA_MANAGED_HEADER}on:\n  workflow_call:\n`
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build a Lisa instance pointed at the temp project
   * @param logger - Logger to install on the instance
   * @param overrides - Configuration overrides
   * @returns Lisa instance ready to apply
   */
  function createLisa(
    logger: SilentLogger,
    overrides: Partial<LisaConfig> = {}
  ): Lisa {
    const config: LisaConfig = {
      lisaDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
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
    return new Lisa(config, deps);
  }

  it("refuses to delete a workflow another workflow calls via a local uses:", async () => {
    const result = await createLisa(new SilentLogger()).apply();

    expect(result.success).toBe(true);
    expect(
      await fs.pathExists(path.join(destDir, WORKFLOWS, "build.yml"))
    ).toBe(true);
  });

  it("names the referencing workflow when it refuses the deletion", async () => {
    const logger = new RecordingLogger();

    await createLisa(logger).apply();

    expect(
      logger.warnings.some(
        message => message.includes(DEPLOY_YML) && message.includes(BUILD_YML)
      )
    ).toBe(true);
  });

  it("still deletes a genuinely unreferenced workflow on the same manifest", async () => {
    const result = await createLisa(new SilentLogger()).apply();

    expect(result.success).toBe(true);
    expect(
      await fs.pathExists(path.join(destDir, WORKFLOWS, "lighthouse.yml"))
    ).toBe(false);
  });

  it("omits the referenced workflow from the dry-run plan while keeping the orphan in it", async () => {
    const logger = new RecordingLogger();

    await createLisa(logger, { dryRun: true }).apply();

    expect(logger.dryRunLines.some(line => line.includes(LIGHTHOUSE_YML))).toBe(
      true
    );
    expect(logger.dryRunLines.some(line => line.includes(BUILD_YML))).toBe(
      false
    );
  });
});
