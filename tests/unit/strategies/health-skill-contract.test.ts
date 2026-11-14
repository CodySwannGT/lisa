/**
 * Cross-harness distribution contract for the Lisa Health skill: where the
 * command and skill land on each harness. The skill's protocol prose is
 * guidance and is reviewed, not pinned (#4867).
 */
import * as fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateAgyVariant } from "../../../scripts/generate-agy-plugin-artifacts.mjs";
import {
  emitCodexSkillVariants,
  emitCommandSkills,
  writeSkillAgents,
} from "../../../scripts/generate-codex-plugin-artifacts.mjs";
import { generateCopilotVariant } from "../../../scripts/generate-copilot-plugin-artifacts.mjs";
import { generateCursorVariant } from "../../../scripts/generate-cursor-plugin-artifacts.mjs";
import { discoverAndInstallCommands } from "../../../src/opencode/command-installer.js";
import { installSkills } from "../../../src/opencode/skills-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const SOURCE_ROOT = path.resolve("plugins/src/base");
const SOURCE_COMMAND = path.join(SOURCE_ROOT, "commands", "health.md");
const HEALTH_SKILL = "lisa-health";
const OPENAI_YAML = "openai.yaml";
const SOURCE_SKILL = path.join(SOURCE_ROOT, "skills", HEALTH_SKILL, "SKILL.md");
const VERSION = "0.0.0-health-contract";

/**
 * Read one contract fixture as UTF-8.
 * @param file - Fixture path
 * @returns File contents
 */
function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

describe("lisa-health source contract", () => {
  it("keeps the Claude command flat and forwards its arguments", () => {
    expect(fs.pathExistsSync(SOURCE_COMMAND)).toBe(true);
    expect(
      fs.pathExistsSync(path.join(SOURCE_ROOT, "commands", "lisa", "health.md"))
    ).toBe(false);
    const command = read(SOURCE_COMMAND);
    expect(command).toContain("$ARGUMENTS");
  });
});

describe("lisa-health generated and install-time topology", () => {
  let tempDir: string;
  let claudeDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    claudeDir = path.join(tempDir, "lisa-root", "plugins", "lisa");
    await fs.ensureDir(path.join(claudeDir, ".claude-plugin"));
    await fs.writeJson(path.join(claudeDir, ".claude-plugin", "plugin.json"), {
      name: "lisa",
    });
    await fs.copy(
      SOURCE_COMMAND,
      path.join(claudeDir, "commands", "health.md")
    );
    await fs.copy(
      SOURCE_SKILL,
      path.join(claudeDir, "skills", HEALTH_SKILL, "SKILL.md")
    );
    emitCodexSkillVariants(claudeDir);
    emitCommandSkills(claudeDir);
    writeSkillAgents(claudeDir);
  });

  afterEach(async () => cleanupTempDir(tempDir));

  it("emits one authored Claude and Codex skill without a command-derived duplicate", async () => {
    expect(
      await fs.pathExists(path.join(claudeDir, "commands", "health.md"))
    ).toBe(true);
    expect(
      await fs.pathExists(
        path.join(claudeDir, "skills", HEALTH_SKILL, "SKILL.md")
      )
    ).toBe(true);
    expect(
      await fs.pathExists(
        path.join(claudeDir, "skills", HEALTH_SKILL, "agents", OPENAI_YAML)
      )
    ).toBe(true);
    expect(
      await fs.pathExists(
        path.join(
          claudeDir,
          ".codex-plugin",
          "skills",
          HEALTH_SKILL,
          "SKILL.md"
        )
      )
    ).toBe(true);
    expect(
      await fs.pathExists(
        path.join(
          claudeDir,
          ".codex-plugin",
          "skills",
          HEALTH_SKILL,
          "agents",
          OPENAI_YAML
        )
      )
    ).toBe(true);
  });

  it.each([
    ["Cursor", generateCursorVariant],
    ["Antigravity", generateAgyVariant],
    ["Copilot", generateCopilotVariant],
  ] as const)(
    "generates the namespaced %s command and authored skill",
    async (name, generate) => {
      const outDir = path.join(tempDir, name.toLowerCase());
      generate(claudeDir, outDir, VERSION);

      expect(
        await fs.pathExists(path.join(outDir, "commands", "lisa", "health.md"))
      ).toBe(true);
      expect(
        await fs.pathExists(
          path.join(outDir, "skills", HEALTH_SKILL, "SKILL.md")
        )
      ).toBe(true);
      expect(
        await fs.pathExists(
          path.join(outDir, "skills", HEALTH_SKILL, "agents", OPENAI_YAML)
        )
      ).toBe(false);
    }
  );

  it("installs the canonical OpenCode command and bundled skill exactly once", async () => {
    const lisaRoot = path.join(tempDir, "lisa-root");
    const host = path.join(tempDir, "host");
    await fs.ensureDir(host);

    const commands = await discoverAndInstallCommands(lisaRoot, host, []);
    const skills = await installSkills(lisaRoot, host, []);

    expect(
      commands.installed.filter(item => item.name === "lisa:health")
    ).toHaveLength(1);
    expect(
      await fs.pathExists(
        path.join(host, ".opencode", "commands", "lisa:health.md")
      )
    ).toBe(true);
    expect(skills.installed.filter(item => item.name === HEALTH_SKILL)).toEqual(
      [expect.objectContaining({ source: "bundled" })]
    );
    expect(
      await fs.pathExists(
        path.join(host, ".opencode", "skills", "lisa", HEALTH_SKILL, "SKILL.md")
      )
    ).toBe(true);
  });
});
