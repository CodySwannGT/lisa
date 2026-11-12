/**
 * `lisa apply` repoints the Sonar vendor shim AFTER `sonar integrate` runs.
 *
 * CodySwannGT/lisa#4502. `processSonarIntegration` re-runs `sonar integrate`,
 * which restores the vendor shim that blocks every prompt when the CLI is
 * unauthenticated. The repoint step must therefore run after it in the same
 * apply. This drives the real `Lisa.apply`: the heavy template and emit steps
 * are stubbed, the integrate step is stubbed to restore a vendor shim (what
 * the real CLI does), and the run is halted at the step after the repoint, so
 * the assertion is about the order apply actually uses.
 * @module tests/unit/core/lisa-sonar-shim-repoint
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutoAcceptPrompter } from "../../../src/cli/prompts.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { NoOpGitService } from "../../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../../src/core/lisa.js";
import { DetectorRegistry } from "../../../src/detection/index.js";
import type { ILogger } from "../../../src/logging/logger.interface.js";
import { MigrationRegistry } from "../../../src/migrations/index.js";
import { SONAR_WRAPPER_PATH } from "../../../src/sonar/sonar-shim-repoint.js";
import { StrategyRegistry } from "../../../src/strategies/index.js";
import { BackupService } from "../../../src/transaction/index.js";
import { SHIPPED } from "../hooks/support/sonar-secrets-fixtures.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

useIoLatencyBudget();

/** Sentinel that halts apply right after the step under test. */
const HALT = "halted after the sonar shim repoint step";

const SHIM = ".claude/hooks/sonar-secrets/build-scripts/prompt-secrets.sh";

const VENDOR_SHIM = [
  "#!/bin/bash",
  "if ! command -v sonar &> /dev/null; then",
  "  exit 0",
  "fi",
  "sonar hook claude-prompt-submit",
  "",
].join("\n");

/** Apply steps stubbed out because they are not under test here. */
const STUBBED_STEPS = [
  "runMigrationsBeforeStrategies",
  "processConfigurations",
  "processDeletions",
  "processMigrations",
  "processCodexEmit",
  "processClaudeEmit",
  "processAgyEmit",
  "processCopilotEmit",
  "processOpencodeEmit",
  "processDevinEmit",
] as const;

/** The private apply steps this suite stubs or observes. */
type Steps = Record<
  | (typeof STUBBED_STEPS)[number]
  | "processSonarIntegration"
  | "processInstructionFilesMigration",
  () => Promise<void>
>;

/** Logger that records informational and warning output. */
class RecordingLogger implements ILogger {
  readonly infos: string[] = [];
  readonly warnings: string[] = [];

  /**
   * Record an info line.
   * @param message - Info text.
   */
  info(message: string): void {
    this.infos.push(message);
  }

  /**
   * Record a warning.
   * @param message - Warning text.
   */
  warn(message: string): void {
    this.warnings.push(message);
  }

  /** Ignore success output. */
  success(): void {}

  /** Ignore error output. */
  error(): void {}

  /** Ignore dry-run output. */
  dry(): void {}
}

describe("Lisa.apply repoints Sonar shims after sonar integrate", () => {
  let destDir: string;
  let logger: RecordingLogger;

  beforeEach(async () => {
    destDir = await createTempDir();
    logger = new RecordingLogger();
    const wrapper = path.join(destDir, SONAR_WRAPPER_PATH);
    await mkdir(path.dirname(wrapper), { recursive: true });
    await copyFile(SHIPPED, wrapper);
    const steps = Lisa.prototype as unknown as Steps;
    for (const step of STUBBED_STEPS) {
      vi.spyOn(steps, step).mockResolvedValue(undefined);
    }
    // What the real CLI does on every apply: restore the vendor shim.
    vi.spyOn(steps, "processSonarIntegration").mockImplementation(async () => {
      const shim = path.join(destDir, SHIM);
      await mkdir(path.dirname(shim), { recursive: true });
      await writeFile(shim, VENDOR_SHIM, { mode: 0o755 });
    });
    vi.spyOn(steps, "processInstructionFilesMigration").mockRejectedValue(
      new Error(HALT)
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTempDir(destDir);
  });

  /**
   * Run apply against the temp project until the halt sentinel.
   * @param overrides - Config fields to override (dry-run, postinstall-safe)
   */
  async function apply(
    overrides: Partial<Pick<LisaConfig, "dryRun" | "postinstall">> = {}
  ): Promise<void> {
    const lisaConfig: LisaConfig = {
      destDir,
      dryRun: false,
      harness: "claude",
      lisaDir: process.cwd(),
      skipGitCheck: true,
      validateOnly: false,
      yesMode: true,
      ...overrides,
    };
    const deps: LisaDependencies = {
      backupService: new BackupService(logger),
      detectorRegistry: new DetectorRegistry(),
      gitService: new NoOpGitService(),
      logger,
      migrationRegistry: new MigrationRegistry(),
      prompter: new AutoAcceptPrompter(),
      strategyRegistry: new StrategyRegistry(),
    };
    await new Lisa(lisaConfig, deps).apply().catch(() => undefined);
    expect(
      (Lisa.prototype as unknown as Steps).processInstructionFilesMigration
    ).toHaveBeenCalled();
  }

  it("rewrites the shim sonar integrate just restored", async () => {
    await apply();

    const body = await readFile(path.join(destDir, SHIM), "utf8");
    expect(body).toContain(
      'exec bash "${here}/../../../../scripts/lisa-hooks/sonar-secrets.sh" claude-prompt-submit'
    );
    expect(logger.infos.some(line => line.includes(SHIM))).toBe(true);
  });

  it("leaves the shim alone in dry-run mode", async () => {
    await apply({ dryRun: true });

    expect(await readFile(path.join(destDir, SHIM), "utf8")).toBe(VENDOR_SHIM);
  });

  it("leaves the shim alone in a postinstall-safe apply", async () => {
    await apply({ postinstall: true });

    expect(await readFile(path.join(destDir, SHIM), "utf8")).toBe(VENDOR_SHIM);
  });

  it.skipIf(process.getuid?.() === 0)(
    "warns about an unwritable shim and lets apply continue",
    async () => {
      vi.spyOn(
        Lisa.prototype as unknown as Steps,
        "processSonarIntegration"
      ).mockImplementation(async () => {
        const shim = path.join(destDir, SHIM);
        await mkdir(path.dirname(shim), { recursive: true });
        await writeFile(shim, VENDOR_SHIM, { mode: 0o555 });
      });
      await apply();

      expect(await readFile(path.join(destDir, SHIM), "utf8")).toBe(
        VENDOR_SHIM
      );
      expect(logger.warnings.some(line => line.includes(SHIM))).toBe(true);
    }
  );

  it("warns about an unrecognised shim and names the setup skill", async () => {
    const custom = `${VENDOR_SHIM}echo done\n`;
    vi.spyOn(
      Lisa.prototype as unknown as Steps,
      "processSonarIntegration"
    ).mockImplementation(async () => {
      const shim = path.join(destDir, SHIM);
      await mkdir(path.dirname(shim), { recursive: true });
      await writeFile(shim, custom, { mode: 0o755 });
    });

    await apply();

    expect(await readFile(path.join(destDir, SHIM), "utf8")).toBe(custom);
    const warning = logger.warnings.find(line => line.includes(SHIM));
    expect(warning).toContain("lisa-setup-sonar §4a");
  });
});
