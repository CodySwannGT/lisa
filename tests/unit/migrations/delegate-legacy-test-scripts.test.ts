/**
 * Coverage for the migration that points Lisa-shipped legacy test aliases at
 * their `lisa-test-run` wrappers (CodySwannGT/lisa#4786).
 * @module tests/unit/migrations/delegate-legacy-test-scripts
 */
import * as path from "node:path";
import * as fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import {
  DelegateLegacyTestScriptsMigration,
  LEGACY_TEST_SCRIPT_VALUES,
} from "../../../src/migrations/delegate-legacy-test-scripts.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** A legacy plain `test` value Lisa once shipped. */
const LEGACY_TEST = "vitest run";
const LEGACY_COV_UNIT =
  "LISA_COVERAGE_SCOPE=unit vitest run --coverage --exclude='**/integration/**'";
const COV_UNIT_WRAPPER =
  "node scripts/lib/worktree-dependencies.mjs && LISA_COVERAGE_SCOPE=unit lisa-test-run --profile cdk --adapter vitest -- vitest run --coverage --exclude='**/integration/**'";

describe("delegate-legacy-test-scripts migration", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => cleanupTempDir(tempDir));

  /**
   * Run the migration against one package.json.
   * @param pkg - package.json contents to start from
   * @param dryRun - Whether to only describe the change
   * @returns The applies() verdict and the package.json afterwards
   */
  async function migrate(
    pkg: Record<string, unknown>,
    dryRun = false
  ): Promise<{
    readonly applies: boolean;
    readonly scripts: Record<string, string>;
  }> {
    await fs.writeJson(path.join(projectDir, "package.json"), pkg);
    const detectedTypes: readonly ProjectType[] = ["cdk"];
    const ctx = {
      projectDir,
      lisaDir: tempDir,
      detectedTypes,
      dryRun,
      logger: new SilentLogger(),
    };
    const migration = new DelegateLegacyTestScriptsMigration();
    const applies = await migration.applies(ctx);
    if (applies) await migration.apply(ctx);
    const after = await fs.readJson(path.join(projectDir, "package.json"));
    return { applies, scripts: after.scripts };
  }

  it("delegates a Lisa-shipped legacy value to its wrapper", async () => {
    const { applies, scripts } = await migrate({
      name: "host",
      scripts: {
        "test:cov:unit": LEGACY_COV_UNIT,
        "test:cov:unit:lisa": COV_UNIT_WRAPPER,
        test: LEGACY_TEST,
        "test:lisa":
          "lisa-test-run --profile cdk --adapter vitest -- vitest run",
      },
    });
    expect(applies).toBe(true);
    expect(scripts["test:cov:unit"]).toBe(
      "$npm_execpath run test:cov:unit:lisa"
    );
    expect(scripts.test).toBe("$npm_execpath run test:lisa");
    expect(scripts["test:cov:unit:lisa"]).toBe(COV_UNIT_WRAPPER);
  });

  it("leaves a customised value alone", async () => {
    const custom = "vitest run --reporter=dot";
    const { applies, scripts } = await migrate({
      name: "host",
      scripts: { test: custom, "test:lisa": "lisa-test-run ..." },
    });
    expect(applies).toBe(false);
    expect(scripts.test).toBe(custom);
  });

  it("leaves a legacy value alone when its wrapper is absent", async () => {
    const { applies, scripts } = await migrate({
      name: "host",
      scripts: { "test:cov:unit": LEGACY_COV_UNIT },
    });
    expect(applies).toBe(false);
    expect(scripts["test:cov:unit"]).toBe(LEGACY_COV_UNIT);
  });

  it("never rewrites Lisa's own package.json", async () => {
    const { applies, scripts } = await migrate({
      name: "@codyswann/lisa",
      scripts: { test: LEGACY_TEST, "test:lisa": "lisa-test-run ..." },
    });
    expect(applies).toBe(false);
    expect(scripts.test).toBe(LEGACY_TEST);
  });

  it("changes nothing on a dry run", async () => {
    const { applies, scripts } = await migrate(
      {
        name: "host",
        scripts: {
          "test:cov:unit": LEGACY_COV_UNIT,
          "test:cov:unit:lisa": COV_UNIT_WRAPPER,
        },
      },
      true
    );
    expect(applies).toBe(true);
    expect(scripts["test:cov:unit"]).toBe(LEGACY_COV_UNIT);
  });

  it("never lists the current delegating form as legacy", () => {
    const offenders = Object.entries(LEGACY_TEST_SCRIPT_VALUES).filter(
      ([alias, values]) => values.includes(`$npm_execpath run ${alias}:lisa`)
    );
    expect(offenders).toEqual([]);
  });
});
