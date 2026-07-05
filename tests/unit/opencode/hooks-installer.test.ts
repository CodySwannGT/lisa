/**
 * Unit tests for the OpenCode hooks installer.
 *
 * Covers the two delivery surfaces: `opencode.json` `permission.bash` deny rules
 * (the block-no-verify port) and the `.opencode/plugin/lisa-*.ts` modules (the
 * runtime-behavior hooks), including project-type gating, stale cleanup, and the
 * non-destructive config merge.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OPENCODE_EAGER_RULES_INSTRUCTION,
  OPENCODE_CONFIG_FILENAME,
  OPENCODE_LISA_RULES_SUBDIR,
  OPENCODE_PLUGIN_SUBDIR,
  installHooks,
  listInstalledPluginFiles,
} from "../../../src/opencode/hooks-installer.js";
import { OPENCODE_CONFIG_DIR } from "../../../src/opencode/manifest.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Plugin template basenames (de-duplicated for sonarjs/no-duplicate-string). */
const SESSION = "lisa-session-bootstrap.ts";
const LINT = "lisa-lint-on-edit.ts";
const SUPPRESS = "lisa-block-suppress-directives.ts";
const SGSCAN = "lisa-sg-scan-on-edit.ts";
const MIGRATION = "lisa-block-migration-edits.ts";
const RUBOCOP = "lisa-rubocop-on-edit.ts";
const BASE_RULES = "base-rules.md";

