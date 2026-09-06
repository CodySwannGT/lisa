/**
 * @file ensure-pinned-reusable-workflow-refs-vouched.test.ts
 * @description Mixing a vouched pin with an unvouched caller in one file
 * (CodySwannGT/lisa#4021).
 *
 * A callee no release carries must be left on its mutable ref: pinning it would
 * name a commit where the file is absent, and an unresolvable reusable workflow
 * is a load error that kills the job before a step runs.
 *
 * That exemption has a second-order cost these cases exist to pin. An unvouched
 * reference is never `isPinnedAt` BY CONSTRUCTION, so a no-op check asking "is
 * every reference pinned" answers no forever — the file is rewritten with
 * byte-identical content on every apply, and the run reports a pin that never
 * happened. Idempotency is the property most easily lost when an exemption is
 * introduced, and the one least likely to be noticed, because nothing fails.
 *
 * Split from `ensure-pinned-reusable-workflow-refs.test.ts` on size; the
 * concern is distinct from the base pinning contract.
 * @module tests/unit/migrations/ensure-pinned-reusable-workflow-refs-vouched
 */
import * as fs from "fs-extra";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../../src/core/config.js";
import type { ReleasePinDependencies } from "../../../src/core/lisa-release-pin.js";
import { EnsurePinnedReusableWorkflowRefsMigration } from "../../../src/migrations/ensure-pinned-reusable-workflow-refs.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CI = path.join(".github", "workflows", "ci.yml");
const SHA = "0123456789abcdef0123456789abcdef01234567";
const QUALITY = "quality.yml";

/**
 * A caller workflow pointing at one Lisa reusable at a given ref.
 * @param file - Reusable workflow file name
 * @param ref - The ref the caller points at
 * @returns Workflow YAML
 */
const caller = (file: string, ref: string): string =>
  `name: CI\non:\n  pull_request:\njobs:\n  job:\n    uses: CodySwannGT/lisa/.github/workflows/${file}@${ref}\n    with:\n      branch: main\n`;

