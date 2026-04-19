import * as fs from "fs-extra";
import * as path from "node:path";
import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsureAuditIgnoreLocalExclusionsMigration } from "../../../src/migrations/ensure-audit-ignore-local-exclusions.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const AUDIT_CONFIG = "audit.ignore.config.json";
const AUDIT_LOCAL = "audit.ignore.local.json";

const TEMPLATE_IDS = ["TEMPLATE-1", "TEMPLATE-2"];
const PROJECT_ID_A = "PROJECT-A";
const PROJECT_ID_B = "PROJECT-B";

describe("EnsureAuditIgnoreLocalExclusionsMigration", () => {
  let migration: EnsureAuditIgnoreLocalExclusionsMigration;
  let tempDir: string;
  let lisaDir: string;
  let projectDir: string;

  beforeEach(async () => {
    migration = new EnsureAuditIgnoreLocalExclusionsMigration();
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
   * Build a migration context for testing.
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
   * Seed the Lisa template audit.ignore.config.json for a given project type.
   * @param type - Project type
   * @param ids - Exclusion ids shipped by the template
   */
  async function seedTemplate(
    type: ProjectType,
    ids: readonly string[]
  ): Promise<void> {
    const dir = path.join(lisaDir, type, "copy-overwrite");
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, AUDIT_CONFIG), {
      exclusions: ids.map(id => ({ id, package: "pkg", reason: "r" })),
    });
  }

  describe("basic properties", () => {
    it("has correct name and description", () => {
      expect(migration.name).toBe("ensure-audit-ignore-local-exclusions");
      expect(migration.description).toContain(AUDIT_LOCAL);
    });
  });

  describe("beforeStrategies + applies()", () => {
    it("returns false when project has no audit.ignore.config.json", async () => {
      await seedTemplate("typescript", TEMPLATE_IDS);

      await migration.beforeStrategies(createContext());

      expect(await migration.applies(createContext())).toBe(false);
    });

    it("returns false when project file has no project-specific ids (all match template)", async () => {
      await seedTemplate("typescript", TEMPLATE_IDS);
      await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
        exclusions: TEMPLATE_IDS.map(id => ({
          id,
          package: "pkg",
          reason: "r",
        })),
      });

      await migration.beforeStrategies(createContext());

      expect(await migration.applies(createContext())).toBe(false);
    });

    it("returns true when project file has an id missing from template and missing from local", async () => {
      await seedTemplate("typescript", TEMPLATE_IDS);
      await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
        exclusions: [
          ...TEMPLATE_IDS.map(id => ({ id, package: "pkg", reason: "r" })),
          { id: PROJECT_ID_A, package: "pkg-a", reason: "project-specific" },
        ],
      });

      await migration.beforeStrategies(createContext());

      expect(await migration.applies(createContext())).toBe(true);
    });

    it("returns false when project-specific id is already present in audit.ignore.local.json", async () => {
      await seedTemplate("typescript", TEMPLATE_IDS);
      await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
        exclusions: [
          { id: PROJECT_ID_A, package: "pkg-a", reason: "r-from-config" },
        ],
      });
      await fs.writeJson(path.join(projectDir, AUDIT_LOCAL), {
        exclusions: [
          { id: PROJECT_ID_A, package: "pkg-a", reason: "r-from-local" },
        ],
      });

      await migration.beforeStrategies(createContext());

      expect(await migration.applies(createContext())).toBe(false);
    });
  });

  describe("apply()", () => {
    it("relocates a single project-specific exclusion into audit.ignore.local.json", async () => {
      await seedTemplate("typescript", TEMPLATE_IDS);
      const projectSpecific = {
        id: PROJECT_ID_A,
        package: "pkg-a",
        reason: "project-specific",
      };
      await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
        exclusions: [
          ...TEMPLATE_IDS.map(id => ({ id, package: "pkg", reason: "r" })),
          projectSpecific,
        ],
      });
      await fs.writeJson(path.join(projectDir, AUDIT_LOCAL), {
        exclusions: [],
      });

      await migration.beforeStrategies(createContext());
      const result = await migration.apply(createContext());

      expect(result.action).toBe("applied");
      expect(result.changedFiles).toEqual([AUDIT_LOCAL]);
      const patched = await fs.readJson(path.join(projectDir, AUDIT_LOCAL));
      expect(patched.exclusions).toEqual([projectSpecific]);
    });

    it("preserves existing entries in audit.ignore.local.json", async () => {
      await seedTemplate("typescript", TEMPLATE_IDS);
      const existingLocal = {
        id: "EXISTING-LOCAL",
        package: "existing",
        reason: "preserved",
      };
      const projectSpecific = {
        id: PROJECT_ID_A,
        package: "pkg-a",
        reason: "new-from-config",
      };
      await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
        exclusions: [projectSpecific],
      });
      await fs.writeJson(path.join(projectDir, AUDIT_LOCAL), {
        exclusions: [existingLocal],
      });

      await migration.beforeStrategies(createContext());
      const result = await migration.apply(createContext());

      expect(result.action).toBe("applied");
      const patched = await fs.readJson(path.join(projectDir, AUDIT_LOCAL));
      expect(patched.exclusions).toEqual([existingLocal, projectSpecific]);
    });

    it("does not duplicate an id that already exists in audit.ignore.local.json", async () => {
      await seedTemplate("typescript", TEMPLATE_IDS);
      const duplicated = {
        id: PROJECT_ID_A,
        package: "pkg-a",
        reason: "local-wins",
      };
      const newProjectSpecific = {
        id: PROJECT_ID_B,
        package: "pkg-b",
        reason: "brand-new",
      };
      await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
        exclusions: [
          { id: PROJECT_ID_A, package: "pkg-a", reason: "stale-from-config" },
          newProjectSpecific,
        ],
      });
      await fs.writeJson(path.join(projectDir, AUDIT_LOCAL), {
        exclusions: [duplicated],
      });

      await migration.beforeStrategies(createContext());
      const result = await migration.apply(createContext());

      expect(result.action).toBe("applied");
      const patched = await fs.readJson(path.join(projectDir, AUDIT_LOCAL));
      expect(patched.exclusions).toEqual([duplicated, newProjectSpecific]);
    });

    it("returns noop when every project-specific id is already in local", async () => {
      await seedTemplate("typescript", TEMPLATE_IDS);
      await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
        exclusions: [
          { id: PROJECT_ID_A, package: "pkg-a", reason: "already-local" },
        ],
      });
      await fs.writeJson(path.join(projectDir, AUDIT_LOCAL), {
        exclusions: [
          { id: PROJECT_ID_A, package: "pkg-a", reason: "already-local" },
        ],
      });

      await migration.beforeStrategies(createContext());
      const result = await migration.apply(createContext());

      expect(result.action).toBe("noop");
    });

    it("dryRun logs and reports applied without writing the file", async () => {
      await seedTemplate("typescript", TEMPLATE_IDS);
      await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
        exclusions: [{ id: PROJECT_ID_A, package: "pkg-a", reason: "r" }],
      });
      await fs.writeJson(path.join(projectDir, AUDIT_LOCAL), {
        exclusions: [],
      });

      await migration.beforeStrategies(createContext(["typescript"], true));
      const result = await migration.apply(createContext(["typescript"], true));

      expect(result.action).toBe("applied");
      const patched = await fs.readJson(path.join(projectDir, AUDIT_LOCAL));
      expect(patched.exclusions).toEqual([]);
    });

    it("creates audit.ignore.local.json when missing", async () => {
      await seedTemplate("typescript", TEMPLATE_IDS);
      const projectSpecific = {
        id: PROJECT_ID_A,
        package: "pkg-a",
        reason: "r",
      };
      await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
        exclusions: [projectSpecific],
      });

      await migration.beforeStrategies(createContext());
      const result = await migration.apply(createContext());

      expect(result.action).toBe("applied");
      const patched = await fs.readJson(path.join(projectDir, AUDIT_LOCAL));
      expect(patched.exclusions).toEqual([projectSpecific]);
    });

    it("falls back to expo template when typescript is absent from detectedTypes", async () => {
      await seedTemplate("expo", ["EXPO-ONLY"]);
      const projectSpecific = {
        id: PROJECT_ID_A,
        package: "pkg-a",
        reason: "r",
      };
      await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
        exclusions: [
          { id: "EXPO-ONLY", package: "pkg", reason: "shipped" },
          projectSpecific,
        ],
      });

      await migration.beforeStrategies(createContext(["expo"]));
      const result = await migration.apply(createContext(["expo"]));

      expect(result.action).toBe("applied");
      const patched = await fs.readJson(path.join(projectDir, AUDIT_LOCAL));
      expect(patched.exclusions).toEqual([projectSpecific]);
    });

    it("does not migrate when template file is missing for the detected project type", async () => {
      // Template directory exists for typescript but the file itself does not
      const dir = path.join(lisaDir, "typescript", "copy-overwrite");
      await fs.ensureDir(dir);
      // No audit.ignore.config.json written at that path
      await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
        exclusions: [{ id: PROJECT_ID_A, package: "pkg-a", reason: "r" }],
      });

      await migration.beforeStrategies(createContext());

      expect(await migration.applies(createContext())).toBe(false);
    });

    it("throws when audit.ignore.local.json exists but is malformed JSON", async () => {
      await seedTemplate("typescript", TEMPLATE_IDS);
      await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
        exclusions: [{ id: PROJECT_ID_A, package: "pkg-a", reason: "r" }],
      });
      await fs.writeFile(
        path.join(projectDir, AUDIT_LOCAL),
        "{ invalid json }",
        "utf-8"
      );

      await migration.beforeStrategies(createContext());
      await expect(migration.apply(createContext())).rejects.toThrow();
    });

    it("deduplicates additions when snapshot contains duplicate ids", async () => {
      await seedTemplate("typescript", TEMPLATE_IDS);
      const duplicate = { id: PROJECT_ID_A, package: "pkg-a", reason: "dup" };
      await fs.writeJson(path.join(projectDir, AUDIT_CONFIG), {
        exclusions: [duplicate, duplicate],
      });

      await migration.beforeStrategies(createContext());
      const result = await migration.apply(createContext());

      expect(result.action).toBe("applied");
      const patched = await fs.readJson(path.join(projectDir, AUDIT_LOCAL));
      expect(patched.exclusions).toHaveLength(1);
      expect(patched.exclusions[0].id).toBe(PROJECT_ID_A);
    });
  });
});
