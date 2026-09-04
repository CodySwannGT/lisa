import * as fs from "fs-extra";
import * as path from "node:path";
import { AutoAcceptPrompter } from "../../src/cli/prompts.js";
import type { LisaConfig } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import { BackupService } from "../../src/transaction/index.js";
import {
  cleanupTempDir,
  createExpoProject,
  createMockLisaDir,
  createTempDir,
} from "../helpers/test-utils.js";

const WORKFLOWS = path.join(".github", "workflows");

/** Manifest file name the fixture rewrites per case. */
const DELETIONS_JSON = "deletions.json";
const NEEDS_REVIEW = "needs-review";

/**
 * A non-workflow path `createMockLisaDir` declares for deletion.
 *
 * Stands in for the 213 declared paths outside `.github/workflows/`, which the
 * ownership gate does not cover and which are now announced anyway.
 */
const NON_WORKFLOW = ".lisa-manifest";

/** Log prefix every completed removal carries. */
const DELETED_PREFIX = "Deleted:";

/** Reason string used by the forced-deletion cases. */
const FORCED_REASON = "it leaks a token";

/**
 * A workflow the consuming team wrote themselves, at a path a Lisa deletions
 * manifest also names.
 *
 * This is the CodySwannGT/lisa#3656 shape exactly: a real consumer bump removed
 * `auto-update-pr-branches.yml`, `auto-update-pr-branches-dispatch.yml` and
 * `required-checks-drift.yml` — all committed on their default branch, all
 * theirs — because a manifest listed those paths and nothing looked at the
 * bytes.
 */
const HOST_AUTHORED = ".github/workflows/auto-update-pr-branches.yml";

/** A workflow whose header says Lisa seeded it and will not overwrite it. */
const LISA_SEEDED = ".github/workflows/required-checks-drift.yml";

/** A workflow whose header says Lisa replaces it on every run. */
const LISA_MANAGED = ".github/workflows/reusable-claude.yml";

const SEEDED_HEADER = [
  "# Seeded by Lisa on first setup — this file is YOURS.",
  "# Lisa will not overwrite it. (copy-overwrite assets ARE replaced each run.)",
].join("\n");

const MANAGED_HEADER = [
  "# This file is managed by Lisa and IS replaced on each `lisa` run.",
  "# Do not edit directly — durable changes belong upstream in Lisa.",
].join("\n");

/**
 * An event-triggered workflow body. Nothing calls it with a local `uses:`, so
 * the pre-existing reference guard has nothing to say about it — which is
 * precisely why the three real files went: they were entry points, not
 * reusables, and no other workflow vouched for them.
 */
const BODY = [
  "name: Auto-update PR branches",
  "on:",
  "  push:",
  "    branches: [main]",
  "jobs:",
  "  update:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: echo update",
  "",
].join("\n");

/**
 * Logger that keeps the lines an operator would have needed to read.
 */
class RecordingLogger extends SilentLogger {
  public readonly warnings: string[] = [];
  public readonly successes: string[] = [];

  /**
   * Record a warning instead of discarding it
   * @param message - Warning message emitted during apply
   */
  override warn(message: string): void {
    this.warnings.push(message);
  }

  /**
   * Record a success line instead of discarding it
   * @param message - Success message emitted during apply
   */
  override success(message: string): void {
    this.successes.push(message);
  }
}