describe("EnsurePinnedReusableWorkflowRefsMigration — vouched callees", () => {
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
   * Resolver dependencies that answer with a stamped release identity.
   * @returns Dependencies for the migration under test
   */
  function deps(): ReleasePinDependencies {
    return {
      readVersion: () => "4.4.11",
      readStampedCommit: () => SHA,
      readStampedTag: () => "v4.4.11",
      resolveTagCommit: async () => null,
    };
  }

  /**
   * Build a migration context for the temporary project.
   * @param detectedTypes - Project stacks visible to the migration
   * @returns Migration context
   */
  function context(
    detectedTypes: readonly ProjectType[] = ["typescript"]
  ): MigrationContext {
    return {
      projectDir,
      lisaDir,
      detectedTypes,
      dryRun: false,
      logger: new SilentLogger(),
    };
  }

  /**
   * Read a workflow file back from the project.
   * @param relative - Path relative to the project root
   * @returns File contents
   */
  const read = (relative: string): Promise<string> =>
    fs.readFile(path.join(projectDir, relative), "utf8");

  /** A callee no release carries, so it must be left on its mutable ref. */
  const UNVOUCHED = "sentry-deploy.yml";

  /**
   * Seed a Lisa caller template so `quality.yml` is vouched and nothing else
   * is. The vouched set is derived from the templates on disk, so a fixture
   * that seeds none would make EVERY callee unvouched and the assertions
   * below would pass for the wrong reason.
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
   * One file carrying a settled pin and an untouchable caller.
   * @returns Workflow YAML
   */
  const settledPlusUnvouched = (): string =>
    `name: CI\non:\n  pull_request:\njobs:\n` +
    `  quality:\n    uses: CodySwannGT/lisa/.github/workflows/${QUALITY}@${SHA} # v4.4.11\n` +
    `  sentry:\n    uses: CodySwannGT/lisa/.github/workflows/${UNVOUCHED}@main\n`;

  it("is already settled, so the migration does not apply", async () => {
    // The regression. `isPinnedAt` is false for the unvouched caller by
    // construction — it is deliberately left mutable — so a no-op check that
    // asked "is EVERY reference pinned" answered no forever. The file was
    // rewritten with byte-identical content on every apply, and the run
    // logged a pin that never happened.
    await seedVouchedTemplate();
    await fs.writeFile(path.join(projectDir, CI), settledPlusUnvouched());

    const migration = new EnsurePinnedReusableWorkflowRefsMigration(deps());

    expect(await migration.applies(context())).toBe(false);
  });

  it("control: the same file DOES apply while its vouched ref is mutable", async () => {
    // Without this, the case above would pass against a migration that had
    // stopped applying altogether — which is the failure that would matter
    // most, and is indistinguishable from correct idempotency by that
    // assertion alone.
    await seedVouchedTemplate();
    await fs.writeFile(
      path.join(projectDir, CI),
      `name: CI\non:\n  pull_request:\njobs:\n` +
        `  quality:\n    uses: CodySwannGT/lisa/.github/workflows/${QUALITY}@main\n` +
        `  sentry:\n    uses: CodySwannGT/lisa/.github/workflows/${UNVOUCHED}@main\n`
    );

    const migration = new EnsurePinnedReusableWorkflowRefsMigration(deps());

    expect(await migration.applies(context())).toBe(true);
  });

  it("pins the vouched ref and leaves the unvouched one byte-identical", async () => {
    await seedVouchedTemplate();
    await fs.writeFile(
      path.join(projectDir, CI),
      `name: CI\non:\n  pull_request:\njobs:\n` +
        `  quality:\n    uses: CodySwannGT/lisa/.github/workflows/${QUALITY}@main\n` +
        `  sentry:\n    uses: CodySwannGT/lisa/.github/workflows/${UNVOUCHED}@main\n`
    );

    const migration = new EnsurePinnedReusableWorkflowRefsMigration(deps());
    await migration.apply(context());

    // Asserted as a WHOLE DOCUMENT rather than by substring. `toContain` on
    // the unvouched line still passes if an inline comment is appended to it,
    // while this case claims the line survives byte for byte — and "preserved
    // exactly" is the property the exemption actually promises.
    expect(await read(CI)).toBe(
      `name: CI\non:\n  pull_request:\njobs:\n` +
        `  quality:\n    uses: CodySwannGT/lisa/.github/workflows/${QUALITY}@${SHA} # v4.4.11\n` +
        `  sentry:\n    uses: CodySwannGT/lisa/.github/workflows/${UNVOUCHED}@main\n`
    );
  });

  it("stays settled after applying, so a second run is a no-op", async () => {
    // Idempotency asserted end to end rather than inferred from the check
    // above: apply once, then ask again.
    await seedVouchedTemplate();
    await fs.writeFile(
      path.join(projectDir, CI),
      `name: CI\non:\n  pull_request:\njobs:\n` +
        `  quality:\n    uses: CodySwannGT/lisa/.github/workflows/${QUALITY}@main\n` +
        `  sentry:\n    uses: CodySwannGT/lisa/.github/workflows/${UNVOUCHED}@main\n`
    );

    const migration = new EnsurePinnedReusableWorkflowRefsMigration(deps());

    // The first pass must actually have DONE something, or everything below is
    // vacuous: a migration that never applied at all satisfies it trivially.
    expect((await migration.apply(context())).action).toBe("applied");
    const afterFirst = await read(CI);

    // Run the second pass for real rather than inferring it from `applies()`.
    // A defect living in `apply()`'s OWN no-op branch would survive an
    // assertion that only ever asked the predicate.
    expect(await migration.applies(context())).toBe(false);
    expect((await migration.apply(context())).action).toBe("noop");
    expect(await read(CI)).toBe(afterFirst);
  });
});
