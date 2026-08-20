/**
 * A `lisa apply` an operator typed must not downgrade a Lisa-owned guard.
 *
 * The provenance check that decides whether a host's copy of a Lisa-owned
 * artifact is behind Lisa's or ahead of it (#2436, `classifyHostCopy`) was
 * wired into exactly one of the routes that replace a managed file: the
 * unattended one, reached only when `skipGitCheck` is set. `skipGitCheck` is
 * the postinstall's flag, not the command's. Every other route to the same
 * overwrite — the interactive prompt, `--yes`, and any non-TTY run, which
 * `createPrompter` answers with `AutoAcceptPrompter` returning "yes" without
 * asking anyone — took the branch above it and replaced the file without ever
 * classifying it.
 *
 * So the guard against silently downgrading a guard could be walked around by
 * running the command the normal way. That is #2577.
 *
 * These assertions drive the REAL apply — `Lisa.apply()`, the same orchestrator
 * `runApply` builds — against a project carrying the real shipped
 * `block-no-verify.sh`. Asserting on the strategy in isolation, or on file
 * contents with no apply in the picture, would pass while the defect persists,
 * because the defect is about which branch of the apply the file reaches.
 *
 * The packaged copy stands in for an upstream that predates the
 * `GIT_CONFIG_KEY_<n>` hardening: its declaration loses that token and the
 * check implementing it is stripped. Built from the shipped bytes rather than
 * read out of git history, which returns nothing under CI's shallow clone. It
 * is a comparison fixture and is never executed; what stays executable is the
 * host's copy, which is the real file.
 * @module tests/integration/apply-prompted-guard-downgrade
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AutoAcceptPrompter } from "../../src/cli/prompts.js";
import type { LisaConfig } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import { BackupService } from "../../src/transaction/index.js";
import { createTempDir, cleanupTempDir } from "../helpers/test-utils.js";

/** Where the guard installs in a host project. */
const GUARD = path.join("scripts", "lisa-hooks", "block-no-verify.sh");

/** The tree the shipped guard is authored in. */
const GUARD_SOURCE = path.join(
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-hooks",
  "block-no-verify.sh"
);

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

/** The capability token an upstream copy predating the hardening lacks. */
const CAPABILITY = "git-config-key";

/** The check that implements it, and the only place this text appears. */
const HARDENED_VECTOR = "git_config_key_";

describe("lisa apply on a project carrying the current guard (#2577)", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;
  let hostGuard: string;
  let olderUpstreamGuard: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");

    hostGuard = await fs.readFile(path.join(REPO_ROOT, GUARD_SOURCE), "utf8");
    olderUpstreamGuard = hostGuard
      .split("\n")
      .filter(
        line =>
          !line.toLowerCase().includes(HARDENED_VECTOR) &&
          !line.includes("key_match")
      )
      .join("\n")
      .replace(`, ${CAPABILITY}`, "");

    const packagedGuard = path.join(lisaDir, GUARD_SOURCE);
    await fs.ensureDir(path.dirname(packagedGuard));
    await fs.writeFile(packagedGuard, olderUpstreamGuard);

    const installedGuard = path.join(destDir, GUARD);
    await fs.ensureDir(path.dirname(installedGuard));
    await fs.writeFile(installedGuard, hostGuard);
    await fs.writeJson(path.join(destDir, "package.json"), {
      name: "placeholder-host",
      version: "1.0.0",
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Run the real apply the way an operator's `lisa apply` runs it.
   *
   * `skipGitCheck` stays false — that flag belongs to the postinstall — and the
   * prompter is the real `AutoAcceptPrompter`, which is what `createPrompter`
   * hands back under `--yes` or on any non-TTY stdin.
   * @param overrides - Config fields a case varies
   * @returns The apply result
   */
  async function runOperatorApply(
    overrides: Partial<LisaConfig> = {}
  ): Promise<{ readonly success: boolean }> {
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
    return new Lisa(config, deps).apply();
  }

  /**
   * The guard as it stands in the project after an apply.
   * @returns Contents of the installed guard
   */
  async function installedGuardContents(): Promise<string> {
    return fs.readFile(path.join(destDir, GUARD), "utf8");
  }

  it("leaves the hardened guard on disk instead of reverting it", async () => {
    await runOperatorApply();

    expect(await installedGuardContents()).toBe(hostGuard);
  });

  it("leaves the named bypass vector still guarded after the apply", async () => {
    await runOperatorApply();

    expect(await installedGuardContents()).toContain(HARDENED_VECTOR);
  });

  it("keeps the capability the host declared and Lisa's copy does not", async () => {
    await runOperatorApply();

    expect(await installedGuardContents()).toContain(CAPABILITY);
  });

  it("still hands over Lisa's copy when the operator asked for it by name", async () => {
    // The exit the refusal tells an operator to take. Refusing on every route
    // and then ignoring the one flag that means "take upstream's version"
    // would leave them with a file Lisa never updates and a remediation line
    // that does nothing — this fix's own failure mode, so it is pinned here.
    await runOperatorApply({
      refreshTemplates: {
        mode: "paths",
        paths: [GUARD.replaceAll("\\", "/")],
      },
    });

    expect(await installedGuardContents()).toBe(olderUpstreamGuard);
  });
});
