/**
 * Unit tests for the Codex agent installer (discovery + transform + override
 * merge + stale cleanup).
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

/** Common agent id reused across multiple test cases */
const BUG_FIXER = "bug-fixer";
/** Common second agent id reused across multiple test cases */
const OPS_SPECIALIST = "ops-specialist";
/** Filename for the bug-fixer agent's .md source */
const BUG_FIXER_MD = `${BUG_FIXER}.md`;
/** Filename for the bug-fixer agent's emitted .toml */
const BUG_FIXER_TOML = `${BUG_FIXER}.toml`;
/** Filename for the ops-specialist agent's .md source */
const OPS_SPECIALIST_MD = `${OPS_SPECIALIST}.md`;
/** Filename for a stale agent file used in deletion tests */
const OLD_AGENT_TOML = "old-agent.toml";
/** Filename for a host-authored agent file used in safety tests */
const HOST_AGENT_TOML = "host-agent.toml";
/** Base Lisa plugin name */
const PLUGIN_LISA = "lisa";
/** Stack-specific Rails plugin name (sorts after base alphabetically) */
const PLUGIN_LISA_RAILS = "lisa-rails";
/** Hypothetical plugin that sorts before 'lisa' alphabetically */
const PLUGIN_AA = "aa-plugin";

const SAMPLE_AGENT = `---
name: bug-fixer
description: Bug fix agent
---

Body content.
`;

const SAMPLE_AGENT_2 = `---
name: builder
description: Builder agent
---

Builder body.
`;

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

  describe("discoverLisaAgents", () => {
    it("returns empty list when no plugins directory exists", async () => {
      const result = await discoverLisaAgents(lisaDir);
      expect(result).toEqual([]);
    });

    it("returns empty list when plugins exist but have no agents", async () => {
      await fs.ensureDir(path.join(lisaDir, "plugins", PLUGIN_LISA));
      const result = await discoverLisaAgents(lisaDir);
      expect(result).toEqual([]);
    });

    it("discovers agents from a single plugin", async () => {
      await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
      const result = await discoverLisaAgents(lisaDir);
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(BUG_FIXER);
      expect(result[0]?.pluginName).toBe(PLUGIN_LISA);
    });

    it("discovers agents from multiple plugins", async () => {
      await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
      await seedPlugin(PLUGIN_LISA_RAILS, {
        [OPS_SPECIALIST_MD]: SAMPLE_AGENT_2,
      });
      const result = await discoverLisaAgents(lisaDir);
      expect(result.map(r => r.id).sort((a, b) => a.localeCompare(b))).toEqual([
        BUG_FIXER,
        OPS_SPECIALIST,
      ]);
    });

    it("ignores the plugins/src/ source tree", async () => {
      const srcAgentsDir = path.join(
        lisaDir,
        "plugins",
        "src",
        "base",
        "agents"
      );
      await fs.ensureDir(srcAgentsDir);
      await fs.writeFile(
        path.join(srcAgentsDir, "should-not-appear.md"),
        SAMPLE_AGENT,
        "utf8"
      );
      const result = await discoverLisaAgents(lisaDir);
      expect(result).toHaveLength(0);
    });

    it("ignores non-.md files", async () => {
      await seedPlugin(PLUGIN_LISA, {
        [BUG_FIXER_MD]: SAMPLE_AGENT,
        "README.txt": "ignored",
        "config.json": "{}",
      });
      const result = await discoverLisaAgents(lisaDir);
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(BUG_FIXER);
    });

    it("de-duplicates by agent id (stack-specific plugin wins over base)", async () => {
      // Both plugins ship 'ops-specialist'; stack-specific (lisa-rails) wins over base (lisa)
      await seedPlugin(PLUGIN_LISA, { [OPS_SPECIALIST_MD]: SAMPLE_AGENT });
      await seedPlugin(PLUGIN_LISA_RAILS, {
        [OPS_SPECIALIST_MD]: SAMPLE_AGENT_2,
      });
      const result = await discoverLisaAgents(lisaDir);
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(OPS_SPECIALIST);
      expect(result[0]?.pluginName).toBe(PLUGIN_LISA_RAILS);
    });

    it("non-base plugin sorting before 'lisa' alphabetically still wins over base", async () => {
      // PLUGIN_AA sorts before PLUGIN_LISA alphabetically but should still win
      // because base is always processed first (explicit base-first ordering)
      await seedPlugin(PLUGIN_LISA, { [OPS_SPECIALIST_MD]: SAMPLE_AGENT });
      await seedPlugin(PLUGIN_AA, { [OPS_SPECIALIST_MD]: SAMPLE_AGENT_2 });
      const result = await discoverLisaAgents(lisaDir);
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(OPS_SPECIALIST);
      expect(result[0]?.pluginName).toBe(PLUGIN_AA);
    });

    it("returns results sorted by id", async () => {
      await seedPlugin(PLUGIN_LISA, {
        "zeta.md": SAMPLE_AGENT,
        "alpha.md": SAMPLE_AGENT,
        "mu.md": SAMPLE_AGENT,
      });
      const result = await discoverLisaAgents(lisaDir);
      expect(result.map(r => r.id)).toEqual(["alpha", "mu", "zeta"]);
    });
  });

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
