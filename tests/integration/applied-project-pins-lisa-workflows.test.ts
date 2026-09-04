/**
 * @file applied-project-pins-lisa-workflows.test.ts
 * @description A project Lisa has applied calls Lisa's reusable workflows at a
 * full commit SHA, and an installation that cannot name its own release commit
 * refuses to apply at all rather than leaving one mutable.
 *
 * Driven through the real `Lisa.apply()` rather than the migration, because the
 * two facts under test are properties of the ORCHESTRATION and are invisible
 * one layer down:
 *
 *   - the templates ship `@main` — they must, since the commit a caller has to
 *     name belongs to a tag that does not exist when the template is authored —
 *     so "the emitted project is pinned" is only true if the pinner runs after
 *     the copy strategies, on every apply, in the default registry;
 *   - the abort has to land BEFORE anything is written. `apply()` runs after
 *     the strategies, so a migration that only failed there would leave a
 *     half-applied project behind and still report a failure, which is the
 *     worst of both.
 *
 * A host project reaches Lisa's reusable workflows through exactly one edge —
 * the `uses:` ref — and it is the one dependency edge the `@codyswann/lisa`
 * version pin in `package.json` does not cover. Everything here is about
 * closing that gap without opening the staleness gap in its place
 * (CodySwannGT/lisa#3893).
 * @module tests/integration/applied-project-pins-lisa-workflows
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AutoAcceptPrompter } from "../../src/cli/prompts.js";
import type { LisaConfig } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import type { ReleasePinDependencies } from "../../src/core/lisa-release-pin.js";
import { findReusableWorkflowRefs } from "../../src/core/reusable-workflow-pin.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { EnsurePinnedReusableWorkflowRefsMigration } from "../../src/migrations/ensure-pinned-reusable-workflow-refs.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import { BackupService } from "../../src/transaction/index.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";

/** The commit the fixture's installed version tag resolves to. */
const SHA = "0123456789abcdef0123456789abcdef01234567";

/** Where a caller lands inside the destination project. */
const CI = path.join(".github", "workflows", "ci.yml");

/** The caller template as it is authored and shipped: tracking `@main`. */
const CALLER_TEMPLATE = `name: CI
on:
  pull_request:
jobs:
  quality:
    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main
    secrets: inherit
`;

describe("an applied project pins Lisa's reusable workflows", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");

    const templateDir = path.join(
      lisaDir,
      "typescript",
      "create-only",
      ".github",
      "workflows"
    );
    await fs.ensureDir(templateDir);
    await fs.writeFile(path.join(templateDir, "ci.yml"), CALLER_TEMPLATE);

    await fs.ensureDir(destDir);
    await fs.writeJson(path.join(destDir, "tsconfig.json"), {});
    await fs.writeJson(path.join(destDir, "package.json"), {
      name: "host-project",
      version: "1.0.0",
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Pin-resolution dependencies for a fixture "installed" Lisa.
   * @param over - Fields to replace
   * @returns Dependencies for the pinner
   */
  function pinDeps(
    over: Partial<ReleasePinDependencies> = {}
  ): ReleasePinDependencies {
    return {
      readVersion: () => "4.4.11",
      readStampedCommit: () => SHA,
      readStampedTag: () => "v4.4.11",
      resolveTagCommit: async () => null,
      ...over,
    };
  }

  /**
   * Run the real apply with the pinner wired into the registry.
   * @param deps - Pin-resolution dependencies
   * @returns Whether the apply succeeded, and the errors it reported
   */
  async function apply(
    deps: ReleasePinDependencies
  ): Promise<{ success: boolean; errors: readonly string[] }> {
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
    const lisaDeps: LisaDependencies = {
      logger,
      prompter: new AutoAcceptPrompter(),
      backupService: new BackupService(logger),
      detectorRegistry: new DetectorRegistry(),
      strategyRegistry: new StrategyRegistry(),
      gitService: new NoOpGitService(),
      migrationRegistry: new MigrationRegistry([
        new EnsurePinnedReusableWorkflowRefsMigration(deps),
      ]),
    };
    const result = await new Lisa(config, lisaDeps).apply();
    return { success: result.success, errors: result.errors ?? [] };
  }

  it("emits ZERO mutable refs — the template's @main does not survive the apply", async () => {
    const outcome = await apply(pinDeps());
    expect(outcome.success).toBe(true);

    const emitted = await fs.readFile(path.join(destDir, CI), "utf8");
    expect(emitted).not.toContain("@main");
    expect(emitted).toContain(
      `uses: CodySwannGT/lisa/.github/workflows/quality.yml@${SHA} # v4.4.11`
    );
  });

  it("emits the FULL forty characters, not a short SHA", async () => {
    await apply(pinDeps());
    const refs = findReusableWorkflowRefs(
      await fs.readFile(path.join(destDir, CI), "utf8")
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.ref).toHaveLength(40);
  });

  it("is a no-op the second time — applying again produces an empty diff", async () => {
    await apply(pinDeps());
    const first = await fs.readFile(path.join(destDir, CI), "utf8");

    await apply(pinDeps());

    expect(await fs.readFile(path.join(destDir, CI), "utf8")).toBe(first);
  });

  it("repins the whole project when the installed version changes", async () => {
    await apply(pinDeps());
    const bumped = "fedcba9876543210fedcba9876543210fedcba98";

    const outcome = await apply(
      pinDeps({
        readVersion: () => "4.5.0",
        readStampedCommit: () => bumped,
        readStampedTag: () => "v4.5.0",
      })
    );

    expect(outcome.success).toBe(true);
    expect(await fs.readFile(path.join(destDir, CI), "utf8")).toContain(
      `@${bumped} # v4.5.0`
    );
  });

  it("FAILS the apply and writes nothing when the version's tag resolves to no commit", async () => {
    const outcome = await apply(
      pinDeps({
        readStampedCommit: () => null,
        readStampedTag: () => null,
        resolveTagCommit: async () => null,
      })
    );

    expect(outcome.success).toBe(false);
    expect(outcome.errors.join("\n")).toContain("cannot resolve Lisa v4.4.11");
    // Nothing was copied: the abort landed before the strategies ran, so the
    // project is exactly as it was rather than half-applied and pointing at a
    // mutable ref that reads as deliberate.
    expect(await fs.pathExists(path.join(destDir, CI))).toBe(false);
  });

  it("does not repair the failed apply by falling back to @main", async () => {
    await apply(
      pinDeps({
        readStampedCommit: () => null,
        readStampedTag: () => null,
        resolveTagCommit: async () => null,
      })
    );
    const workflows = path.join(destDir, ".github", "workflows");
    const emitted = (await fs.pathExists(workflows))
      ? await fs.readdir(workflows)
      : [];
    expect(emitted).toEqual([]);
  });
});
