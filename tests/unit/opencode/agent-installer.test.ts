/**
 * Unit tests for the OpenCode agent installer (discovery reuse + transform +
 * stale cleanup).
 *
 * Covers:
 *   - Writes agents to `.opencode/agents/lisa-<id>.md` (flat, `lisa-` prefixed)
 *   - Frontmatter is OpenCode-shaped (description + mode: subagent)
 *   - De-dup across plugins (stack wins over base) via shared discovery
 *   - Stale cleanup scoped to `agents/lisa-*` — never touches host agents
 *   - managedFiles list for manifest persistence; idempotence
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISA_AGENTS_SUBDIR,
  LISA_AGENT_FILE_PREFIX,
  discoverAndInstallAgents,
  discoverLisaAgents,
  installAgents,
} from "../../../src/opencode/agent-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const BUG_FIXER = "bug-fixer";
const BUG_FIXER_MD = `${BUG_FIXER}.md`;
const BUG_FIXER_OUT = `${LISA_AGENT_FILE_PREFIX}${BUG_FIXER}.md`;
const PLUGIN_LISA = "lisa";
const PLUGIN_LISA_RAILS = "lisa-rails";
const OPENCODE_DIR = ".opencode";
const HOST_AGENT_MD = "host-agent.md";
const OLD_AGENT_OUT = `${LISA_AGENT_FILE_PREFIX}old-agent.md`;

const SAMPLE_AGENT = `---
name: bug-fixer
description: Bug fix agent
---

Body content.
`;

const SAMPLE_AGENT_2 = `---
name: bug-fixer
description: Rails bug fix agent
---

Rails body.
`;

describe("opencode/agent-installer", () => {
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
   * @param pluginName - Plugin directory name (e.g. "lisa", "lisa-rails").
   * @param files - Map of agent filename → markdown content.
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

  /**
   * Resolve the absolute path of an installed Lisa agent file.
   * @param filename - Emitted filename (e.g. "lisa-bug-fixer.md").
   * @returns Absolute path under `.opencode/agents/`.
   */
  function installedAgentPath(filename: string): string {
    return path.join(destDir, OPENCODE_DIR, LISA_AGENTS_SUBDIR, filename);
  }

  it("writes agents to .opencode/agents/ with a lisa- prefix", async () => {
    await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
    const result = await discoverAndInstallAgents(lisaDir, destDir, []);

    expect(result.installed).toHaveLength(1);
    expect(result.installed[0]?.id).toBe(BUG_FIXER);
    expect(result.installed[0]?.relativePath).toBe(
      path.join(LISA_AGENTS_SUBDIR, BUG_FIXER_OUT)
    );
    expect(await fs.pathExists(installedAgentPath(BUG_FIXER_OUT))).toBe(true);
  });

  it("emits OpenCode-shaped frontmatter (description + mode: subagent)", async () => {
    await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
    await discoverAndInstallAgents(lisaDir, destDir, []);
    const content = await fs.readFile(
      installedAgentPath(BUG_FIXER_OUT),
      "utf8"
    );
    const fm = yaml.load(
      /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? ""
    ) as Record<string, unknown>;
    expect(fm.description).toBe("Bug fix agent");
    expect(fm.mode).toBe("subagent");
    expect(content).toContain("Body content.");
  });

  it("excludes per-harness variant plugins (copilot .agent.md duplicates)", async () => {
    await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
    // The copilot fanout renames agents to *.agent.md; without canonical
    // filtering this would ship a duplicate lisa-bug-fixer.agent.md.
    await seedPlugin("lisa-copilot", { "bug-fixer.agent.md": SAMPLE_AGENT });
    // The cursor/agy fanout are reformatted copies that must not override base.
    await seedPlugin("lisa-cursor", { [BUG_FIXER_MD]: SAMPLE_AGENT_2 });
    const result = await discoverAndInstallAgents(lisaDir, destDir, []);

    expect(result.installed.map(a => a.id)).toEqual([BUG_FIXER]);
    expect(
      await fs.pathExists(
        installedAgentPath(`${LISA_AGENT_FILE_PREFIX}bug-fixer.agent.md`)
      )
    ).toBe(false);
    // Base content wins (cursor variant excluded), not the Rails-labelled copy.
    const content = await fs.readFile(
      installedAgentPath(BUG_FIXER_OUT),
      "utf8"
    );
    expect(content).toContain("Bug fix agent");
    expect(content).not.toContain("Rails bug fix agent");
  });

  it("de-duplicates by id with stack winning over base", async () => {
    await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
    await seedPlugin(PLUGIN_LISA_RAILS, { [BUG_FIXER_MD]: SAMPLE_AGENT_2 });
    const result = await discoverAndInstallAgents(lisaDir, destDir, []);

    expect(result.installed).toHaveLength(1);
    const content = await fs.readFile(
      installedAgentPath(BUG_FIXER_OUT),
      "utf8"
    );
    expect(content).toContain("Rails bug fix agent");
    expect(content).toContain("Rails body.");
  });

  it("returns managedFiles for manifest persistence", async () => {
    await seedPlugin(PLUGIN_LISA, {
      [BUG_FIXER_MD]: SAMPLE_AGENT,
      "builder.md": SAMPLE_AGENT.replace("bug-fixer", "builder"),
    });
    const result = await discoverAndInstallAgents(lisaDir, destDir, []);
    expect([...result.managedFiles].sort((a, b) => a.localeCompare(b))).toEqual(
      [
        path.join(LISA_AGENTS_SUBDIR, BUG_FIXER_OUT),
        path.join(LISA_AGENTS_SUBDIR, `${LISA_AGENT_FILE_PREFIX}builder.md`),
      ]
    );
  });

  it("deletes stale lisa- agents managed previously but not shipped now", async () => {
    await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
    const agentsDir = path.join(destDir, OPENCODE_DIR, LISA_AGENTS_SUBDIR);
    await fs.ensureDir(agentsDir);
    await fs.writeFile(path.join(agentsDir, OLD_AGENT_OUT), "stale", "utf8");
    const previousManagedFiles = [
      path.join(LISA_AGENTS_SUBDIR, BUG_FIXER_OUT),
      path.join(LISA_AGENTS_SUBDIR, OLD_AGENT_OUT),
    ];
    const result = await discoverAndInstallAgents(
      lisaDir,
      destDir,
      previousManagedFiles
    );

    expect(result.deleted).toEqual([
      path.join(LISA_AGENTS_SUBDIR, OLD_AGENT_OUT),
    ]);
    expect(await fs.pathExists(path.join(agentsDir, OLD_AGENT_OUT))).toBe(
      false
    );
    expect(await fs.pathExists(installedAgentPath(BUG_FIXER_OUT))).toBe(true);
  });

  it("never deletes host agents (files without the lisa- prefix)", async () => {
    await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
    const agentsDir = path.join(destDir, OPENCODE_DIR, LISA_AGENTS_SUBDIR);
    await fs.ensureDir(agentsDir);
    await fs.writeFile(
      path.join(agentsDir, HOST_AGENT_MD),
      "host-owned",
      "utf8"
    );
    // Even if the previous manifest somehow references the host file, the
    // prefix guard must protect it.
    const result = await discoverAndInstallAgents(lisaDir, destDir, [
      path.join(LISA_AGENTS_SUBDIR, HOST_AGENT_MD),
    ]);

    expect(result.deleted).toEqual([]);
    expect(await fs.pathExists(path.join(agentsDir, HOST_AGENT_MD))).toBe(true);
  });

  it("idempotent: running twice produces identical output", async () => {
    await seedPlugin(PLUGIN_LISA, { [BUG_FIXER_MD]: SAMPLE_AGENT });
    const sources = await discoverLisaAgents(lisaDir);
    await installAgents(sources, destDir, []);
    const first = await fs.readFile(installedAgentPath(BUG_FIXER_OUT), "utf8");
    await installAgents(sources, destDir, []);
    const second = await fs.readFile(installedAgentPath(BUG_FIXER_OUT), "utf8");
    expect(second).toBe(first);
  });
});
