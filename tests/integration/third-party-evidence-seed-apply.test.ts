/**
 * `lisa apply` leaves a host's seeded evidence workflow byte-for-byte alone.
 *
 * The workflow is `create-only`: Lisa writes it once and the host owns it from
 * then on. The #4553 fix changes the seed, and the temptation is to carry that
 * change into existing copies on the next apply. That would break the promise
 * `create-only` makes, on a file that may hold host edits, from a postinstall
 * nobody watches — which is why the stale copy is REPORTED by `lisa doctor`
 * instead. This drives the real orchestrator to show the refusal is the apply's
 * routing, and pairs it with the positive control that the same apply does
 * write the new seed into a project that has none.
 * @module tests/integration/third-party-evidence-seed-apply
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPrompter } from "../../src/cli/prompts.js";
import type { LisaConfig } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import { THIRD_PARTY_EVIDENCE_WORKFLOW } from "../../src/core/third-party-evidence-seed.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import { BackupService } from "../../src/transaction/index.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** Where the TypeScript stack authors the seed. */
const SEED_SOURCE = path.join(
  "typescript",
  "create-only",
  THIRD_PARTY_EVIDENCE_WORKFLOW
);

describe("lisa apply on a host holding the pre-fix evidence workflow (#4553)", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;
  let installed: string;
  let preFixSeed: string;
  let currentSeed: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    installed = path.join(destDir, THIRD_PARTY_EVIDENCE_WORKFLOW);
    preFixSeed = await fs.readFile(
      path.join(
        ROOT,
        "tests/fixtures/third-party-review-evidence-seed/pre-4553.yml"
      ),
      "utf8"
    );
    currentSeed = await fs.readFile(path.join(ROOT, SEED_SOURCE), "utf8");
    await fs.outputFile(path.join(lisaDir, SEED_SOURCE), currentSeed);
    // Present so the TypeScript detector fires and the stack's tree applies.
    await fs.ensureDir(destDir);
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
   * Run the real apply the way an unattended `lisa apply` runs.
   * @param overrides - Config fields a case varies
   * @returns The apply result
   */
  async function apply(
    overrides: Partial<LisaConfig> = {}
  ): Promise<{ readonly success: boolean }> {
    const config: LisaConfig = {
      lisaDir,
      destDir,
      dryRun: false,
      yesMode: false,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
      ...overrides,
    };
    const logger = new SilentLogger();
    const deps: LisaDependencies = {
      logger,
      prompter: createPrompter(config.yesMode),
      backupService: new BackupService(logger),
      detectorRegistry: new DetectorRegistry(),
      strategyRegistry: new StrategyRegistry(),
      gitService: new NoOpGitService(),
      migrationRegistry: new MigrationRegistry(),
    };
    return new Lisa(config, deps).apply();
  }

  it("ships a seed that differs from the host's copy, so the case is real", () => {
    expect(currentSeed).not.toBe(preFixSeed);
  });

  it.each([
    ["an unattended apply", {}],
    ["an apply run with --yes", { yesMode: true }],
  ])(
    "leaves the host's copy byte-for-byte unchanged under %s",
    async (_name, overrides) => {
      await fs.outputFile(installed, preFixSeed);

      const result = await apply(overrides);

      expect(result.success).toBe(true);
      expect(await fs.readFile(installed, "utf8")).toBe(preFixSeed);
    }
  );

  it("positive control: the same apply writes the new seed where there was none", async () => {
    const result = await apply();

    expect(result.success).toBe(true);
    expect(await fs.readFile(installed, "utf8")).toBe(currentSeed);
  });
});
