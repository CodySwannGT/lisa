import * as fs from "fs-extra";
import * as path from "node:path";
import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { ReconcileClaudeStackPluginsMigration } from "../../../src/migrations/reconcile-claude-stack-plugins.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const SETTINGS_REL_PATH = path.join(".claude", "settings.json");

describe("ReconcileClaudeStackPluginsMigration", () => {
  let migration: ReconcileClaudeStackPluginsMigration;
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    migration = new ReconcileClaudeStackPluginsMigration();
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
    detectedTypes: readonly ProjectType[],
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
   * Write a `.claude/settings.json` into the project directory
   * @param settings - Settings content to serialize
   */
  async function writeSettings(settings: unknown): Promise<void> {
    await fs.outputJson(path.join(projectDir, SETTINGS_REL_PATH), settings);
  }

  /**
   * Read the project's `.claude/settings.json`
   * @returns Parsed settings object
   */
  async function readSettings(): Promise<Record<string, unknown>> {
    return fs.readJson(path.join(projectDir, SETTINGS_REL_PATH));
  }

  describe("basic properties", () => {
    it("has correct name and description", () => {
      expect(migration.name).toBe("reconcile-claude-stack-plugins");
      expect(migration.description).toContain("stack plugins");
    });
  });

  describe("applies()", () => {
    it("returns false when settings.json is absent", async () => {
      expect(await migration.applies(createContext(["typescript"]))).toBe(
        false
      );
    });

    it("returns false when enabledPlugins is absent", async () => {
      await writeSettings({ permissions: {} });
      expect(await migration.applies(createContext(["typescript"]))).toBe(
        false
      );
    });

    it("returns false when stack plugins already match detection", async () => {
      await writeSettings({
        enabledPlugins: {
          "lisa@lisa": true,
          "lisa-typescript@lisa": true,
          "lisa-wiki@lisa": true,
        },
      });
      expect(await migration.applies(createContext(["typescript"]))).toBe(
        false
      );
    });

    it("returns true when a stale stack plugin is present", async () => {
      await writeSettings({
        enabledPlugins: {
          "lisa-typescript@lisa": true,
          "lisa-nestjs@lisa": true,
        },
      });
      expect(await migration.applies(createContext(["typescript"]))).toBe(true);
    });

    it("returns true when a detected stack plugin is missing", async () => {
      await writeSettings({
        enabledPlugins: { "lisa-wiki@lisa": true },
      });
      expect(await migration.applies(createContext(["typescript"]))).toBe(true);
    });
  });

  describe("apply()", () => {
    it("removes a stale typescript plugin from a rails project", async () => {
      await writeSettings({
        enabledPlugins: {
          "lisa@lisa": true,
          "lisa-typescript@lisa": true,
          "lisa-rails@lisa": true,
          "lisa-wiki@lisa": true,
        },
      });

      const result = await migration.apply(createContext(["rails"]));

      expect(result.action).toBe("applied");
      const settings = await readSettings();
      expect(settings.enabledPlugins).toEqual({
        "lisa@lisa": true,
        "lisa-rails@lisa": true,
        "lisa-wiki@lisa": true,
      });
    });

    it("removes a stale nestjs plugin from a typescript-only backend", async () => {
      await writeSettings({
        enabledPlugins: {
          "lisa@lisa": true,
          "lisa-typescript@lisa": true,
          "lisa-nestjs@lisa": true,
          "lisa-wiki@lisa": true,
        },
      });

      const result = await migration.apply(createContext(["typescript"]));

      expect(result.action).toBe("applied");
      const settings = await readSettings();
      expect(settings.enabledPlugins).toEqual({
        "lisa@lisa": true,
        "lisa-typescript@lisa": true,
        "lisa-wiki@lisa": true,
      });
    });

    it("removes all stack plugins when nothing is detected (wiki shell)", async () => {
      await writeSettings({
        enabledPlugins: {
          "lisa@lisa": true,
          "lisa-typescript@lisa": true,
          "lisa-wiki@lisa": true,
        },
      });

      const result = await migration.apply(createContext([]));

      expect(result.action).toBe("applied");
      const settings = await readSettings();
      expect(settings.enabledPlugins).toEqual({
        "lisa@lisa": true,
        "lisa-wiki@lisa": true,
      });
    });

    it("adds a missing detected stack plugin", async () => {
      await writeSettings({
        enabledPlugins: { "lisa-wiki@lisa": true },
      });

      const result = await migration.apply(
        createContext(["npm-package", "typescript"])
      );

      expect(result.action).toBe("applied");
      const settings = await readSettings();
      expect(settings.enabledPlugins).toEqual({
        "lisa-wiki@lisa": true,
        "lisa-typescript@lisa": true,
      });
    });

    it("keeps both parent and child stack plugins for a child stack", async () => {
      await writeSettings({
        enabledPlugins: {
          "lisa-typescript@lisa": true,
          "lisa-expo@lisa": true,
          "lisa-cdk@lisa": true,
        },
      });

      const result = await migration.apply(
        createContext(["typescript", "expo"])
      );

      expect(result.action).toBe("applied");
      const settings = await readSettings();
      expect(settings.enabledPlugins).toEqual({
        "lisa-typescript@lisa": true,
        "lisa-expo@lisa": true,
      });
    });

    it("never touches non-stack and third-party plugins", async () => {
      await writeSettings({
        enabledPlugins: {
          "lisa@lisa": true,
          "lisa-wiki@lisa": true,
          "typescript-lsp@claude-plugins-official": true,
          "coderabbit@claude-plugins-official": true,
          "lisa-cdk@lisa": true,
        },
      });

      await migration.apply(createContext(["typescript"]));

      const settings = await readSettings();
      expect(settings.enabledPlugins).toEqual({
        "lisa@lisa": true,
        "lisa-wiki@lisa": true,
        "typescript-lsp@claude-plugins-official": true,
        "coderabbit@claude-plugins-official": true,
        "lisa-typescript@lisa": true,
      });
    });

    it("preserves an explicit disabled (false) value for a detected stack", async () => {
      await writeSettings({
        enabledPlugins: {
          "lisa-typescript@lisa": false,
          "lisa-nestjs@lisa": true,
        },
      });

      await migration.apply(createContext(["typescript"]));

      const settings = await readSettings();
      expect(settings.enabledPlugins).toEqual({
        "lisa-typescript@lisa": false,
      });
    });

    it("does not write in dry-run mode but reports applied", async () => {
      await writeSettings({
        enabledPlugins: {
          "lisa-typescript@lisa": true,
          "lisa-nestjs@lisa": true,
        },
      });

      const result = await migration.apply(createContext(["typescript"], true));

      expect(result.action).toBe("applied");
      expect(result.changedFiles).toEqual([SETTINGS_REL_PATH]);
      const settings = await readSettings();
      expect(settings.enabledPlugins).toEqual({
        "lisa-typescript@lisa": true,
        "lisa-nestjs@lisa": true,
      });
    });

    it("preserves other top-level settings keys", async () => {
      await writeSettings({
        permissions: { allow: ["Bash"] },
        enabledPlugins: {
          "lisa-typescript@lisa": true,
          "lisa-cdk@lisa": true,
        },
      });

      await migration.apply(createContext(["typescript"]));

      const settings = await readSettings();
      expect(settings.permissions).toEqual({ allow: ["Bash"] });
    });
  });
});
