/**
 * The reproduction from #3026, as a test.
 *
 * Measured against the published 3.70.0 tarball, installed into a
 * consumer-shaped TypeScript checkout with a clean git tree and two
 * hand-customised files. The command carried no `--yes`:
 *
 * ```
 * LISA_BOOTSTRAP=1 node node_modules/@codyswann/lisa/dist/index.js apply --harness fleet .
 * ```
 *
 * ```
 * [INFO] Auto-accepting overwrite (non-interactive): eslint.config.ts
 * [OK] Overwritten: eslint.config.ts
 * [INFO] Auto-accepting overwrite (non-interactive): knip.json
 * [OK] Overwritten: knip.json
 *   Overwritten:   3 files (approved or Lisa-owned)
 *   Out of date:   0 files (managed templates changed; NOT updated)
 * ```
 *
 * Nobody approved those and Lisa owns none of them. `createPrompter` mapped a
 * missing TTY onto the auto-accepting prompter, so the routine invocation —
 * every agent-driven, scripted, and CI apply — was the one that clobbered. The
 * cost landed downstream as a standing manual rule telling humans to diff
 * `git status` after every apply and revert what they did not intend to change.
 *
 * These assertions drive the real orchestrator, `Lisa.apply()`, the same one
 * `runApply` builds. Asserting on the strategy alone would pass while the
 * defect persisted, because the defect is about which prompter the apply is
 * handed and which branch the file then reaches.
 * @module tests/integration/apply-unattended-preserves-host-config
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { createPrompter } from "../../src/cli/prompts.js";
import type { LisaConfig } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import { BackupService } from "../../src/transaction/index.js";
import { createTempDir, cleanupTempDir } from "../helpers/test-utils.js";

/** A managed file Lisa seeds and hosts legitimately customise. */
const MANAGED = "knip.json";

/** Where the TypeScript stack authors it. */
const MANAGED_SOURCE = path.join("typescript", "copy-overwrite", MANAGED);

/** The host's edit, and the only place this text appears. */
const HOST_MARKER = "host-owned-package";

/**
 * Force `process.stdin.isTTY` so `createPrompter` takes the branch under test
 * deterministically, whatever the test runner's own stdin happens to be.
 * @param value Desired isTTY value
 */
function setTty(value: true | false | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

describe("an unattended lisa apply on a customised project (#3026)", () => {
  const originalIsTty = process.stdin.isTTY;
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;
  let hostCopy: string;
  let packagedCopy: string;

  // No terminal, for the whole file. This is the condition the defect lived
  // in, and asking `createPrompter` for the prompter under it — rather than
  // handing the apply one directly — is what makes these cases exercise the
  // real chain: TTY state → prompter choice → strategy routing → the file.
  beforeAll(() => {
    setTty(false);
  });

  afterAll(() => {
    setTty(originalIsTty);
  });

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");

    hostCopy = `${JSON.stringify({ entry: ["src/index.ts"], ignoreDependencies: [HOST_MARKER] }, undefined, 2)}\n`;
    packagedCopy = `${JSON.stringify({ entry: ["src/**/*.ts"], ignoreDependencies: [] }, undefined, 2)}\n`;

    const packaged = path.join(lisaDir, MANAGED_SOURCE);
    await fs.ensureDir(path.dirname(packaged));
    await fs.writeFile(packaged, packagedCopy);

    const installed = path.join(destDir, MANAGED);
    await fs.ensureDir(destDir);
    await fs.writeFile(installed, hostCopy);
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
   * Run the real apply the way a bare `lisa apply` runs in a shell with no
   * terminal: `yesMode` false because no flag was passed, `skipGitCheck` false
   * because that flag belongs to the postinstall, and the prompter the fixed
   * `createPrompter` hands back when stdin is not a TTY.
   * @param overrides - Config fields a case varies
   * @returns The apply result
   */
  async function runUnattendedApply(
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

  /**
   * The managed file as it stands in the project after the apply.
   * @returns Contents of the installed file
   */
  async function installedContents(): Promise<string> {
    return fs.readFile(path.join(destDir, MANAGED), "utf8");
  }

  it("leaves the host's customised file byte-for-byte intact", async () => {
    await runUnattendedApply();

    expect(await installedContents()).toBe(hostCopy);
  });

  it("keeps the customisation the host put there", async () => {
    await runUnattendedApply();

    expect(await installedContents()).toContain(HOST_MARKER);
  });

  it("does not replace it with the packaged template", async () => {
    await runUnattendedApply();

    expect(await installedContents()).not.toBe(packagedCopy);
  });

  it("--yes does not replace it either, since CodySwannGT/lisa#3069", async () => {
    // REVERSED deliberately, and kept rather than deleted. This was the
    // positive control: when #3026 shipped, `--yes` DID replace this file, and
    // that boundary was the next defect. #3069 moved it — `--yes` is the
    // operator approving the run, not approving the loss of a curated
    // `knip.json`. The file is now reported `stale` and left alone.
    //
    // The control role this case used to play has moved to the case below,
    // which is the remaining route that still replaces the same fixture.
    await runUnattendedApply({ yesMode: true });

    expect(await installedContents()).toContain(HOST_MARKER);
    expect(await installedContents()).not.toBe(packagedCopy);
  });

  it("positive control: --refresh-templates on the same setup does replace it", async () => {
    // Inherited from the `--yes` case above when #3069 reversed it, and the
    // reason this file still proves anything. Without a route that DOES
    // replace this fixture, every survival asserted above could be passing
    // because the apply never reached the file at all — a green that proves
    // nothing. This shows the same fixture IS replaceable, so those survivals
    // are the routing decision and not an inert setup.
    //
    // It is also the exit a `stale` report tells the operator to use, so it
    // has to keep working or the deferral becomes a refusal.
    await runUnattendedApply({
      refreshTemplates: { mode: "paths", paths: [MANAGED] },
    });

    expect(await installedContents()).toBe(packagedCopy);
  });
});
