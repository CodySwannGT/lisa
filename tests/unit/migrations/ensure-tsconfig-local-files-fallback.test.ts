import * as fs from "fs-extra";
import * as path from "node:path";
import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsureTsconfigLocalFilesFallbackMigration } from "../../../src/migrations/ensure-tsconfig-local-files-fallback.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const TSCONFIG_LOCAL = "tsconfig.local.json";
const SRC_GLOB = "src/**/*";
const NODE_MODULES = "node_modules";

describe("EnsureTsconfigLocalFilesFallbackMigration", () => {
  let migration: EnsureTsconfigLocalFilesFallbackMigration;
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    migration = new EnsureTsconfigLocalFilesFallbackMigration();
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build a migration context for testing
   * @param detectedTypes - Detected project types
   * @param dryRun - Whether to run in dry-run mode
   * @returns A migration context suitable for tests
   */
  function createContext(
    detectedTypes: readonly ProjectType[] = ["typescript"],
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

  describe("basic properties", () => {
    it("has correct name and description", () => {
      expect(migration.name).toBe("ensure-tsconfig-local-files-fallback");
      expect(migration.description).toContain(TSCONFIG_LOCAL);
    });
  });

  describe("applies()", () => {
    it("returns false when tsconfig.local.json does not exist", async () => {
      expect(await migration.applies(createContext())).toBe(false);
    });

    it("returns true when files key is absent", async () => {
      await fs.writeJson(path.join(projectDir, TSCONFIG_LOCAL), {
        include: [SRC_GLOB],
        exclude: [NODE_MODULES],
      });

      expect(await migration.applies(createContext())).toBe(true);
    });

    it("returns false when files key is already present", async () => {
      await fs.writeJson(path.join(projectDir, TSCONFIG_LOCAL), {
        include: [SRC_GLOB],
        files: [],
      });

      expect(await migration.applies(createContext())).toBe(false);
    });
  });

  describe("apply()", () => {
    it("injects an empty files array when absent", async () => {
      await fs.writeJson(path.join(projectDir, TSCONFIG_LOCAL), {
        compilerOptions: { outDir: "dist", rootDir: "src" },
        include: [SRC_GLOB],
        exclude: [NODE_MODULES],
      });

      const result = await migration.apply(createContext());

      expect(result.action).toBe("applied");
      expect(result.changedFiles).toEqual([TSCONFIG_LOCAL]);

      const patched = await fs.readJson(path.join(projectDir, TSCONFIG_LOCAL));
      expect(patched.files).toEqual([]);
      // existing keys are preserved untouched
      expect(patched.include).toEqual([SRC_GLOB]);
      expect(patched.exclude).toEqual([NODE_MODULES]);
      expect(patched.compilerOptions).toEqual({
        outDir: "dist",
        rootDir: "src",
      });
    });

    it("preserves a project's existing non-empty files list", async () => {
      await fs.writeJson(path.join(projectDir, TSCONFIG_LOCAL), {
        include: [SRC_GLOB],
        files: ["src/index.ts"],
      });

      const result = await migration.apply(createContext());

      expect(result.action).toBe("noop");
      const unchanged = await fs.readJson(
        path.join(projectDir, TSCONFIG_LOCAL)
      );
      expect(unchanged.files).toEqual(["src/index.ts"]);
    });

    it("does not modify file in dry-run mode", async () => {
      const original = { include: [SRC_GLOB], exclude: [NODE_MODULES] };
      await fs.writeJson(path.join(projectDir, TSCONFIG_LOCAL), original);

      const result = await migration.apply(createContext(["typescript"], true));

      expect(result.action).toBe("applied");
      const unchanged = await fs.readJson(
        path.join(projectDir, TSCONFIG_LOCAL)
      );
      expect(unchanged).toEqual(original);
    });

    it("is idempotent when run twice", async () => {
      await fs.writeJson(path.join(projectDir, TSCONFIG_LOCAL), {
        include: [SRC_GLOB],
        exclude: [NODE_MODULES],
      });

      await migration.apply(createContext());
      const secondApplies = await migration.applies(createContext());
      expect(secondApplies).toBe(false);
    });
  });
});
