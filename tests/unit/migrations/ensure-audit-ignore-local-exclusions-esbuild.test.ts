import * as fs from "fs-extra";
import * as path from "node:path";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsureAuditIgnoreLocalExclusionsMigration } from "../../../src/migrations/ensure-audit-ignore-local-exclusions.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const AUDIT_CONFIG = "audit.ignore.config.json";
const AUDIT_LOCAL = "audit.ignore.local.json";
const ESBUILD_GHSA = "GHSA-gv7w-rqvm-qjhr";

describe("esbuild audit exclusion migration", () => {
  let migration: EnsureAuditIgnoreLocalExclusionsMigration;
  let tempDir: string;
  let lisaDir: string;
  let projectDir: string;

  beforeEach(async () => {
    migration = new EnsureAuditIgnoreLocalExclusionsMigration();
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(path.join(lisaDir, "typescript", "copy-overwrite"));
    await fs.ensureDir(projectDir);
    await fs.writeJson(
      path.join(lisaDir, "typescript", "copy-overwrite", AUDIT_CONFIG),
      { exclusions: [] }
    );
  });

  afterEach(async () => cleanupTempDir(tempDir));

  /**
   * Build a migration context for the disposable host.
   * @returns Migration context rooted in the test fixture
   */
  function context(): MigrationContext {
    return {
      projectDir,
      lisaDir,
      detectedTypes: ["typescript"],
      dryRun: false,
      logger: new SilentLogger(),
    };
  }

  /**
   * Seed the host's enforced and installed esbuild versions.
   * @param range - Package-manager constraint
   * @param version - Installed esbuild version
   */
  async function seedEsbuild(range: string, version: string): Promise<void> {
    await fs.writeJson(path.join(projectDir, "package.json"), {
      overrides: { esbuild: range },
      resolutions: { esbuild: range },
    });
    await fs.ensureDir(path.join(projectDir, "node_modules", "esbuild"));
    await fs.writeJson(
      path.join(projectDir, "node_modules", "esbuild", "package.json"),
      { name: "esbuild", version }
    );
  }

  it("does not emit the stale exclusion when enforcement and installation are patched", async () => {
    await seedEsbuild(">=0.28.1", "0.28.1");
    await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
      exclusions: [{ id: ESBUILD_GHSA, package: "esbuild", reason: "old" }],
    });

    await migration.beforeStrategies(context());

    expect(await migration.applies(context())).toBe(false);
    expect((await migration.apply(context())).action).toBe("noop");
    expect(await fs.pathExists(path.join(projectDir, AUDIT_LOCAL))).toBe(false);
  });

  it("removes an existing stale exclusion when enforcement and installation are patched", async () => {
    await seedEsbuild("^0.28.1", "0.28.2");
    const retained = {
      id: "KEEP-ME",
      package: "other",
      reason: "still applicable",
    };
    await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
      exclusions: [{ id: ESBUILD_GHSA, package: "esbuild", reason: "old" }],
    });
    await fs.writeJson(path.join(projectDir, AUDIT_LOCAL), {
      exclusions: [
        retained,
        { id: ESBUILD_GHSA, package: "esbuild", reason: "generated" },
      ],
    });

    await migration.beforeStrategies(context());

    expect(await migration.applies(context())).toBe(true);
    expect((await migration.apply(context())).action).toBe("applied");
    expect(await fs.readJson(path.join(projectDir, AUDIT_LOCAL))).toEqual({
      exclusions: [retained],
    });
  });

  it("retains and relocates the exclusion while the enforced installation is vulnerable", async () => {
    await seedEsbuild("^0.27.0", "0.27.4");
    const exclusion = {
      id: ESBUILD_GHSA,
      package: "esbuild",
      reason: "vulnerable installation",
    };
    await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
      exclusions: [exclusion],
    });

    await migration.beforeStrategies(context());

    expect(await migration.applies(context())).toBe(true);
    expect((await migration.apply(context())).action).toBe("applied");
    expect(await fs.readJson(path.join(projectDir, AUDIT_LOCAL))).toEqual({
      exclusions: [exclusion],
    });
  });
});
