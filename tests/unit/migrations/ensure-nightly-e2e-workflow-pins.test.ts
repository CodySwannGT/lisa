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
const RELEASE_COMMIT = "1234567890abcdef1234567890abcdef12345678";
const ORPHAN_PIN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const RELEASE_TAG = "v9.8.7";

describe("EnsureNightlyE2EWorkflowPinsMigration", () => {
  let tempDir: string;
  let projectDir: string;
  let migration: EnsureNightlyE2EWorkflowPinsMigration;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(path.join(projectDir, ".github", "workflows"));
    await fs.ensureDir(path.join(projectDir, "scripts"));
    migration = new EnsureNightlyE2EWorkflowPinsMigration(
      () => "9.8.7",
      () => RELEASE_TAG
    );
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

  it("aligns both callers and the health contract comment", async () => {
    await seed();

    expect(await migration.applies(context())).toBe(true);
    expect(await migration.apply(context())).toMatchObject({
      action: "applied",
      changedFiles: [HEALTH, REPORT],
    });
    expect(await fs.readFile(path.join(projectDir, HEALTH), "utf8")).toContain(
      `nightly-e2e-health.yml@${RELEASE_TAG}`
    );
    expect(await fs.readFile(path.join(projectDir, HEALTH), "utf8")).toContain(
      "contract 1.6.0"
    );
    expect(await fs.readFile(path.join(projectDir, REPORT), "utf8")).toContain(
      `nightly-e2e-report.yml@${RELEASE_TAG}`
    );
  });

  it("replaces a well-formed pin that resolves to nothing", async () => {
    await seed();
    await repin(ORPHAN_PIN);

    expect(await migration.apply(context())).toMatchObject({
      action: "applied",
      changedFiles: [HEALTH, REPORT],
    });
    for (const file of [HEALTH, REPORT]) {
      const after = await fs.readFile(path.join(projectDir, file), "utf8");
      expect(after).toContain(`@${RELEASE_TAG}`);
      expect(after).not.toContain(ORPHAN_PIN);
    }
  });

  it("leaves a host-selected branch ref untouched", async () => {
    await seed();
    const healthFile = path.join(projectDir, HEALTH);
    const before = (await fs.readFile(healthFile, "utf8")).replace(
      "nightly-e2e-health.yml@v4.4.21",
      "nightly-e2e-health.yml@main"
    );
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
      changedFiles: [HEALTH, REPORT],
    });
    expect(await fs.readFile(path.join(projectDir, HEALTH), "utf8")).toBe(
      before
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

    expect(workflow).toContain('RELEASE_COMMIT="${{ inputs.release_commit }}"');
    expect(workflow).toContain(
      'npm pkg set lisaReleaseCommit="$RELEASE_COMMIT"'
    );
    expect(workflow).toContain('npm pkg set gitHead="$RELEASE_COMMIT"');
    expect(workflow).toContain('RELEASE_TAG="${{ inputs.tag }}"');
    expect(workflow).toContain('npm pkg set lisaReleaseTag="$RELEASE_TAG"');
  });

  it("refuses to stamp a bare release commit into a caller pin", async () => {
    await seed();
    const commitStamped = new EnsureNightlyE2EWorkflowPinsMigration(
      () => "9.8.7",
      () => RELEASE_COMMIT
    );

    expect(await commitStamped.apply(context())).toMatchObject({
      action: "applied",
      changedFiles: [HEALTH, REPORT],
    });
    for (const file of [HEALTH, REPORT]) {
      const after = await fs.readFile(path.join(projectDir, file), "utf8");
      expect(after).toContain(`@${RELEASE_TAG}`);
      expect(after).not.toContain(RELEASE_COMMIT);
    }
  });

  it("re-stamps a host repin with the tag rather than the release commit", async () => {
    await seed();
    await repin("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const commitStamped = new EnsureNightlyE2EWorkflowPinsMigration(
      () => "9.8.7",
      () => RELEASE_COMMIT
    );

    await commitStamped.apply(context());

    for (const file of [HEALTH, REPORT]) {
      const after = await fs.readFile(path.join(projectDir, file), "utf8");
      expect(after).toContain(`@${RELEASE_TAG}`);
      expect(after).not.toContain(RELEASE_COMMIT);
    }
  });

  it("honours a stamped release tag over the installed version fallback", async () => {
    await seed();
    const tagged = new EnsureNightlyE2EWorkflowPinsMigration(
      () => "9.8.7",
      () => "v4.30.0"
    );

    await tagged.apply(context());

    expect(await fs.readFile(path.join(projectDir, HEALTH), "utf8")).toContain(
      "@v4.30.0"
    );
  });

  it("falls back to the installed version tag when nothing is stamped", async () => {
    await seed();
    await repin(ORPHAN_PIN);
    const unstamped = new EnsureNightlyE2EWorkflowPinsMigration(
      () => "9.8.7",
      () => null
    );

    await unstamped.apply(context());

    expect(await fs.readFile(path.join(projectDir, HEALTH), "utf8")).toContain(
      `@${RELEASE_TAG}`
    );
  });
});
