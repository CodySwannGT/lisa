/**
 * @file apply-reports-unchanged-manifest.test.ts
 * @description An apply that writes nothing must still say what it found.
 *
 * `updateDestination` attaches its operator notes to the "skipped" result and
 * carries a comment saying "the notes still have to reach the operator". They
 * did not: `logResult` treated "skipped" as silent, so every note produced by
 * an apply that changed no bytes was assembled, returned, and thrown away.
 *
 * That is the exact shape of the defect this fix is about (#2952) — a control
 * that runs, reports success, and measures nothing. It matters most for the
 * warning that a host's `lint` no longer invokes Lisa's `lint:lisa` gate,
 * because a host in that state reaches it on every subsequent apply, when
 * nothing about the manifest is changing any more.
 *
 * Driven through the real `Lisa.apply()` rather than the strategy, because the
 * defect is in the orchestrator's rendering, not in the plan.
 * @module tests/integration/apply-reports-unchanged-manifest
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AutoAcceptPrompter } from "../../src/cli/prompts.js";
import type { LisaConfig } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import type { ILogger } from "../../src/logging/logger.interface.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import { BackupService } from "../../src/transaction/index.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";

/** The lint base Lisa owns. */
const LINT_BASE = "oxlint && eslint . --quiet";

/** A host composition point that no longer runs Lisa's gate. */
const UNHOOKED_LINT = "echo skipping-lint";

/** The host manifest this apply targets. */
const PACKAGE_JSON = "package.json";

/** Collects every line an apply emits, at any level. */
class RecordingLogger implements ILogger {
  readonly lines: string[] = [];

  /**
   * Record an informational line.
   * @param message - Line emitted by the apply
   */
  info(message: string): void {
    this.lines.push(message);
  }

  /**
   * Record a success line.
   * @param message - Line emitted by the apply
   */
  success(message: string): void {
    this.lines.push(message);
  }

  /**
   * Record a warning line.
   * @param message - Line emitted by the apply
   */
  warn(message: string): void {
    this.lines.push(message);
  }

  /**
   * Record an error line.
   * @param message - Line emitted by the apply
   */
  error(message: string): void {
    this.lines.push(message);
  }

  /**
   * Record a dry-run line.
   * @param message - Line emitted by the apply
   */
  dry(message: string): void {
    this.lines.push(message);
  }
}

describe("an apply that changes nothing still reports what it found", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await fs.ensureDir(path.join(lisaDir, "typescript", "package-lisa"));
    await fs.ensureDir(destDir);

    await fs.writeJson(
      path.join(lisaDir, "typescript", "package-lisa", "package.lisa.json"),
      {
        force: { scripts: { "lint:lisa": LINT_BASE } },
        defaults: { scripts: { lint: "$npm_execpath run lint:lisa" } },
        adopt: { scripts: { lint: [LINT_BASE] } },
      }
    );

    await fs.writeJson(path.join(destDir, "tsconfig.json"), {});
    // Already fully applied EXCEPT that the host's composition point ignores
    // the gate — so the plan matches the file byte for byte and nothing writes.
    await fs.writeJson(path.join(destDir, PACKAGE_JSON), {
      name: "host-project",
      version: "1.0.0",
      scripts: { lint: UNHOOKED_LINT, "lint:lisa": LINT_BASE },
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Run the real apply and hand back everything it logged.
   * @returns The lines the apply emitted
   */
  async function applyAndCapture(): Promise<readonly string[]> {
    const config: LisaConfig = {
      lisaDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
    };
    const logger = new RecordingLogger();
    const deps: LisaDependencies = {
      logger,
      prompter: new AutoAcceptPrompter(),
      backupService: new BackupService(logger),
      detectorRegistry: new DetectorRegistry(),
      strategyRegistry: new StrategyRegistry(),
      gitService: new NoOpGitService(),
      migrationRegistry: new MigrationRegistry(),
    };
    await new Lisa(config, deps).apply();
    return logger.lines;
  }

  it("writes no bytes to a manifest that already matches the plan", async () => {
    // The first apply settles the manifest — key order, the bootstrap
    // postinstall. The second is the steady state every later apply hits.
    await applyAndCapture();
    const before = await fs.readFile(path.join(destDir, PACKAGE_JSON), "utf8");

    await applyAndCapture();

    expect(await fs.readFile(path.join(destDir, PACKAGE_JSON), "utf8")).toBe(
      before
    );
  });

  it("still names the gate the host's lint no longer invokes", async () => {
    await applyAndCapture();

    const lines = await applyAndCapture();

    expect(lines.join("\n")).toContain("lint:lisa");
  });
});
