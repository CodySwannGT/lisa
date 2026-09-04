import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsureNightlyE2EWorkflowPinsMigration } from "../../../src/migrations/ensure-nightly-e2e-workflow-pins.js";
import { createMigrationRegistry } from "../../../src/migrations/index.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const HEALTH = path.join(".github", "workflows", "nightly-e2e-health.yml");
const REPORT = path.join(".github", "workflows", "nightly-e2e-report.yml");

const ORPHAN_PIN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("EnsureNightlyE2EWorkflowPinsMigration", () => {
  let tempDir: string;
  let projectDir: string;
  let migration: EnsureNightlyE2EWorkflowPinsMigration;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(path.join(projectDir, ".github", "workflows"));
    await fs.ensureDir(path.join(projectDir, "scripts"));
    migration = new EnsureNightlyE2EWorkflowPinsMigration(() => "9.8.7");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build a migration context for the temporary project.
   *
   * @param detectedTypes - Project stacks visible to the migration
   * @param dryRun - Whether the migration may write
   * @returns Migration context for this test project
   */
  function context(
    detectedTypes: readonly ProjectType[] = ["expo"],
    dryRun = false
  ): MigrationContext {
    return {
      projectDir,
      lisaDir: path.join(tempDir, "lisa"),
      detectedTypes,
      dryRun,
      logger: new SilentLogger(),
    };
  }

  /**
   * Rewrite both callers to one literal pin, the way a host repin would.
   *
   * @param ref - Replacement ref for both callers
   */
  async function repin(ref: string): Promise<void> {
    for (const file of [HEALTH, REPORT]) {
      const absolute = path.join(projectDir, file);
      await fs.writeFile(
        absolute,
        (await fs.readFile(absolute, "utf8")).replace(/@v4\.4\.21/g, `@${ref}`)
      );
    }
  }

  /** Seed the two stale callers and their shipped contract guard. */
  async function seed(): Promise<void> {
    await fs.writeFile(
      path.join(projectDir, "scripts", "check-nightly-e2e-health.mjs"),
      'export const NIGHTLY_E2E_CONTRACT_VERSION = "1.6.0";\n'
    );
    await fs.writeFile(
      path.join(projectDir, HEALTH),
      `    # v4.4.21 matches this repo's own installed Lisa (package.json), so the
    # the guard reports contract 1.5.0 and the reusable asserts its MAJOR (1).
    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@v4.4.21
`
    );
    await fs.writeFile(
      path.join(projectDir, REPORT),
      "    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-report.yml@v4.4.21\n"
    );
  }

  it("refreshes the health contract comment", async () => {
    await seed();

    expect(await migration.applies(context())).toBe(true);
    expect(await migration.apply(context())).toMatchObject({
      action: "applied",
      changedFiles: [HEALTH],
    });
    expect(await fs.readFile(path.join(projectDir, HEALTH), "utf8")).toContain(
      "contract 1.6.0"
    );
  });

  it("does NOT rewrite the caller's uses: ref — the pinner owns that line", async () => {
    // It used to, and pinning at a release TAG was the answer at the time.
    // `ensure-pinned-reusable-workflow-refs` now pins every Lisa caller, these
    // two included, at the commit the installed version's tag names. Leaving
    // this arm in place would have the two migrations undo each other on every
    // apply: content-stable, endlessly reported as "applied", and pinned at
    // whichever happened to run last.
    await seed();
    await migration.apply(context());

    for (const [file, reusable] of [
      [HEALTH, "nightly-e2e-health.yml"],
      [REPORT, "nightly-e2e-report.yml"],
    ] as const) {
      expect(await fs.readFile(path.join(projectDir, file), "utf8")).toContain(
        `${reusable}@v4.4.21`
      );
    }
  });

  it("leaves a well-formed pin that resolves to nothing alone, rather than repairing it here", async () => {
    // An unreachable pin is still a real defect — Actions cannot load the
    // workflow, so it runs zero jobs and the required check goes ABSENT rather
    // than red. The repair moved rather than disappeared: the pinner rewrites
    // any ref, this one included, to the installed version's commit.
    await seed();
    await repin(ORPHAN_PIN);
    await migration.apply(context());

    expect(await fs.readFile(path.join(projectDir, REPORT), "utf8")).toContain(
      ORPHAN_PIN
    );
  });

  it("leaves a host-selected branch ref untouched", async () => {
    await seed();
    const healthFile = path.join(projectDir, HEALTH);
    const before = (await fs.readFile(healthFile, "utf8"))
      .replace("nightly-e2e-health.yml@v4.4.21", "nightly-e2e-health.yml@main")
      .replace("contract 1.5.0", "contract 1.6.0")
      .replace("# v4.4.21 matches", "# v9.8.7 matches");
    await fs.writeFile(healthFile, before);
    await fs.remove(path.join(projectDir, REPORT));

    expect(await migration.applies(context())).toBe(false);
    expect(await migration.apply(context())).toMatchObject({ action: "noop" });
    expect(await fs.readFile(healthFile, "utf8")).toBe(before);
  });

  it("reports a dry run without writing files", async () => {
    await seed();
    const before = await fs.readFile(path.join(projectDir, HEALTH), "utf8");

    expect(await migration.apply(context(["expo"], true))).toMatchObject({
      action: "applied",
      changedFiles: [HEALTH],
    });
    expect(await fs.readFile(path.join(projectDir, HEALTH), "utf8")).toBe(
      before
    );
  });

  it("runs BEFORE the pinner, so the pinner has the last word on the ref", async () => {
    const names = createMigrationRegistry()
      .getAll()
      .map(item => item.name);
    expect(names.indexOf("ensure-nightly-e2e-workflow-pins")).toBeLessThan(
      names.indexOf("ensure-pinned-reusable-workflow-refs")
    );
  });

  it("does not apply outside Expo projects", async () => {
    await seed();
    expect(await migration.applies(context(["typescript"]))).toBe(false);
  });

  it("is registered in the default migration set", () => {
    expect(
      createMigrationRegistry()
        .getAll()
        .map(item => item.name)
    ).toContain("ensure-nightly-e2e-workflow-pins");
  });

  it("stamps the published package with the release tag it was cut at", async () => {
    const workflow = await fs.readFile(
      path.join(process.cwd(), ".github", "workflows", "publish-to-npm.yml"),
      "utf8"
    );

    // The published package records the commit it was cut at AND the tag,
    // and `check-release-package-identity.mjs` refuses to publish unless the
    // tag resolves to exactly that commit. That assertion is what lets the
    // pinner treat `lisaReleaseCommit` as "the commit the installed version's
    // TAG points at" without a network call — so if these stamps stop being
    // written, every consumer's pin silently stops being derivable.
    //
    // The bindings moved from shell assignments to job-level `env:` (#3717),
    // which is the template-injection fix. The `npm pkg set` lines — the ones
    // that actually stamp the package — are untouched.
    expect(workflow).toContain("RELEASE_COMMIT: ${{ inputs.release_commit }}");
    expect(workflow).toContain(
      'npm pkg set lisaReleaseCommit="$RELEASE_COMMIT"'
    );
    expect(workflow).toContain('npm pkg set gitHead="$RELEASE_COMMIT"');
    expect(workflow).toContain("RELEASE_TAG: ${{ inputs.tag }}");
    expect(workflow).toContain('npm pkg set lisaReleaseTag="$RELEASE_TAG"');
  });

  /**
   * Arming the bypass gate against body-evidence deletion (#3476, #3485).
   *
   * A valid waiver needs the bypass label AND a `Nightly-E2E-Bypass:` line in
   * the pull-request body. The caller subscribes to `labeled`/`unlabeled`, so
   * deleting the label re-fires the gate; nothing subscribes to `edited`, so
   * deleting the BODY line fires nothing and the previous SUCCESS stands.
   *
   * The reusable workflow is `on: workflow_call` and cannot declare
   * pull-request activity types, so the trigger list is only expressible in the
   * caller — which ships from `create-only` and is never overwritten. That
   * makes this migration the ONLY surface that reaches an already-seeded
   * repository. A template-only fix would leave every existing consumer
   * permanently half-armed.
   */
  describe("body-change re-evaluation", () => {
    /**
     * A seeded caller as it exists in the installed base today.
     * @param types - The `types:` value the caller was seeded with
     */
    async function seedCaller(types: string): Promise<void> {
      await fs.writeFile(
        path.join(projectDir, HEALTH),
        [
          "name: Nightly E2E Health",
          "",
          "on:",
          "  pull_request:",
          "    branches: [dev]",
          "    # applying or removing the bypass label re-evaluates immediately",
          `    types: ${types}`,
          "  workflow_dispatch:",
          "",
          "jobs:",
          "  gate:",
          "    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@v9.8.7",
          "",
        ].join("\n")
      );
    }

    it("arms an installed caller whose trigger list omits edited", async () => {
      await seedCaller("[opened, synchronize, reopened, labeled, unlabeled]");

      expect(await migration.applies(context())).toBe(true);
      expect(await migration.apply(context())).toMatchObject({
        action: "applied",
      });
      expect(
        await fs.readFile(path.join(projectDir, HEALTH), "utf8")
      ).toContain(
        "types: [opened, synchronize, reopened, labeled, unlabeled, edited]"
      );
    });

    it("keeps the comments that say why each trigger is there", async () => {
      await seedCaller("[opened, synchronize, reopened, labeled, unlabeled]");

      await migration.apply(context());

      const after = await fs.readFile(path.join(projectDir, HEALTH), "utf8");
      expect(after).toContain("re-evaluates immediately");
      expect(after).toContain("workflow_dispatch:");
      expect(after).toContain("branches: [dev]");
    });

    it("is a no-op on a caller that is already armed", async () => {
      await seedCaller(
        "[opened, synchronize, reopened, labeled, unlabeled, edited]"
      );
      const before = await fs.readFile(path.join(projectDir, HEALTH), "utf8");

      expect(await migration.applies(context())).toBe(false);
      expect(await migration.apply(context())).toMatchObject({
        action: "noop",
      });
      expect(await fs.readFile(path.join(projectDir, HEALTH), "utf8")).toBe(
        before
      );
    });

    it("preserves activity types the consumer added themselves", async () => {
      await seedCaller("[opened, synchronize, ready_for_review]");

      await migration.apply(context());

      const after = await fs.readFile(path.join(projectDir, HEALTH), "utf8");
      expect(after).toContain("ready_for_review");
      expect(after).toContain("edited");
    });

    it("leaves the report caller's triggers alone", async () => {
      // Only the health caller gates a merge on a waiver. Rewriting triggers
      // in a workflow this defect does not concern is scope the consumer did
      // not ask for.
      await seedCaller(
        "[opened, synchronize, reopened, labeled, unlabeled, edited]"
      );
      const reportSource = [
        "on:",
        "  pull_request:",
        "    types: [opened, synchronize]",
        "jobs: {}",
        "",
      ].join("\n");
      await fs.writeFile(path.join(projectDir, REPORT), reportSource);

      await migration.apply(context());

      expect(await fs.readFile(path.join(projectDir, REPORT), "utf8")).toBe(
        reportSource
      );
    });
  });
});
