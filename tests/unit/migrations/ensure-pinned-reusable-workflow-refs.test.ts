/**
 * Tests the migration that pins every Lisa reusable-workflow caller at the
 * commit the installed version's tag names, and keeps it pinned.
 *
 * Three of these are the tests the change is actually for, and each one guards
 * a shortcut that would look like a working implementation:
 *
 *   - **the migration arm** — an already-installed project starts at `@main`
 *     and ends pinned. Emitting the new form for fresh installs only would
 *     leave every current caller mutable forever, because every caller workflow
 *     ships create-only and nothing else ever rewrites one.
 *   - **the failing arm** — an unresolvable tag aborts and writes nothing. A
 *     fallback to `@main` here would be invisible in review: the file simply
 *     stays as it was.
 *   - **the registry arm** — the migration is in the default registry. A
 *     pinner nothing runs pins nothing, and every other test in this file
 *     constructs it directly and so cannot see that.
 * @module tests/unit/migrations/ensure-pinned-reusable-workflow-refs
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../../src/core/config.js";
import type { ReleasePinDependencies } from "../../../src/core/lisa-release-pin.js";
import { UnresolvableReleasePinError } from "../../../src/core/lisa-release-pin.js";
import { findReusableWorkflowRefs } from "../../../src/core/reusable-workflow-pin.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsurePinnedReusableWorkflowRefsMigration } from "../../../src/migrations/ensure-pinned-reusable-workflow-refs.js";
import { createMigrationRegistry } from "../../../src/migrations/index.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CI = path.join(".github", "workflows", "ci.yml");
const DEPLOY = path.join(".github", "workflows", "deploy.yml");
const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";

/** The reusable most fixtures call. */
const QUALITY = "quality.yml";

/**
 * A caller workflow pointing at one Lisa reusable at a given ref.
 * @param file - Reusable workflow file name
 * @param ref - The ref the caller points at
 * @returns Workflow YAML
 */
const caller = (file: string, ref: string): string =>
  `name: CI\non:\n  pull_request:\njobs:\n  job:\n    uses: CodySwannGT/lisa/.github/workflows/${file}@${ref}\n    with:\n      branch: main\n`;

