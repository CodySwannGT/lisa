/**
 * Tests the one arm of the reusable-workflow pinner that declines to pin: a
 * caller whose callee the installed release does not carry.
 *
 * Split out of `ensure-pinned-reusable-workflow-refs.test.ts` to keep each file
 * inside the project max-lines bar; the subject is the same migration.
 *
 * The defect is narrow and its symptom is not. Pinning assumes the release is a
 * superset of what a consumer references, and a reusable workflow added after
 * the latest release exists only on `main`. Rewriting such a caller to the
 * release commit produces a `uses:` GitHub cannot resolve — a LOAD error, not a
 * job failure. The run creates zero jobs, so it reports zero failures, the
 * error names no workflow, and nothing in the consumer's own diff explains it.
 * Reverting one such rewrite by hand is what the reporting consumer had to do
 * (CodySwannGT/lisa#4021).
 *
 * Two assertions here are the ones a shortcut would fail:
 *
 *   - the rest of the file is still pinned. Refusing the whole file would let
 *     one adopted `main`-only workflow freeze every caller beside it.
 *   - an unrecorded inventory still pins everything. Reading "nobody said" as
 *     "the release carries none" would unpin every caller in every project
 *     running a Lisa published before the inventory was stamped.
 * @module tests/unit/migrations/pinned-reusable-workflow-absent-callee
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReleaseCalleeDependencies } from "../../../src/core/lisa-release-callees.js";
import type { ReleasePinDependencies } from "../../../src/core/lisa-release-pin.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsurePinnedReusableWorkflowRefsMigration } from "../../../src/migrations/ensure-pinned-reusable-workflow-refs.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CI = path.join(".github", "workflows", "ci.yml");
const SHA = "0123456789abcdef0123456789abcdef01234567";

/** The reusable every release in these fixtures carries. */
const QUALITY = "quality.yml";

/** The reusable that exists only on `main`, as in the reported failure. */
const UNRELEASED = "sentry-deploy.yml";

/** The version comment the pin writes beside the SHA. */
const PINNED = `@${SHA} # v4.4.11`;

/**
 * A caller workflow pointing at one Lisa reusable at a given ref.
 * @param file - Reusable workflow file name
 * @param ref - The ref the caller points at
 * @returns Workflow YAML
 */
const caller = (file: string, ref: string): string =>
  `name: CI\non:\n  pull_request:\njobs:\n  job:\n    uses: CodySwannGT/lisa/.github/workflows/${file}@${ref}\n    with:\n      branch: main\n`;

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

/**
 * Callee readers that answer with a fixed release inventory.
 * @param workflows - What the release carries, or null when unrecorded
 * @returns Dependencies for the migration under test
 */
const carrying = (
  workflows: readonly string[] | null
): ReleaseCalleeDependencies => ({
  readStampedWorkflows: () => workflows,
  listWorkflowsAtCommit: async () => null,
});

describe("a caller whose callee no release carries yet", () => {
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
   * Build a migration context for the temporary project.
   * @param logger - Logger the migration reports through
   * @returns Migration context
   */
  const context = (logger = new SilentLogger()): MigrationContext => ({
    projectDir,
    lisaDir,
    detectedTypes: ["typescript"],
    dryRun: false,
    logger,
  });

  /**
   * Read a workflow file back from the project.
   * @param relative - Path relative to the project root
   * @returns File contents
   */
  const read = (relative: string): Promise<string> =>
    fs.readFile(path.join(projectDir, relative), "utf8");

  it("leaves the caller EXACTLY as it was when the release lacks its callee", async () => {
    // The reported defect. A pin at a commit the workflow is absent from is
    // not a wrong pin: Actions resolves `uses:` before creating any job, so
    // the run has zero jobs, zero failures, and names no missing file.
    const before = caller(UNRELEASED, "main");
    await fs.writeFile(path.join(projectDir, CI), before);

    const result = await new EnsurePinnedReusableWorkflowRefsMigration(
      deps(),
      carrying([QUALITY, "gates.yml"])
    ).apply(context());

    expect(await read(CI)).toBe(before);
    expect(result.changedFiles ?? []).toHaveLength(0);
  });

  it("still pins the callers the release DOES carry, in the very same file", async () => {
    // Refusing the whole file would be the easy over-correction: one adopted
    // `main`-only workflow would freeze every other caller beside it.
    await fs.writeFile(
      path.join(projectDir, CI),
      `${caller(QUALITY, "main")}  other:\n    uses: CodySwannGT/lisa/.github/workflows/${UNRELEASED}@main\n`
    );

    await new EnsurePinnedReusableWorkflowRefsMigration(
      deps(),
      carrying([QUALITY])
    ).apply(context());

    const after = await read(CI);
    expect(after).toContain(`${QUALITY}${PINNED}`);
    expect(after).toContain(`${UNRELEASED}@main`);
  });

  it("SAYS which caller it left and why, naming the workflow and the commit", async () => {
    // "This stays on @main because no release carries it yet" is the whole
    // remedy: the consumer can write that comment next to the ref. A silent
    // skip leaves them with the same unexplained state as a silent rewrite.
    await fs.writeFile(path.join(projectDir, CI), caller(UNRELEASED, "main"));
    const warnings: string[] = [];
    const logger = new SilentLogger();
    // Replaces the one method under observation rather than rebuilding the
    // logger, which would go on satisfying ILogger after it grows a method the
    // stand-in silently does not implement.
    logger.warn = (message: string): void => {
      warnings.push(message);
    };

    await new EnsurePinnedReusableWorkflowRefsMigration(
      deps(),
      carrying([QUALITY])
    ).apply(context(logger));

    const said = warnings.join("\n");
    expect(said).toContain(UNRELEASED);
    expect(said).toContain(SHA);
    expect(said).toContain(CI);
  });

  it("stays applicable and reports the skip even when it writes nothing", async () => {
    // `apply` is the only place the reason is stated, and the registry only
    // calls it when `applies` is true. Reporting the skip from a migration
    // that declared itself inapplicable would report it to nobody.
    await fs.writeFile(path.join(projectDir, CI), caller(UNRELEASED, "main"));
    const migration = new EnsurePinnedReusableWorkflowRefsMigration(
      deps(),
      carrying([QUALITY])
    );

    expect(await migration.applies(context())).toBe(true);
    const result = await migration.apply(context());
    expect(result.action).toBe("noop");
    expect(result.message).toContain(UNRELEASED);
  });

  it("pins everything when nobody recorded what the release carries", async () => {
    // Unknown must mean "as before". A package published before the stamp
    // existed records nothing, and reading that as an empty inventory would
    // unpin every caller in every project running one.
    await fs.writeFile(path.join(projectDir, CI), caller(UNRELEASED, "main"));

    await new EnsurePinnedReusableWorkflowRefsMigration(
      deps(),
      carrying(null)
    ).apply(context());

    expect(await read(CI)).toContain(`${UNRELEASED}${PINNED}`);
  });
});
