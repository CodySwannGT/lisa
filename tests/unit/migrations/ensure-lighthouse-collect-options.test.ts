import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import {
  CURRENT_COLLECT_BLOCK,
  EnsureLighthouseCollectOptionsMigration,
  STALE_COLLECT_BLOCK,
} from "../../../src/migrations/ensure-lighthouse-collect-options.js";
import { createMigrationRegistry } from "../../../src/migrations/index.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CONFIG_FILE = "lighthouserc.js";

describe("EnsureLighthouseCollectOptionsMigration", () => {
  let tempDir: string;
  let projectDir: string;
  let migration: EnsureLighthouseCollectOptionsMigration;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
    migration = new EnsureLighthouseCollectOptionsMigration();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build a migration context for the temporary project.
   *
   * @param detectedTypes - Project stacks the migration should see
   * @param dryRun - Whether writes should be reported without being applied
   * @returns A migration context for this test project
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
   * Write a host-owned Lighthouse file around the supplied collect block.
   *
   * @param block - Collect block to install
   * @returns The complete file contents written
   */
  async function writeConfig(block: string): Promise<string> {
    const content = `const hostMarker = "preserve me";
module.exports = {
  ci: {
${block}
  },
};
`;
    await fs.writeFile(path.join(projectDir, CONFIG_FILE), content);
    return content;
  }

  /**
   * Read the temporary host-owned Lighthouse file.
   *
   * @returns Current file contents
   */
  async function readConfig(): Promise<string> {
    return fs.readFile(path.join(projectDir, CONFIG_FILE), "utf8");
  }

  it("rewrites the exact stale create-only block", async () => {
    await writeConfig(STALE_COLLECT_BLOCK);

    expect(await migration.applies(context())).toBe(true);
    const result = await migration.apply(context());

    expect(result).toMatchObject({
      action: "applied",
      changedFiles: [CONFIG_FILE],
    });
    expect(await readConfig()).toContain(CURRENT_COLLECT_BLOCK);
    expect(await readConfig()).toContain('const hostMarker = "preserve me";');
  });

  it("does not rewrite a host-diverged collect block", async () => {
    const diverged = STALE_COLLECT_BLOCK.replace(
      "numberOfRuns: collect.numberOfRuns,",
      "numberOfRuns: 9,"
    );
    const before = await writeConfig(diverged);

    expect(await migration.applies(context())).toBe(false);
    expect(await migration.apply(context())).toMatchObject({ action: "noop" });
    expect(await readConfig()).toBe(before);
  });

  it("does not apply outside Expo projects", async () => {
    await writeConfig(STALE_COLLECT_BLOCK);

    expect(await migration.applies(context(["typescript"]))).toBe(false);
  });

  it("reports a dry run without changing the file", async () => {
    const before = await writeConfig(STALE_COLLECT_BLOCK);

    expect(await migration.apply(context(["expo"], true))).toMatchObject({
      action: "applied",
      changedFiles: [CONFIG_FILE],
    });
    expect(await readConfig()).toBe(before);
  });

  it("is registered in the default migration set", () => {
    expect(
      createMigrationRegistry()
        .getAll()
        .map(item => item.name)
    ).toContain("ensure-lighthouse-collect-options");
  });
});