describe("EnsurePinnedReusableWorkflowRefsMigration", () => {
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
   * @param over - Fields to replace
   * @returns Dependencies for the migration under test
   */
  function deps(
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
   * Build a migration context for the temporary project.
   * @param detectedTypes - Project stacks visible to the migration
   * @param dryRun - Whether the migration may write
   * @returns Migration context
   */
  function context(
    detectedTypes: readonly ProjectType[] = ["typescript"],
    dryRun = false
  ): MigrationContext {
    return {
      projectDir,
      lisaDir,
      detectedTypes,
      dryRun,
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

  describe("the migration arm — a project already installed at @main", () => {
    it("rewrites @main to the full SHA with its version comment", async () => {
      await fs.writeFile(path.join(projectDir, CI), caller(QUALITY, "main"));
      const migration = new EnsurePinnedReusableWorkflowRefsMigration(deps());

      expect(await migration.applies(context())).toBe(true);
      const result = await migration.apply(context());

      expect(result.action).toBe("applied");
      const after = await read(CI);
      expect(after).toContain(
        `uses: CodySwannGT/lisa/.github/workflows/quality.yml@${SHA} # v4.4.11`
      );
      expect(after).not.toContain("@main");
    });

    it("rewrites a caller frozen at an old version tag", async () => {
      await fs.writeFile(
        path.join(projectDir, CI),
        caller("nightly-e2e-health.yml", "v3.35.0")
      );
      await new EnsurePinnedReusableWorkflowRefsMigration(deps()).apply(
        context()
      );
      expect(await read(CI)).toContain(`@${SHA} # v4.4.11`);
    });

    it("rewrites EVERY caller file, not just the first it finds", async () => {
      await fs.writeFile(path.join(projectDir, CI), caller(QUALITY, "main"));
      await fs.writeFile(
        path.join(projectDir, DEPLOY),
        caller("gates.yml", "main")
      );
      const result = await new EnsurePinnedReusableWorkflowRefsMigration(
        deps()
      ).apply(context());

      expect(result.changedFiles).toHaveLength(2);
      for (const file of [CI, DEPLOY]) {
        expect(findReusableWorkflowRefs(await read(file))[0]?.ref).toBe(SHA);
      }
    });

    it("leaves a project with no Lisa callers alone", async () => {
      await fs.writeFile(
        path.join(projectDir, CI),
        "jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v6\n"
      );
      const migration = new EnsurePinnedReusableWorkflowRefsMigration(deps());
      expect(await migration.applies(context())).toBe(false);
      expect((await migration.apply(context())).action).toBe("noop");
    });
  });

  describe("the version-change arm", () => {
    it("repins when the installed version moves to a different commit", async () => {
      await fs.writeFile(
        path.join(projectDir, CI),
        `    uses: CodySwannGT/lisa/.github/workflows/quality.yml@${SHA} # v4.4.11\n`
      );
      const bumped = new EnsurePinnedReusableWorkflowRefsMigration(
        deps({
          readVersion: () => "4.5.0",
          readStampedCommit: () => OTHER_SHA,
          readStampedTag: () => "v4.5.0",
        })
      );

      expect(await bumped.applies(context())).toBe(true);
      await bumped.apply(context());
      expect(await read(CI)).toContain(`@${OTHER_SHA} # v4.5.0`);
    });

    it("is a no-op when already current — running it again produces an empty diff", async () => {
      await fs.writeFile(path.join(projectDir, CI), caller(QUALITY, "main"));
      const migration = new EnsurePinnedReusableWorkflowRefsMigration(deps());
      await migration.apply(context());
      const afterFirst = await read(CI);

      const second = new EnsurePinnedReusableWorkflowRefsMigration(deps());
      expect(await second.applies(context())).toBe(false);
      expect((await second.apply(context())).action).toBe("noop");
      expect(await read(CI)).toBe(afterFirst);
    });

    it("repairs a stale version comment even when the SHA is already right", async () => {
      await fs.writeFile(
        path.join(projectDir, CI),
        `    uses: CodySwannGT/lisa/.github/workflows/quality.yml@${SHA} # v4.4.10\n`
      );
      const migration = new EnsurePinnedReusableWorkflowRefsMigration(deps());
      expect(await migration.applies(context())).toBe(true);
      await migration.apply(context());
      expect(await read(CI)).toContain("# v4.4.11");
    });

    it("writes nothing in dry-run mode while still reporting the change", async () => {
      await fs.writeFile(path.join(projectDir, CI), caller(QUALITY, "main"));
      const before = await read(CI);
      const result = await new EnsurePinnedReusableWorkflowRefsMigration(
        deps()
      ).apply(context(["typescript"], true));

      expect(result.action).toBe("applied");
      expect(await read(CI)).toBe(before);
    });
  });

  describe("the failing arm — an unresolvable version tag", () => {
    /**
     * Dependencies that resolve the installed version to nothing.
     * @returns Readers that answer with no release identity at all
     */
    const unresolvable = (): ReleasePinDependencies =>
      deps({
        readStampedCommit: () => null,
        readStampedTag: () => null,
        resolveTagCommit: async () => null,
      });

    it("ABORTS with a non-zero outcome rather than pinning something", async () => {
      await fs.writeFile(path.join(projectDir, CI), caller(QUALITY, "main"));
      await expect(
        new EnsurePinnedReusableWorkflowRefsMigration(unresolvable()).apply(
          context()
        )
      ).rejects.toBeInstanceOf(UnresolvableReleasePinError);
    });

    it("leaves the caller file BYTE-IDENTICAL, and never falls back to @main", async () => {
      // The substitution this whole arm exists to forbid. A fallback would be
      // invisible in a diff: the file simply stays on the mutable ref, and the
      // apply reports success.
      const before = caller(QUALITY, "main");
      await fs.writeFile(path.join(projectDir, CI), before);
      await new EnsurePinnedReusableWorkflowRefsMigration(unresolvable())
        .apply(context())
        .catch(() => undefined);
      expect(await read(CI)).toBe(before);
    });

    it("aborts in beforeStrategies, so the abort lands before any file is written", async () => {
      // apply() runs after the copy strategies. Failing there would leave a
      // half-applied project, which is what "leaves the working tree
      // untouched" rules out.
      await fs.writeFile(path.join(projectDir, CI), caller(QUALITY, "main"));
      await expect(
        new EnsurePinnedReusableWorkflowRefsMigration(
          unresolvable()
        ).beforeStrategies(context())
      ).rejects.toBeInstanceOf(UnresolvableReleasePinError);
    });

    it("aborts for a FRESH install too, where the callers are still in the templates", async () => {
      // The project has no workflows yet; the caller arrives when the templates
      // are copied, minutes later. Looking only at the project would let a
      // fresh install past the gate and pin nothing.
      await fs.remove(path.join(projectDir, ".github"));
      const templateDir = path.join(
        lisaDir,
        "typescript",
        "create-only",
        ".github",
        "workflows"
      );
      await fs.ensureDir(templateDir);
      await fs.writeFile(
        path.join(templateDir, "ci.yml"),
        caller(QUALITY, "main")
      );

      await expect(
        new EnsurePinnedReusableWorkflowRefsMigration(
          unresolvable()
        ).beforeStrategies(context())
      ).rejects.toBeInstanceOf(UnresolvableReleasePinError);
    });

    it("does NOT abort a project that has no callers anywhere", async () => {
      // Nothing to pin is not the same fact as a broken installation, and
      // aborting there would make an unreleased checkout unable to apply Lisa
      // to a project that never calls a reusable workflow.
      await fs.writeFile(
        path.join(projectDir, CI),
        "jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v6\n"
      );
      await expect(
        new EnsurePinnedReusableWorkflowRefsMigration(
          unresolvable()
        ).beforeStrategies(context())
      ).resolves.toBeUndefined();
    });
  });

  describe("the registry arm", () => {
    it("is registered in the default migration registry", async () => {
      // Every other test here constructs the migration directly, so none of
      // them can tell a registered pinner from an unregistered one — and an
      // unregistered pinner pins nothing in any real apply.
      const names = createMigrationRegistry()
        .getAll()
        .map(migration => migration.name);
      expect(names).toContain("ensure-pinned-reusable-workflow-refs");
    });

    it("runs LAST, so no later migration can rewrite the ref it just pinned", async () => {
      const names = createMigrationRegistry()
        .getAll()
        .map(migration => migration.name);
      expect(names.at(-1)).toBe("ensure-pinned-reusable-workflow-refs");
    });
  });
});