describe("opencode/hooks-installer", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await fs.ensureDir(lisaDir);
    await fs.ensureDir(destDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Read and parse the host `opencode.json`.
   * @returns The parsed config object.
   */
  async function readConfig(): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(
      path.join(destDir, OPENCODE_CONFIG_FILENAME),
      "utf8"
    );
    return JSON.parse(raw) as Record<string, unknown>;
  }

  /**
   * Read the bash permission map from the host `opencode.json`.
   * @returns The `permission.bash` object.
   */
  async function readBash(): Promise<Record<string, string>> {
    const config = await readConfig();
    const permission = config["permission"] as Record<string, unknown>;
    return permission["bash"] as Record<string, string>;
  }

  /**
   * Write a fake Lisa rule file under plugins/<plugin>/rules/<relPath>.
   * @param pluginName - Plugin directory name.
   * @param relPath - Path under rules/ (for example eager/base-rules.md).
   * @param body - Rule Markdown body.
   */
  async function seedRule(
    pluginName: string,
    relPath: string,
    body: string
  ): Promise<void> {
    const filePath = path.join(
      lisaDir,
      "plugins",
      pluginName,
      "rules",
      relPath
    );
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, body, "utf8");
  }

  describe("opencode.json permission.bash (block-no-verify)", () => {
    it("creates opencode.json with deny rules when absent", async () => {
      const result = await installHooks(lisaDir, destDir, ["typescript"], []);
      expect(result.configCreated).toBe(true);
      const bash = await readBash();
      expect(bash["*--no-verify*"]).toBe("deny");
      expect(bash["*HUSKY=0*"]).toBe("deny");
      expect(bash["*HUSKY_SKIP_HOOKS=*"]).toBe("deny");
      expect(bash["*core.hooksPath*/dev/null*"]).toBe("deny");
    });

    it("adds Lisa eager rules to OpenCode instructions", async () => {
      await installHooks(lisaDir, destDir, [], []);
      const config = await readConfig();
      expect(config["instructions"]).toContain(
        OPENCODE_EAGER_RULES_INSTRUCTION
      );
    });

    it("preserves host instructions while adding Lisa eager rules", async () => {
      await fs.writeFile(
        path.join(destDir, OPENCODE_CONFIG_FILENAME),
        JSON.stringify({ instructions: ["docs/standards.md"] }),
        "utf8"
      );
      await installHooks(lisaDir, destDir, [], []);
      const config = await readConfig();
      expect(config["instructions"]).toEqual([
        "docs/standards.md",
        OPENCODE_EAGER_RULES_INSTRUCTION,
      ]);
    });

    it("stamps the $schema on a freshly created config", async () => {
      await installHooks(lisaDir, destDir, [], []);
      const config = await readConfig();
      expect(config["$schema"]).toBe("https://opencode.ai/config.json");
    });

    it("writes the config with a trailing newline", async () => {
      await installHooks(lisaDir, destDir, [], []);
      const raw = await fs.readFile(
        path.join(destDir, OPENCODE_CONFIG_FILENAME),
        "utf8"
      );
      expect(raw).toMatch(/}\n$/);
    });

    it("merges into an existing config, preserving host keys", async () => {
      await fs.writeFile(
        path.join(destDir, OPENCODE_CONFIG_FILENAME),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          theme: "tokyonight",
          permission: { edit: "allow", bash: { "rm *": "deny" } },
        }),
        "utf8"
      );
      const result = await installHooks(lisaDir, destDir, [], []);
      expect(result.configCreated).toBe(false);
      const config = await readConfig();
      expect(config["theme"]).toBe("tokyonight");
      const permission = config["permission"] as Record<string, unknown>;
      expect(permission["edit"]).toBe("allow");
      const bash = permission["bash"] as Record<string, string>;
      // Host rule preserved, Lisa deny rules added.
      expect(bash["rm *"]).toBe("deny");
      expect(bash["*--no-verify*"]).toBe("deny");
    });

    it("preserves a host bash string posture as a catch-all", async () => {
      await fs.writeFile(
        path.join(destDir, OPENCODE_CONFIG_FILENAME),
        JSON.stringify({ permission: { bash: "allow" } }),
        "utf8"
      );
      await installHooks(lisaDir, destDir, [], []);
      const bash = await readBash();
      expect(bash["*"]).toBe("allow");
      expect(bash["*--no-verify*"]).toBe("deny");
    });

    it("is idempotent across repeated installs", async () => {
      await installHooks(lisaDir, destDir, [], []);
      const first = await fs.readFile(
        path.join(destDir, OPENCODE_CONFIG_FILENAME),
        "utf8"
      );
      await installHooks(lisaDir, destDir, [], []);
      const second = await fs.readFile(
        path.join(destDir, OPENCODE_CONFIG_FILENAME),
        "utf8"
      );
      expect(second).toBe(first);
    });

    it("throws on a corrupt existing opencode.json", async () => {
      await fs.writeFile(
        path.join(destDir, OPENCODE_CONFIG_FILENAME),
        "{ not json",
        "utf8"
      );
      await expect(installHooks(lisaDir, destDir, [], [])).rejects.toThrow();
    });

    it("does not list opencode.json in managedFiles", async () => {
      const result = await installHooks(lisaDir, destDir, ["typescript"], []);
      expect(result.managedFiles).not.toContain(OPENCODE_CONFIG_FILENAME);
      expect(
        result.managedFiles.every(f =>
          f.startsWith(`${OPENCODE_PLUGIN_SUBDIR}/`)
        )
      ).toBe(true);
    });
  });

  describe("plugin emission + project-type gating", () => {
    it("always ships the universal session-bootstrap plugin", async () => {
      await installHooks(lisaDir, destDir, [], []);
      const files = await listInstalledPluginFiles(destDir);
      expect(files).toContain(SESSION);
    });

    it("mirrors eager and reference rule files for OpenCode instructions", async () => {
      await seedRule(
        "lisa",
        path.join("eager", BASE_RULES),
        "Always do the thing.\n"
      );
      await seedRule(
        "lisa",
        path.join("reference", BASE_RULES),
        "Detailed body.\n"
      );
      const result = await installHooks(lisaDir, destDir, [], []);

      expect(result.managedFiles).toContain(
        path.join(OPENCODE_LISA_RULES_SUBDIR, "eager", BASE_RULES)
      );
      expect(result.managedFiles).toContain(
        path.join(OPENCODE_LISA_RULES_SUBDIR, "reference", BASE_RULES)
      );
      expect(
        await fs.readFile(
          path.join(
            destDir,
            OPENCODE_CONFIG_DIR,
            OPENCODE_LISA_RULES_SUBDIR,
            "eager",
            BASE_RULES
          ),
          "utf8"
        )
      ).toContain("Always do the thing.");
    });

    it("ships the typescript guards for a typescript project", async () => {
      await installHooks(lisaDir, destDir, ["typescript"], []);
      const files = await listInstalledPluginFiles(destDir);
      expect(files).toEqual([SUPPRESS, LINT, SESSION, SGSCAN]);
    });

    it("adds the migration guard for a nestjs project", async () => {
      // detectedTypes arrive already expanded (nestjs implies typescript).
      await installHooks(lisaDir, destDir, ["typescript", "nestjs"], []);
      const files = await listInstalledPluginFiles(destDir);
      expect(files).toContain(MIGRATION);
      expect(files).toContain(LINT);
    });

    it("ships the rails guards for a rails project", async () => {
      await installHooks(lisaDir, destDir, ["rails"], []);
      const files = await listInstalledPluginFiles(destDir);
      expect(files).toEqual([RUBOCOP, SESSION, SGSCAN]);
    });

    it("does not ship typescript guards to a rails-only project", async () => {
      await installHooks(lisaDir, destDir, ["rails"], []);
      const files = await listInstalledPluginFiles(destDir);
      expect(files).not.toContain(LINT);
      expect(files).not.toContain(SUPPRESS);
    });

    it("copies real plugin source (not an empty stub)", async () => {
      await installHooks(lisaDir, destDir, [], []);
      const body = await fs.readFile(
        path.join(
          destDir,
          OPENCODE_CONFIG_DIR,
          OPENCODE_PLUGIN_SUBDIR,
          SESSION
        ),
        "utf8"
      );
      expect(body).toContain("export const LisaSessionBootstrap");
    });

    it("session bootstrap uses strict https?:// URL-scheme check (not loose startsWith)", async () => {
      await installHooks(lisaDir, destDir, [], []);
      const body = await fs.readFile(
        path.join(
          destDir,
          OPENCODE_CONFIG_DIR,
          OPENCODE_PLUGIN_SUBDIR,
          SESSION
        ),
        "utf8"
      );
      // Ensure the bootstrap uses a strict regex so that values like "httpfoo"
      // are treated as bare hostnames and get https:// prepended, matching the
      // behaviour of the shell hook (which checks http://* || https://*).
      expect(body).toContain("/^https?:\\/\\//");
      expect(body).not.toContain('.startsWith("http")');
    });

    it("reports pluginCount equal to the emitted file count", async () => {
      const result = await installHooks(lisaDir, destDir, ["typescript"], []);
      const files = await listInstalledPluginFiles(destDir);
      expect(result.pluginCount).toBe(files.length);
      expect(result.managedFiles).toHaveLength(files.length);
    });
  });

  describe("stale plugin cleanup", () => {
    it("deletes a Lisa plugin no longer shipped this run", async () => {
      // First install as a nestjs project (ships the migration guard).
      await installHooks(lisaDir, destDir, ["typescript", "nestjs"], []);
      const previous = (await listInstalledPluginFiles(destDir)).map(name =>
        path.join(OPENCODE_PLUGIN_SUBDIR, name)
      );
      expect(previous.some(f => f.endsWith(MIGRATION))).toBe(true);

      // Re-install as a plain typescript project — migration guard goes stale.
      const result = await installHooks(
        lisaDir,
        destDir,
        ["typescript"],
        previous
      );
      expect(result.deleted).toContain(MIGRATION);
      const files = await listInstalledPluginFiles(destDir);
      expect(files).not.toContain(MIGRATION);
    });

    it("never deletes a host-authored plugin", async () => {
      const hostPlugin = "my-plugin.ts";
      const pluginDir = path.join(
        destDir,
        OPENCODE_CONFIG_DIR,
        OPENCODE_PLUGIN_SUBDIR
      );
      await fs.ensureDir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, hostPlugin),
        "export const Mine = async () => ({})",
        "utf8"
      );
      // Even if a stale-looking host entry is in the manifest, only `lisa-`
      // files are eligible for deletion.
      await installHooks(
        lisaDir,
        destDir,
        ["typescript"],
        [path.join(OPENCODE_PLUGIN_SUBDIR, hostPlugin)]
      );
      expect(await fs.pathExists(path.join(pluginDir, hostPlugin))).toBe(true);
    });
  });
});
