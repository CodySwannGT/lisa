/**
 * A `deletions.json` entry retiring a file Lisa seeded removes the consumer's
 * copy only while it still holds bytes Lisa shipped (CodySwannGT/lisa#4393).
 *
 * Before this, the workflow ownership gate refused every create-only seed —
 * all of them carry the "this file is YOURS" header — so the retired
 * PAT-dependent `lisa-update.yml` survived in every host, and a removed
 * `scripts/` executable had no deletion mechanism at all.
 * @module tests/integration/retire-unmodified-deletion
 */
import { createHash } from "node:crypto";
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

const WORKFLOW = ".github/workflows/lisa-update.yml";
const SCRIPT = "scripts/lisa-self-update.mjs";
const LEGACY = "legacy: retired in a test";

const SEEDED = [
  "# Seeded by Lisa on first setup — this file is YOURS.",
  "# Lisa will not overwrite it. (copy-overwrite assets ARE replaced each run.)",
  "name: Lisa Update",
  "on:",
  "  schedule:",
  "    - cron: '0 6 * * *'",
  "jobs:",
  "  update:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  `      - run: node ${SCRIPT}`,
  "",
].join("\n");
const SCRIPT_BODY = "// Lisa self-update\nconsole.log('update');\n";

const sha256 = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/** Logger keeping what an operator would read. */
class RecordingLogger extends SilentLogger {
  public readonly warnings: string[] = [];
  public readonly successes: string[] = [];

  /**
   * Record a warning
   * @param message - Warning
   */
  override warn(message: string): void {
    this.warnings.push(message);
  }

  /**
   * Record a success
   * @param message - Success line
   */
  override success(message: string): void {
    this.successes.push(message);
  }
}

describe("retiring unedited Lisa seeds through deletions.json", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  /**
   * Write the manifest under test.
   * @param retire - The `retireUnmodified` map
   * @param extra - Further manifest fields
   */
  async function manifest(
    retire: Record<string, string[]>,
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    await fs.ensureDir(path.join(lisaDir, "expo"));
    await fs.writeJson(path.join(lisaDir, "expo", "deletions.json"), {
      paths: [WORKFLOW, SCRIPT],
      basis: { [WORKFLOW]: LEGACY, [SCRIPT]: LEGACY },
      retireUnmodified: retire,
      ...extra,
    });
  }

  /**
   * Run a full apply against the fixture.
   * @param logger - Logger to record into
   * @returns The apply result
   */
  async function apply(logger: SilentLogger = new SilentLogger()) {
    const config: LisaConfig = {
      lisaDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
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
    return new Lisa(config, deps).apply();
  }

  const exists = (relative: string): Promise<boolean> =>
    fs.pathExists(path.join(destDir, relative));

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await createMockLisaDir(lisaDir);
    await createExpoProject(destDir);
    await fs.outputFile(path.join(destDir, WORKFLOW), SEEDED);
    await fs.outputFile(path.join(destDir, SCRIPT), SCRIPT_BODY);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("deletes an unedited seeded workflow despite its YOURS header, and the script it ran", async () => {
    await manifest({
      [WORKFLOW]: [sha256(SEEDED)],
      [SCRIPT]: [sha256(SCRIPT_BODY)],
    });
    const logger = new RecordingLogger();

    const result = await apply(logger);

    expect(await exists(WORKFLOW)).toBe(false);
    expect(await exists(SCRIPT)).toBe(false);
    expect(result.deletedPaths).toEqual([WORKFLOW, SCRIPT]);
    expect(
      logger.successes.some(
        line =>
          line.startsWith("Deleted:") &&
          line.includes(WORKFLOW) &&
          line.includes("unedited copy")
      )
    ).toBe(true);
  });

  it("deletes a copy whose only difference is CRLF line endings", async () => {
    await fs.writeFile(
      path.join(destDir, WORKFLOW),
      SEEDED.replaceAll("\n", "\r\n")
    );
    await manifest({ [WORKFLOW]: [sha256(SEEDED)], [SCRIPT]: [] });

    await apply();

    expect(await exists(WORKFLOW)).toBe(false);
  });

  it("keeps an edited seed, says why, and keeps the script it still calls", async () => {
    const edited = `${SEEDED}# my own change\n`;
    await fs.writeFile(path.join(destDir, WORKFLOW), edited);
    await manifest({
      [WORKFLOW]: [sha256(SEEDED)],
      [SCRIPT]: [sha256(SCRIPT_BODY)],
    });
    const logger = new RecordingLogger();

    const result = await apply(logger);

    expect(await fs.readFile(path.join(destDir, WORKFLOW), "utf8")).toBe(
      edited
    );
    expect(await exists(SCRIPT)).toBe(true);
    expect(result.deletedPaths).toEqual([]);
    expect(
      logger.warnings.some(
        line =>
          line.includes(`Kept ${WORKFLOW}`) &&
          line.includes("differs from every version Lisa shipped")
      )
    ).toBe(true);
    expect(
      logger.warnings.some(
        line => line.includes(`Kept ${SCRIPT}`) && line.includes(WORKFLOW)
      )
    ).toBe(true);
  });

  it("keeps an unedited script the host's package.json still runs", async () => {
    const manifestPath = path.join(destDir, "package.json");
    const pkg = await fs.readJson(manifestPath);
    await fs.writeJson(manifestPath, {
      ...pkg,
      scripts: { ...pkg.scripts, "lisa:update": `node ${SCRIPT}` },
    });
    await manifest({ [WORKFLOW]: [], [SCRIPT]: [sha256(SCRIPT_BODY)] });
    const logger = new RecordingLogger();

    await apply(logger);

    expect(await exists(SCRIPT)).toBe(true);
    expect(
      logger.warnings.some(
        line => line.includes(`Kept ${SCRIPT}`) && line.includes("package.json")
      )
    ).toBe(true);
  });

  it("keeps a listed path that has no usable digest", async () => {
    await manifest({ [WORKFLOW]: ["not-a-digest"], [SCRIPT]: [] });

    await apply();

    expect(await exists(WORKFLOW)).toBe(true);
  });

  it("leaves a path without a retireUnmodified entry to the ownership gate", async () => {
    await manifest({});
    const logger = new RecordingLogger();

    await apply(logger);

    expect(await exists(WORKFLOW)).toBe(true);
    expect(
      logger.warnings.some(
        line => line.includes(WORKFLOW) && line.includes("yours")
      )
    ).toBe(true);
  });

  it("lets a force reason outrank the unmodified-only rule", async () => {
    await fs.writeFile(path.join(destDir, WORKFLOW), `${SEEDED}# edited\n`);
    await manifest(
      { [WORKFLOW]: [sha256(SEEDED)] },
      { force: { [WORKFLOW]: "it leaks a token" } }
    );

    await apply();

    expect(await exists(WORKFLOW)).toBe(false);
  });
});
