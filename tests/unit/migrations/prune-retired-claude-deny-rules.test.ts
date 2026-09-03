/**
 * Behavior tests for the retired-deny-rule pruner.
 *
 * The load-bearing case is `applyMigrations()` below: it drives the same
 * registry `lisa apply` drives, against a fixture settings file seeded exactly
 * as an older Lisa left it. Without the migration registered, the retired rule
 * survives and the assertion fails.
 * @module tests/unit/migrations/prune-retired-claude-deny-rules
 */
import * as fs from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { createMigrationRegistry } from "../../../src/migrations/index.js";
import { PruneRetiredClaudeDenyRulesMigration } from "../../../src/migrations/prune-retired-claude-deny-rules.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const SETTINGS_REL_PATH = path.join(".claude", "settings.json");
const RETIRED_RULE = "Read(./.entire/metadata/**)";
/** A host-authored deny rule that must survive every run untouched. */
const HOST_RULE = "Read(/etc/shadow)";

describe("PruneRetiredClaudeDenyRulesMigration", () => {
  let migration: PruneRetiredClaudeDenyRulesMigration;
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    migration = new PruneRetiredClaudeDenyRulesMigration();
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build a migration context for testing.
   * @param dryRun - Whether to run in dry-run mode
   * @returns A migration context suitable for tests
   */
  function createContext(dryRun = false): MigrationContext {
    return {
      projectDir,
      lisaDir: tempDir,
      detectedTypes: ["typescript"],
      dryRun,
      logger: new SilentLogger(),
    };
  }

  /**
   * Write raw text to the project's `.claude/settings.json`.
   * @param text - Exact file content to write
   */
  async function writeSettingsText(text: string): Promise<void> {
    const target = path.join(projectDir, SETTINGS_REL_PATH);
    await fs.ensureDir(path.dirname(target));
    await writeFile(target, text, "utf-8");
  }

  /**
   * Read the project's `.claude/settings.json` as raw text.
   * @returns Exact file content
   */
  async function readSettingsText(): Promise<string> {
    return readFile(path.join(projectDir, SETTINGS_REL_PATH), "utf-8");
  }

  /**
   * Read the project's `.claude/settings.json` as parsed JSON.
   * @returns Parsed settings object
   */
  async function readSettings(): Promise<Record<string, unknown>> {
    return fs.readJson(path.join(projectDir, SETTINGS_REL_PATH));
  }

  /**
   * Serialize a settings object the way Lisa writes JSON (2-space, trailing
   * newline), so a fixture written through it round-trips byte-for-byte.
   * @param settings - Settings object to serialize
   * @returns Canonical JSON text
   */
  function canonicalJson(settings: unknown): string {
    return `${JSON.stringify(settings, null, 2)}\n`;
  }

  /**
   * Run the full default migration registry — the same one `lisa apply` uses.
   */
  async function applyMigrations(): Promise<void> {
    const registry = createMigrationRegistry();
    await registry.runAll(createContext());
  }

  describe("basic properties", () => {
    it("has correct name and description", () => {
      expect(migration.name).toBe("prune-retired-claude-deny-rules");
      expect(migration.description).toContain("deny rules");
    });

    it("is registered in the default migration registry", () => {
      const names = createMigrationRegistry()
        .getAll()
        .map(entry => entry.name);
      expect(names).toContain("prune-retired-claude-deny-rules");
    });
  });

  describe("applies()", () => {
    it("returns false when settings.json is absent", async () => {
      expect(await migration.applies(createContext())).toBe(false);
    });

    it("returns false when permissions is absent", async () => {
      await writeSettingsText(canonicalJson({ enabledPlugins: {} }));
      expect(await migration.applies(createContext())).toBe(false);
    });

    it("returns false when deny holds no retired rule", async () => {
      await writeSettingsText(
        canonicalJson({ permissions: { deny: ["Read(/etc/**)"] } })
      );
      expect(await migration.applies(createContext())).toBe(false);
    });

    it("returns false when deny is not an array", async () => {
      await writeSettingsText(
        canonicalJson({ permissions: { deny: RETIRED_RULE } })
      );
      expect(await migration.applies(createContext())).toBe(false);
    });

    it("returns true when deny holds the retired rule", async () => {
      await writeSettingsText(
        canonicalJson({ permissions: { deny: [RETIRED_RULE] } })
      );
      expect(await migration.applies(createContext())).toBe(true);
    });
  });

  describe("apply() through the default registry", () => {
    it("removes the retired rule from an already-seeded project", async () => {
      await writeSettingsText(
        canonicalJson({
          permissions: {
            allow: ["Bash(git status)"],
            deny: [RETIRED_RULE],
            ask: ["Bash(git push:*)"],
          },
        })
      );

      await applyMigrations();

      const settings = await readSettings();
      const permissions = settings.permissions as Record<string, unknown>;
      expect(permissions.deny).toEqual([]);
    });
  });

  describe("surgical rewrite", () => {
    it("leaves every other byte of the file untouched", async () => {
      const before = {
        env: { LISA_FOO: "bar" },
        enabledPlugins: { "lisa@lisa": true },
        permissions: {
          allow: ["Bash(git status)", "Read(//absolute/**)"],
          deny: [HOST_RULE, RETIRED_RULE, "Bash(rm -rf /)"],
          ask: ["Bash(git push:*)"],
        },
        hooks: { PreToolUse: [] },
      };
      const expected = {
        ...before,
        permissions: {
          ...before.permissions,
          deny: [HOST_RULE, "Bash(rm -rf /)"],
        },
      };
      await writeSettingsText(canonicalJson(before));

      // Driven directly rather than through the registry: sibling migrations
      // legitimately edit other keys of this same file (stack-plugin
      // reconciliation adds `enabledPlugins` entries), which would mask what
      // this assertion is about — that THIS migration changes nothing else.
      await migration.apply(createContext());

      expect(await readSettingsText()).toBe(canonicalJson(expected));
    });
  });

  describe("apply() directly", () => {
    it("is a no-op on a project that never had the rule", async () => {
      const text = canonicalJson({
        permissions: { deny: [HOST_RULE] },
      });
      await writeSettingsText(text);

      const result = await migration.apply(createContext());

      expect(result.action).toBe("noop");
      expect(await readSettingsText()).toBe(text);
    });

    it("is idempotent across repeated runs", async () => {
      await writeSettingsText(
        canonicalJson({
          permissions: { deny: [RETIRED_RULE, "Read(/etc/**)"] },
        })
      );

      const first = await migration.apply(createContext());
      const afterFirst = await readSettingsText();
      const second = await migration.apply(createContext());

      expect(first.action).toBe("applied");
      expect(second.action).toBe("noop");
      expect(await readSettingsText()).toBe(afterFirst);
      expect(await migration.applies(createContext())).toBe(false);
    });

    it("reports the removed rule and the changed file", async () => {
      await writeSettingsText(
        canonicalJson({ permissions: { deny: [RETIRED_RULE] } })
      );

      const result = await migration.apply(createContext());

      expect(result.changedFiles).toEqual([SETTINGS_REL_PATH]);
      expect(result.message).toContain(RETIRED_RULE);
    });

    it("writes nothing in dry-run mode", async () => {
      const text = canonicalJson({ permissions: { deny: [RETIRED_RULE] } });
      await writeSettingsText(text);

      const result = await migration.apply(createContext(true));

      expect(result.action).toBe("applied");
      expect(await readSettingsText()).toBe(text);
    });

    it("leaves a malformed settings file byte-for-byte alone and warns", async () => {
      const malformed = '{ "permissions": { "deny": [ ';
      await writeSettingsText(malformed);
      const logger = new SilentLogger();
      const warn = vi.spyOn(logger, "warn");

      const shouldRun = await migration.applies({
        ...createContext(),
        logger,
      });

      expect(shouldRun).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(SETTINGS_REL_PATH)
      );
      expect(await readSettingsText()).toBe(malformed);
    });

    it("does not warn when the settings file is simply absent", async () => {
      const logger = new SilentLogger();
      const warn = vi.spyOn(logger, "warn");

      await migration.applies({ ...createContext(), logger });

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