describe("ownership gate on .github/workflows deletions", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await createMockLisaDir(lisaDir);
    await createExpoProject(destDir);

    await fs.ensureDir(path.join(lisaDir, "expo"));
    // Every path carries a basis so the OWNERSHIP header stays the only thing
    // under test here. Without one the basis gate keeps the path first
    // (CodySwannGT/lisa#3700) and these cases would pass for the wrong reason.
    await fs.writeJson(path.join(lisaDir, "expo", DELETIONS_JSON), {
      paths: [HOST_AUTHORED, LISA_SEEDED, LISA_MANAGED],
      basis: {
        [HOST_AUTHORED]: NEEDS_REVIEW,
        [LISA_SEEDED]: NEEDS_REVIEW,
        [LISA_MANAGED]: NEEDS_REVIEW,
      },
    });

    await fs.ensureDir(path.join(destDir, WORKFLOWS));
    await fs.writeFile(path.join(destDir, HOST_AUTHORED), BODY);
    await fs.writeFile(
      path.join(destDir, LISA_SEEDED),
      `${SEEDED_HEADER}\n\n${BODY}`
    );
    await fs.writeFile(
      path.join(destDir, LISA_MANAGED),
      `${MANAGED_HEADER}\n\n${BODY}`
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build a Lisa instance pointed at the temp project
   * @param logger - Logger to install on the instance
   * @param overrides - Configuration overrides
   * @returns Lisa instance ready to apply
   */
  function createLisa(
    logger: SilentLogger,
    overrides: Partial<LisaConfig> = {}
  ): Lisa {
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
    const deps: LisaDependencies = {
      logger,
      prompter: new AutoAcceptPrompter(),
      backupService: new BackupService(logger),
      detectorRegistry: new DetectorRegistry(),
      strategyRegistry: new StrategyRegistry(),
      gitService: new NoOpGitService(),
      migrationRegistry: new MigrationRegistry(),
    };
    return new Lisa(config, deps);
  }

  it("keeps a host-authored workflow a deletions manifest names", async () => {
    const result = await createLisa(new SilentLogger()).apply();

    expect(result.success).toBe(true);
    expect(await fs.pathExists(path.join(destDir, HOST_AUTHORED))).toBe(true);
  });

  it("leaves the host-authored workflow byte-identical", async () => {
    await createLisa(new SilentLogger()).apply();

    expect(await fs.readFile(path.join(destDir, HOST_AUTHORED), "utf8")).toBe(
      BODY
    );
  });

  it("keeps a workflow Lisa seeded as the consumer's own", async () => {
    await createLisa(new SilentLogger()).apply();

    expect(await fs.pathExists(path.join(destDir, LISA_SEEDED))).toBe(true);
  });

  it("says which workflows it kept and why", async () => {
    const logger = new RecordingLogger();

    await createLisa(logger).apply();

    expect(
      logger.warnings.some(
        message =>
          message.includes(HOST_AUTHORED) && message.includes("cannot prove")
      )
    ).toBe(true);
    expect(
      logger.warnings.some(
        message => message.includes(LISA_SEEDED) && message.includes("yours")
      )
    ).toBe(true);
  });

  it("still retires a workflow whose header says Lisa replaces it", async () => {
    await createLisa(new SilentLogger()).apply();

    expect(await fs.pathExists(path.join(destDir, LISA_MANAGED))).toBe(false);
  });

  it("announces the deletion it is entitled to make", async () => {
    const logger = new RecordingLogger();

    await createLisa(logger).apply();

    expect(
      logger.successes.some(
        message =>
          message.startsWith(DELETED_PREFIX) && message.includes(LISA_MANAGED)
      )
    ).toBe(true);
    // And again in the end-of-run summary, which is the part an operator
    // scrolling an install log actually lands on.
    expect(
      logger.warnings.some(
        message =>
          message.includes(DELETED_PREFIX) && message.includes(LISA_MANAGED)
      )
    ).toBe(true);
  });

  it("carries the deleted path out for the apply receipt", async () => {
    const result = await createLisa(new SilentLogger()).apply();

    expect(result.deletedPaths).toEqual([LISA_MANAGED]);
  });

  it("reports nothing under the workflows tree when nothing was touched", async () => {
    await fs.remove(path.join(destDir, WORKFLOWS));
    const logger = new RecordingLogger();

    await createLisa(logger).apply();

    expect(
      logger.warnings.some(message =>
        message.includes("GitHub Actions workflows touched by this run")
      )
    ).toBe(false);
  });

  it("runs the gate on a postinstall-triggered apply, not just an explicit one", async () => {
    // The trigger that actually bites. `bun install` runs `lisa apply` in
    // consumer repos, so the loss does not need anyone to deliberately bump a
    // pin — an ordinary install picks up whatever the range resolves to. A gate
    // that only sat on the explicit `lisa apply` path would pass its own tests
    // and never run where the damage happens.
    const result = await createLisa(new SilentLogger(), {
      postinstall: true,
    }).apply();

    expect(result.success).toBe(true);
    expect(await fs.pathExists(path.join(destDir, HOST_AUTHORED))).toBe(true);
    expect(await fs.pathExists(path.join(destDir, LISA_SEEDED))).toBe(true);
    expect(await fs.pathExists(path.join(destDir, LISA_MANAGED))).toBe(false);
  });

  it("announces on a postinstall-triggered apply too", async () => {
    const logger = new RecordingLogger();

    await createLisa(logger, { postinstall: true }).apply();

    expect(
      logger.warnings.some(
        message =>
          message.includes(DELETED_PREFIX) && message.includes(LISA_MANAGED)
      )
    ).toBe(true);
  });

  it("forces through even when the consumer edited the file", async () => {
    // The ordering that has to hold. #3599 removed a drift arm because it
    // demanded administration:read and so forced a personal access token into
    // a permanent repository secret, and its suite states in prose that an
    // EDITED consumer copy is deleted deliberately — an edited copy asks for
    // the same token. So the force arm must short-circuit BEFORE any content or
    // modification comparison. A gate of the shape "the bytes differ from what
    // we shipped, so the host has local work here, so preserve it" inverts on
    // exactly the paths where deletion matters most.
    await fs.writeFile(
      path.join(destDir, LISA_SEEDED),
      `${SEEDED_HEADER}\n\n# heavily edited downstream\n${BODY}`
    );
    await fs.writeJson(path.join(lisaDir, "expo", DELETIONS_JSON), {
      paths: [LISA_SEEDED],
      force: { [LISA_SEEDED]: FORCED_REASON },
    });

    await createLisa(new SilentLogger()).apply();

    expect(await fs.pathExists(path.join(destDir, LISA_SEEDED))).toBe(false);
  });

  it("announces a non-workflow deletion the gate never inspects", async () => {
    // 213 of the 255 declared delete paths are not workflows. The ownership
    // gate does not cover them and this change does not widen it — but their
    // removal is no longer silent, which is the half of the defect that costs
    // nothing to fix everywhere.
    await fs.writeFile(path.join(destDir, NON_WORKFLOW), "legacy\n");
    const logger = new RecordingLogger();

    const result = await createLisa(logger).apply();

    expect(result.deletedPaths).toContain(NON_WORKFLOW);
    expect(
      logger.warnings.some(
        message =>
          message.includes(DELETED_PREFIX) && message.includes(NON_WORKFLOW)
      )
    ).toBe(true);
  });

  it("still removes a headerless workflow the manifest forces", async () => {
    // The escape hatch for a removal that is not housekeeping. Two shipped
    // ones are owner rulings against workflows that were actively harmful
    // (#3590, #3599), and those have to reach a consumer's edited copy too —
    // an edited copy jams the same pull requests and asks for the same token.
    await fs.writeJson(path.join(lisaDir, "expo", DELETIONS_JSON), {
      paths: [HOST_AUTHORED],
      force: { [HOST_AUTHORED]: FORCED_REASON },
    });

    await createLisa(new SilentLogger()).apply();

    expect(await fs.pathExists(path.join(destDir, HOST_AUTHORED))).toBe(false);
  });

  it("prints the reason beside a forced removal", async () => {
    // The reason is the whole point of forcing through the gate: a file
    // vanishing with no explanation is the half of #3656 that is a defect even
    // when the deletion itself is correct.
    await fs.writeJson(path.join(lisaDir, "expo", DELETIONS_JSON), {
      paths: [HOST_AUTHORED],
      force: { [HOST_AUTHORED]: FORCED_REASON },
    });
    const logger = new RecordingLogger();

    await createLisa(logger).apply();

    expect(
      logger.warnings.some(
        message =>
          message.includes(HOST_AUTHORED) &&
          message.includes("it leaks a token")
      )
    ).toBe(true);
  });

  it("keeps deleting non-workflow paths the manifest names", async () => {
    // The gate is scoped to .github/workflows on purpose. Everything else the
    // manifests name behaves exactly as it did before.
    await fs.writeFile(path.join(destDir, NON_WORKFLOW), "legacy\n");

    await createLisa(new SilentLogger()).apply();

    expect(await fs.pathExists(path.join(destDir, NON_WORKFLOW))).toBe(false);
  });
});
