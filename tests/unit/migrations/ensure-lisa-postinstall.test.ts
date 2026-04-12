import * as fs from "fs-extra";
import * as path from "node:path";
import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsureLisaPostinstallMigration } from "../../../src/migrations/ensure-lisa-postinstall.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LISA_INVOCATION =
  "node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check . 2>/dev/null || true";
const PACKAGE_JSON = "package.json";
const PATCH_PACKAGE = "patch-package";

describe("EnsureLisaPostinstallMigration", () => {
  let migration: EnsureLisaPostinstallMigration;
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    migration = new EnsureLisaPostinstallMigration();
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
    detectedTypes: readonly ProjectType[] = ["typescript", "expo"],
    dryRun = false
  ): MigrationContext {
    return {
      projectDir,
      lisaDir: tempDir,
      detectedTypes,
      dryRun,
      logger: new SilentLogger(),
    };
  }

  /**
   * Write a package.json to the project directory
   * @param data - Content to serialize
   */
  async function writePackageJson(data: unknown): Promise<void> {
    await fs.writeJson(path.join(projectDir, PACKAGE_JSON), data);
  }

  describe("basic properties", () => {
    it("has correct name and description", () => {
      expect(migration.name).toBe("ensure-lisa-postinstall");
      expect(migration.description).toContain("postinstall");
    });
  });

  describe("applies()", () => {
    it("returns false when detectedTypes is empty", async () => {
      await writePackageJson({ scripts: {} });
      expect(await migration.applies(createContext([]))).toBe(false);
    });

    it("returns false when project is Rails-only (no Node postinstall)", async () => {
      await writePackageJson({ scripts: {} });
      expect(await migration.applies(createContext(["rails"]))).toBe(false);
    });

    it("returns true for typescript-only project missing Lisa in postinstall", async () => {
      await writePackageJson({
        scripts: { postinstall: "patch-package && bun run generate:css" },
      });
      expect(await migration.applies(createContext(["typescript"]))).toBe(true);
    });

    it("returns true for nestjs project", async () => {
      await writePackageJson({ scripts: {} });
      expect(
        await migration.applies(createContext(["typescript", "nestjs"]))
      ).toBe(true);
    });

    it("returns true for cdk project", async () => {
      await writePackageJson({ scripts: {} });
      expect(
        await migration.applies(createContext(["typescript", "cdk"]))
      ).toBe(true);
    });

    it("returns true for npm-package project", async () => {
      await writePackageJson({ scripts: {} });
      expect(
        await migration.applies(createContext(["typescript", "npm-package"]))
      ).toBe(true);
    });

    it("returns false when package.json does not exist", async () => {
      expect(await migration.applies(createContext())).toBe(false);
    });

    it("returns true when postinstall is missing", async () => {
      await writePackageJson({ scripts: { test: "vitest" } });
      expect(await migration.applies(createContext())).toBe(true);
    });

    it("returns true when postinstall lacks Lisa invocation", async () => {
      await writePackageJson({
        scripts: { postinstall: "patch-package && generate:css" },
      });
      expect(await migration.applies(createContext())).toBe(true);
    });

    it("returns false when postinstall already contains Lisa invocation", async () => {
      await writePackageJson({
        scripts: { postinstall: LISA_INVOCATION },
      });
      expect(await migration.applies(createContext())).toBe(false);
    });

    it("returns false when postinstall contains Lisa invocation alongside other commands", async () => {
      await writePackageJson({
        scripts: {
          postinstall: `${LISA_INVOCATION} && patch-package`,
        },
      });
      expect(await migration.applies(createContext())).toBe(false);
    });
  });

  describe("apply()", () => {
    it("sets postinstall when none exists", async () => {
      await writePackageJson({
        name: "demo",
        scripts: { test: "vitest" },
      });

      const result = await migration.apply(createContext());

      expect(result.action).toBe("applied");
      expect(result.changedFiles).toEqual([PACKAGE_JSON]);
      const pkg = await fs.readJson(path.join(projectDir, PACKAGE_JSON));
      expect(pkg.scripts.postinstall).toBe(LISA_INVOCATION);
      expect(pkg.scripts.test).toBe("vitest");
      expect(pkg.name).toBe("demo");
    });

    it("prepends Lisa invocation to existing custom postinstall", async () => {
      await writePackageJson({
        scripts: { postinstall: "patch-package && generate:css" },
      });

      const result = await migration.apply(createContext());

      expect(result.action).toBe("applied");
      const pkg = await fs.readJson(path.join(projectDir, PACKAGE_JSON));
      expect(pkg.scripts.postinstall).toBe(
        `${LISA_INVOCATION} && patch-package && generate:css`
      );
    });

    it("prepends Lisa invocation for typescript-only project with custom postinstall", async () => {
      await writePackageJson({
        scripts: { postinstall: "patch-package && bun run generate:css" },
      });

      const result = await migration.apply(createContext(["typescript"]));

      expect(result.action).toBe("applied");
      const pkg = await fs.readJson(path.join(projectDir, PACKAGE_JSON));
      expect(pkg.scripts.postinstall).toBe(
        `${LISA_INVOCATION} && patch-package && bun run generate:css`
      );
    });

    it("does not modify file in dry-run mode", async () => {
      const original = {
        scripts: { postinstall: PATCH_PACKAGE },
      };
      await writePackageJson(original);

      const result = await migration.apply(createContext(["expo"], true));

      expect(result.action).toBe("applied");
      const unchanged = await fs.readJson(path.join(projectDir, PACKAGE_JSON));
      expect(unchanged.scripts.postinstall).toBe(PATCH_PACKAGE);
    });

    it("is idempotent when run twice", async () => {
      await writePackageJson({
        scripts: { postinstall: PATCH_PACKAGE },
      });

      await migration.apply(createContext());
      const shouldRunAgain = await migration.applies(createContext());
      expect(shouldRunAgain).toBe(false);
    });
  });
});
