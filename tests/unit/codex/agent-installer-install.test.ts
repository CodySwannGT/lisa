/**
 * Unit tests for the Codex agent installer: install, transform, override merge
 * and stale cleanup.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HOST_OVERRIDES_SUBDIR,
  LISA_AGENTS_SUBDIR,
  discoverLisaAgents,
  installAgents,
} from "../../../src/codex/agent-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import {
  BUG_FIXER,
  BUG_FIXER_MD,
  BUG_FIXER_TOML,
  OLD_AGENT_TOML,
  HOST_AGENT_TOML,
  PLUGIN_LISA,
  SAMPLE_AGENT,
  SAMPLE_AGENT_2,
} from "./agent-installer-fixtures.js";

describe("codex/agent-installer", () => {
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
   * Write a fake plugin tree under <lisaDir>/plugins/<plugin>/agents/.
   * @param pluginName - Plugin directory name (e.g. "lisa", "lisa-rails")
   * @param files - Map of agent filename → markdown content
   */
  async function seedPlugin(
    pluginName: string,
    files: Record<string, string>
  ): Promise<void> {
    const agentsDir = path.join(lisaDir, "plugins", pluginName, "agents");
    await fs.ensureDir(agentsDir);
    for (const [filename, content] of Object.entries(files)) {
      await fs.writeFile(path.join(agentsDir, filename), content, "utf8");
    }
  }

  describe("installAgents", () => {
    it("writes agents to .codex/agents/lisa/", async () => {
      await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
      const sources = await discoverLisaAgents(lisaDir);
      const result = await installAgents(sources, destDir, []);

      expect(result.installed).toHaveLength(1);
      expect(result.installed[0]?.id).toBe(BUG_FIXER);
      expect(result.installed[0]?.relativePath).toBe(
        path.join(LISA_AGENTS_SUBDIR, BUG_FIXER_TOML)
      );
      expect(result.installed[0]?.overrideApplied).toBe(false);
      expect(result.deleted).toEqual([]);

      const written = await fs.readFile(
        path.join(destDir, ".codex", LISA_AGENTS_SUBDIR, BUG_FIXER_TOML),
        "utf8"
      );
      const parsed = parseToml(written) as Record<string, unknown>;
      expect(parsed.name).toBe("lisa-bug-fixer");
      expect(parsed.description).toBe("Bug fix agent");
    });

    it("creates the .codex/agents/lisa/ directory if absent", async () => {
      await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
      const sources = await discoverLisaAgents(lisaDir);
      await installAgents(sources, destDir, []);
      expect(
        await fs.pathExists(path.join(destDir, ".codex", LISA_AGENTS_SUBDIR))
      ).toBe(true);
    });

    it("applies a host override when present", async () => {
      await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
      // Host wants a different description and adds a sandbox_mode override
      const overridesDir = path.join(destDir, ".codex", HOST_OVERRIDES_SUBDIR);
      await fs.ensureDir(overridesDir);
      await fs.writeFile(
        path.join(overridesDir, BUG_FIXER_TOML),
        `description = "HOST OVERRIDE: bug fixer for our environment"\nsandbox_mode = "read-only"\n`,
        "utf8"
      );

      const sources = await discoverLisaAgents(lisaDir);
      const result = await installAgents(sources, destDir, []);

      expect(result.installed[0]?.overrideApplied).toBe(true);
      const written = await fs.readFile(
        path.join(destDir, ".codex", LISA_AGENTS_SUBDIR, BUG_FIXER_TOML),
        "utf8"
      );
      const parsed = parseToml(written) as Record<string, unknown>;
      expect(parsed.description).toBe(
        "HOST OVERRIDE: bug fixer for our environment"
      );
      expect(parsed.sandbox_mode).toBe("read-only");
      // Lisa's transformer-emitted name is preserved (host didn't override it)
      expect(parsed.name).toBe("lisa-bug-fixer");
      // developer_instructions also preserved from the transformer output
      expect(parsed.developer_instructions).toContain("Body content.");
    });

    it("deletes stale agents that were managed previously but not shipped now", async () => {
      // Seed only one agent, but tell installAgents that two were managed before
      await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
      const lisaAgentsDir = path.join(destDir, ".codex", LISA_AGENTS_SUBDIR);
      await fs.ensureDir(lisaAgentsDir);
      // Create a leftover stale file as if from a previous run
      await fs.writeFile(
        path.join(lisaAgentsDir, OLD_AGENT_TOML),
        `name = "lisa-old-agent"\ndescription = "stale"\ndeveloper_instructions = ""\n`,
        "utf8"
      );

      const sources = await discoverLisaAgents(lisaDir);
      const previousManagedFiles = [
        path.join(LISA_AGENTS_SUBDIR, BUG_FIXER_TOML),
        path.join(LISA_AGENTS_SUBDIR, OLD_AGENT_TOML),
      ];
      const result = await installAgents(
        sources,
        destDir,
        previousManagedFiles
      );

      expect(result.deleted).toEqual([
        path.join(LISA_AGENTS_SUBDIR, OLD_AGENT_TOML),
      ]);
      expect(
        await fs.pathExists(path.join(lisaAgentsDir, OLD_AGENT_TOML))
      ).toBe(false);
      expect(
        await fs.pathExists(path.join(lisaAgentsDir, BUG_FIXER_TOML))
      ).toBe(true);
    });

    it("never deletes files outside .codex/agents/lisa/", async () => {
      // Even if the previous manifest references a host-authored file,
      // we must not delete it
      await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
      const hostAgentsDir = path.join(destDir, ".codex", "agents", "host");
      await fs.ensureDir(hostAgentsDir);
      await fs.writeFile(
        path.join(hostAgentsDir, HOST_AGENT_TOML),
        `name = "host-agent"\ndescription = "host"\ndeveloper_instructions = ""\n`,
        "utf8"
      );

      const sources = await discoverLisaAgents(lisaDir);
      const previousManagedFiles = [
        path.join("agents", "host", HOST_AGENT_TOML),
      ];
      const result = await installAgents(
        sources,
        destDir,
        previousManagedFiles
      );

      expect(result.deleted).toEqual([]);
      expect(
        await fs.pathExists(path.join(hostAgentsDir, HOST_AGENT_TOML))
      ).toBe(true);
    });

    it("returns managedFiles list for manifest persistence", async () => {
      await seedPlugin(PLUGIN_LISA, {
        [BUG_FIXER_MD]: SAMPLE_AGENT,
        "builder.md": SAMPLE_AGENT_2,
      });
      const sources = await discoverLisaAgents(lisaDir);
      const result = await installAgents(sources, destDir, []);

      expect(
        [...result.managedFiles].sort((a, b) => a.localeCompare(b))
      ).toEqual([
        path.join(LISA_AGENTS_SUBDIR, BUG_FIXER_TOML),
        path.join(LISA_AGENTS_SUBDIR, "builder.toml"),
      ]);
    });

    it("idempotent: running twice produces the same output", async () => {
      await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
      const sources = await discoverLisaAgents(lisaDir);
      await installAgents(sources, destDir, []);
      const first = await fs.readFile(
        path.join(destDir, ".codex", LISA_AGENTS_SUBDIR, BUG_FIXER_TOML),
        "utf8"
      );
      await installAgents(sources, destDir, []);
      const second = await fs.readFile(
        path.join(destDir, ".codex", LISA_AGENTS_SUBDIR, BUG_FIXER_TOML),
        "utf8"
      );
      expect(second).toBe(first);
    });
  });
});
