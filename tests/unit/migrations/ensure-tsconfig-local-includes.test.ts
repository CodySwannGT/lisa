import * as fs from "fs-extra";
import * as path from "node:path";
import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsureTsconfigLocalIncludesMigration } from "../../../src/migrations/ensure-tsconfig-local-includes.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const TSCONFIG_LOCAL = "tsconfig.local.json";
const SRC_GLOB = "src/**/*";
const NODE_MODULES = "node_modules";
const TEST_GLOB = "**/*.test.ts";
const SPEC_GLOB = "**/*.spec.ts";

describe("EnsureTsconfigLocalIncludesMigration", () => {
  let migration: EnsureTsconfigLocalIncludesMigration;
  let tempDir: string;
  let lisaDir: string;
  let projectDir: string;

  beforeEach(async () => {
    migration = new EnsureTsconfigLocalIncludesMigration();
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(lisaDir);
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
      lisaDir,
      detectedTypes,
      dryRun,
      logger: new SilentLogger(),
    };
  }

  /**
   * Seed the Lisa template tsconfig.local.json for a given project type
   * @param type - Project type
   * @param template - Template content
   */
  async function seedTemplate(
    type: ProjectType,
    template: unknown
  ): Promise<void> {
    const dir = path.join(lisaDir, type, "create-only");
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, TSCONFIG_LOCAL), template);
  }

  describe("basic properties", () => {
    it("has correct name and description", () => {
      expect(migration.name).toBe("ensure-tsconfig-local-includes");
      expect(migration.description).toContain(TSCONFIG_LOCAL);
    });
  });

  describe("applies()", () => {
    it("returns false when tsconfig.local.json does not exist", async () => {
      expect(await migration.applies(createContext())).toBe(false);
    });

    it("returns true when include is missing", async () => {
      await fs.writeJson(path.join(projectDir, TSCONFIG_LOCAL), {
        compilerOptions: {},
        exclude: [NODE_MODULES],
      });

      expect(await migration.applies(createContext())).toBe(true);
    });

    it("returns true when exclude is missing", async () => {
      await fs.writeJson(path.join(projectDir, TSCONFIG_LOCAL), {
        compilerOptions: {},
        include: [SRC_GLOB],
      });

      expect(await migration.applies(createContext())).toBe(true);
    });

    it("returns false when both include and exclude are present", async () => {
      await fs.writeJson(path.join(projectDir, TSCONFIG_LOCAL), {
        include: [SRC_GLOB],
        exclude: [NODE_MODULES],
      });

      expect(await migration.applies(createContext())).toBe(false);
    });
  });

  describe("apply()", () => {
    it("injects include and exclude from typescript template when both missing", async () => {
      await seedTemplate("typescript", {
        include: [SRC_GLOB],
        exclude: [NODE_MODULES, ".build", "dist", TEST_GLOB, SPEC_GLOB],
      });
      await fs.writeJson(path.join(projectDir, TSCONFIG_LOCAL), {
        compilerOptions: { outDir: "dist" },
      });

      const result = await migration.apply(createContext(["typescript"]));

      expect(result.action).toBe("applied");
      expect(result.changedFiles).toEqual([TSCONFIG_LOCAL]);

      const patched = await fs.readJson(path.join(projectDir, TSCONFIG_LOCAL));
      expect(patched.include).toEqual([SRC_GLOB]);
      expect(patched.exclude).toEqual([
        NODE_MODULES,
        ".build",
        "dist",
        TEST_GLOB,
        SPEC_GLOB,
      ]);
      expect(patched.compilerOptions).toEqual({ outDir: "dist" });
    });

    it("only injects missing include without overriding existing exclude", async () => {
      await seedTemplate("typescript", {
        include: [SRC_GLOB],
        exclude: [NODE_MODULES],
      });
      await fs.writeJson(path.join(projectDir, TSCONFIG_LOCAL), {
        compilerOptions: {},
        exclude: ["custom-exclude"],
      });

      const result = await migration.apply(createContext(["typescript"]));

      expect(result.action).toBe("applied");
      const patched = await fs.readJson(path.join(projectDir, TSCONFIG_LOCAL));
      expect(patched.include).toEqual([SRC_GLOB]);
      expect(patched.exclude).toEqual(["custom-exclude"]);
    });

    it("uses Expo template when detectedTypes contains expo", async () => {
      await seedTemplate("expo", {
        include: ["**/*.ts", "**/*.tsx", "nativewind-env.d.ts"],
        exclude: [NODE_MODULES, "dist", "web-build", "components/ui"],
      });
      await seedTemplate("typescript", {
        include: [SRC_GLOB],
        exclude: [NODE_MODULES],
      });
      await fs.writeJson(path.join(projectDir, TSCONFIG_LOCAL), {
        compilerOptions: {},
      });

      const result = await migration.apply(
        createContext(["typescript", "expo"])
      );

      expect(result.action).toBe("applied");
      const patched = await fs.readJson(path.join(projectDir, TSCONFIG_LOCAL));
      expect(patched.include).toEqual([
        "**/*.ts",
        "**/*.tsx",
        "nativewind-env.d.ts",
      ]);
      expect(patched.exclude).toEqual([
        NODE_MODULES,
        "dist",
        "web-build",
        "components/ui",
      ]);
    });

    it("falls back to built-in defaults when no template is found", async () => {
      await fs.writeJson(path.join(projectDir, TSCONFIG_LOCAL), {
        compilerOptions: {},
      });

      const result = await migration.apply(createContext(["typescript"]));

      expect(result.action).toBe("applied");
      const patched = await fs.readJson(path.join(projectDir, TSCONFIG_LOCAL));
      expect(patched.include).toEqual([SRC_GLOB]);
      expect(patched.exclude).toEqual([
        NODE_MODULES,
        ".build",
        "dist",
        TEST_GLOB,
        SPEC_GLOB,
      ]);
    });

    it("does not modify file in dry-run mode", async () => {
      await seedTemplate("typescript", {
        include: [SRC_GLOB],
        exclude: [NODE_MODULES],
      });
      const original = { compilerOptions: { outDir: "dist" } };
      await fs.writeJson(path.join(projectDir, TSCONFIG_LOCAL), original);

      const result = await migration.apply(createContext(["typescript"], true));

      expect(result.action).toBe("applied");
      const unchanged = await fs.readJson(
        path.join(projectDir, TSCONFIG_LOCAL)
      );
      expect(unchanged).toEqual(original);
    });

    it("is idempotent when run twice", async () => {
      await seedTemplate("typescript", {
        include: [SRC_GLOB],
        exclude: [NODE_MODULES],
      });
      await fs.writeJson(path.join(projectDir, TSCONFIG_LOCAL), {
        compilerOptions: {},
      });

      await migration.apply(createContext(["typescript"]));
      const secondApplies = await migration.applies(
        createContext(["typescript"])
      );
      expect(secondApplies).toBe(false);
    });
  });
});
