/**
 * Unit tests for the Codex agent installer: agent discovery across Lisa plugins.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverLisaAgents } from "../../../src/codex/agent-installer.js";
import {
  projectPluginFilter,
  selectProjectLisaPlugins,
} from "../../../src/core/lisa-plugin-selection.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import {
  BUG_FIXER,
  OPS_SPECIALIST,
  BUG_FIXER_MD,
  OPS_SPECIALIST_MD,
  PLUGIN_LISA,
  PLUGIN_LISA_RAILS,
  PLUGIN_AA,
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

    it("applies an optional plugin filter (excludes copilot .agent.md dupes)", async () => {
      // Without filtering, the copilot variant's `bug-fixer.agent.md` becomes a
      // distinct id (`bug-fixer.agent`) and ships a duplicate agent.
      await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
      await seedPlugin("lisa-copilot", {
        "bug-fixer.agent.md": SAMPLE_AGENT,
      });
      const unfiltered = await discoverLisaAgents(lisaDir);
      expect(
        unfiltered.map(r => r.id).sort((a, b) => a.localeCompare(b))
      ).toEqual(["bug-fixer", "bug-fixer.agent"]);

      const filtered = await discoverLisaAgents(
        lisaDir,
        name => !name.endsWith("-copilot")
      );
      expect(filtered.map(r => r.id)).toEqual([BUG_FIXER]);
    });

    it("uses project selection to exclude agents from unrelated stacks", async () => {
      await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
      await seedPlugin("lisa-expo", { "expo-agent.md": SAMPLE_AGENT_2 });
      await seedPlugin(PLUGIN_LISA_RAILS, {
        [OPS_SPECIALIST_MD]: SAMPLE_AGENT_2,
      });
      const selected = await selectProjectLisaPlugins(destDir, [
        "typescript",
        "expo",
      ]);

      const result = await discoverLisaAgents(
        lisaDir,
        projectPluginFilter(selected)
      );
      expect(result.map(agent => agent.pluginName)).toEqual([
        PLUGIN_LISA,
        "lisa-expo",
      ]);
    });
  });
});
