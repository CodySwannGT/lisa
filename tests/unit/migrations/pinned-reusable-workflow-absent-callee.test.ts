/**
 * @file pinned-reusable-workflow-absent-callee.test.ts
 * @description What the pinner SAYS about the caller it declines to rewrite
 * (CodySwannGT/lisa#4021).
 *
 * A callee this release cannot vouch for is left on the ref it already had —
 * that behaviour is asserted next door in
 * `ensure-pinned-reusable-workflow-refs-vouched.test.ts`. What is asserted
 * here is the other half of the reported failure: the consumer had to revert
 * one rewrite of five by hand, with nothing in the migration's output marking
 * that one as different. A silent skip leaves them in exactly the state a
 * silent rewrite did — unable to tell which caller was treated differently or
 * why. "This one stays where it is, and here is why" is the remedy.
 *
 * The control case is the one that makes the rest non-vacuous: a migration
 * that warned about every caller it touched would satisfy the positive
 * assertions and mean nothing.
 * @module tests/unit/migrations/pinned-reusable-workflow-absent-callee
 */
import * as fs from "fs-extra";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReleasePinDependencies } from "../../../src/core/lisa-release-pin.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsurePinnedReusableWorkflowRefsMigration } from "../../../src/migrations/ensure-pinned-reusable-workflow-refs.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CI = path.join(".github", "workflows", "ci.yml");
const SHA = "0123456789abcdef0123456789abcdef01234567";

/** The reusable Lisa's own caller templates reference, so it is vouched. */
const QUALITY = "quality.yml";

/** The reusable no shipped template references, as in the reported failure. */
const UNVOUCHED = "sentry-deploy.yml";

/**
 * A caller workflow pointing at one Lisa reusable at a given ref.
 * @param file - Reusable workflow file name
 * @param ref - The ref the caller points at
 * @returns Workflow YAML
 */
const caller = (file: string, ref: string): string =>
  `name: CI\non:\n  pull_request:\njobs:\n  job:\n    uses: CodySwannGT/lisa/.github/workflows/${file}@${ref}\n`;

/**
 * Pin-resolution readers that answer with a stamped release identity.
 * @returns Dependencies for the migration under test
 */
const deps = (): ReleasePinDependencies => ({
  readVersion: () => "4.4.11",
  readStampedCommit: () => SHA,
  readStampedTag: () => "v4.4.11",
  resolveTagCommit: async () => null,
});

describe("a caller whose callee this release cannot vouch for", () => {
  let tempDir: string;
  let projectDir: string;
  let lisaDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    lisaDir = path.join(tempDir, "lisa");
    await fs.ensureDir(path.join(projectDir, ".github", "workflows"));
    await fs.ensureDir(lisaDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Seed a Lisa caller template so `quality.yml` is vouched and nothing else
   * is. The vouched set is derived from the templates on disk, so a fixture
   * seeding none would make EVERY callee unvouched and the assertions below
   * would pass for the wrong reason.
   */
  async function seedVouchedTemplate(): Promise<void> {
    const dir = path.join(
      lisaDir,
      "typescript",
      "copy-overwrite",
      ".github",
      "workflows"
    );
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, "ci.yml"), caller(QUALITY, "main"));
  }

  /**
   * Run one apply against the temporary project, collecting what it warned.
   * @returns Every warning the migration emitted, in order
   */
  async function warningsFromApply(): Promise<readonly string[]> {
    const warnings: string[] = [];
    const logger = new SilentLogger();
    // Replaces the one method under observation rather than rebuilding the
    // logger, which would go on satisfying ILogger after it grows a method
    // the stand-in silently does not implement.
    logger.warn = (message: string): void => {
      warnings.push(message);
    };
    const ctx: MigrationContext = {
      projectDir,
      lisaDir,
      detectedTypes: ["typescript"],
      dryRun: false,
      logger,
    };
    await new EnsurePinnedReusableWorkflowRefsMigration(deps()).apply(ctx);
    return warnings;
  }

  it("SAYS which caller it left, naming the file, line, workflow and commit", async () => {
    await seedVouchedTemplate();
    await fs.writeFile(
      path.join(projectDir, CI),
      `name: CI\non:\n  pull_request:\njobs:\n` +
        `  quality:\n    uses: CodySwannGT/lisa/.github/workflows/${QUALITY}@main\n` +
        `  sentry:\n    uses: CodySwannGT/lisa/.github/workflows/${UNVOUCHED}@main\n`
    );

    const said = (await warningsFromApply()).join("\n");

    // The unvouched caller sits on line 8 of the fixture above. Asserting the
    // line and not merely the file is what makes the message actionable in a
    // workflow carrying several callers.
    expect(said).toContain(`${CI}:8`);
    expect(said).toContain(UNVOUCHED);
    expect(said).toContain(SHA);
  });

  it("control: says nothing about the callers it DID pin", async () => {
    // Without this, the case above would pass against a migration that warned
    // about every caller it touched — which reports nothing at all, since a
    // warning on everything distinguishes nothing.
    await seedVouchedTemplate();
    await fs.writeFile(path.join(projectDir, CI), caller(QUALITY, "main"));

    expect(await warningsFromApply()).toEqual([]);
  });
});
