/**
 * Unit tests for the OpenCode project-type gate shared by the three vendoring
 * installers (skills, agents, commands).
 *
 * OpenCode is the one surface where Lisa copies its catalogue verbatim into the
 * host repo, so an ungated emit hands a model Expo/React skills in an
 * infrastructure repo and Phaser game-design agents in a backend. These tests
 * pin the three behaviours that matter:
 *   - Out-of-stack plugins are never written
 *   - In-stack plugins still ARE written (the gate does not over-filter)
 *   - A host that received the whole catalogue from a prior release has the
 *     out-of-stack artifacts pruned on the next apply, with no migration
 *
 * The harness-variant exclusion (`*-cursor` and friends) that composes into the
 * same predicate is covered in each installer's own test file.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISA_SKILLS_SUBDIR,
  installSkills,
} from "../../../src/opencode/skills-installer.js";
import {
  LISA_AGENTS_SUBDIR,
  LISA_AGENT_FILE_PREFIX,
  discoverAndInstallAgents,
} from "../../../src/opencode/agent-installer.js";
import {
  LISA_COMMANDS_SUBDIR,
  discoverAndInstallCommands,
} from "../../../src/opencode/command-installer.js";
import {
  LISA_COMMAND_DISPLAY_PREFIX,
  LISA_COMMAND_SKILL_PREFIX,
} from "../../../src/core/lisa-skill-sources.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** OpenCode config dir all artifacts land under */
const OPENCODE_DIR = ".opencode";
/** SKILL.md filename — appears in many path joins */
const SKILL_MD = "SKILL.md";
/** Base-plugin skill that must survive every gate */
const BUG_TRIAGE = "lisa-bug-triage";
/** Expo-plugin skill standing in for the JSX-bearing React skills */
const CONTAINER_VIEW = "container-view-pattern";
/** Base-plugin agent id that must survive every gate */
const BUG_FIXER = "bug-fixer";
/** Phaser-plugin agent id standing in for the game-development roles */
const GAME_DESIGNER = "game-designer";
/** Emitted filename for the Phaser agent */
const GAME_DESIGNER_OUT = `${LISA_AGENT_FILE_PREFIX}${GAME_DESIGNER}.md`;
/** Emitted filename for the base agent */
const BUG_FIXER_OUT = `${LISA_AGENT_FILE_PREFIX}${BUG_FIXER}.md`;
/** Expo-plugin command basename (no extension) */
const EXPO_COMMAND = "eas-build";
/** Emitted filename for the Expo command */
const EXPO_COMMAND_OUT = `${LISA_COMMAND_DISPLAY_PREFIX}${EXPO_COMMAND}.md`;
/** Detected type for a host that runs none of the gated stacks */
const PLAIN_TS = "typescript";

const SAMPLE_SKILL_MD = `---
name: bug-triage
description: Triage a bug
---

Body content here.
`;

const EXPO_SKILL_MD = `---
name: container-view-pattern
description: Split React components into container and view
---

JSX worked examples here.
`;

const SAMPLE_AGENT_MD = `---
name: bug-fixer
description: Bug fix agent
---

Body content.
`;

const GAME_AGENT_MD = `---
name: game-designer
description: Game design agent
---

Game design body.
`;

const SAMPLE_COMMAND_MD = `---
description: "Do the thing."
argument-hint: "<description>"
---

Execute the flow.

$ARGUMENTS
`;

describe("opencode project-type gate", () => {
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
   * Write a fake skill under plugins/<plugin>/skills/<skill>/SKILL.md.
   * @param pluginName - Plugin directory name.
   * @param skillName - Skill directory name.
   * @param content - SKILL.md content.
   */
  async function seedSkill(
    pluginName: string,
    skillName: string,
    content: string
  ): Promise<void> {
    const skillDir = path.join(
      lisaDir,
      "plugins",
      pluginName,
      "skills",
      skillName
    );
    await fs.ensureDir(skillDir);
    await fs.writeFile(path.join(skillDir, SKILL_MD), content, "utf8");
  }

  /**
   * Write a fake agent under plugins/<plugin>/agents/<file>.
   * @param pluginName - Plugin directory name.
   * @param filename - Agent markdown filename.
   * @param content - Agent markdown content.
   */
  async function seedAgent(
    pluginName: string,
    filename: string,
    content: string
  ): Promise<void> {
    const agentsDir = path.join(lisaDir, "plugins", pluginName, "agents");
    await fs.ensureDir(agentsDir);
    await fs.writeFile(path.join(agentsDir, filename), content, "utf8");
  }

  /**
   * Write a fake command under plugins/<plugin>/commands/<relPath>.
   * @param pluginName - Plugin directory name.
   * @param relPath - Path under commands/.
   * @param content - Command markdown content.
   */
  async function seedCommand(
    pluginName: string,
    relPath: string,
    content: string
  ): Promise<void> {
    const filePath = path.join(
      lisaDir,
      "plugins",
      pluginName,
      "commands",
      relPath
    );
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, "utf8");
  }

  /**
   * Absolute path of an installed skill file.
   * @param skillName - Installed skill folder name.
   * @returns Path to that skill's SKILL.md under `.opencode/skills/lisa/`.
   */
  function installedSkillPath(skillName: string): string {
    return path.join(
      destDir,
      OPENCODE_DIR,
      LISA_SKILLS_SUBDIR,
      skillName,
      SKILL_MD
    );
  }

  /**
   * Absolute path of an installed agent file.
   * @param filename - Emitted agent filename.
   * @returns Path under `.opencode/agents/`.
   */
  function installedAgentPath(filename: string): string {
    return path.join(destDir, OPENCODE_DIR, LISA_AGENTS_SUBDIR, filename);
  }

  /**
   * Absolute path of an installed command file.
   * @param filename - Emitted command filename.
   * @returns Path under `.opencode/commands/`.
   */
  function installedCommandPath(filename: string): string {
    return path.join(destDir, OPENCODE_DIR, LISA_COMMANDS_SUBDIR, filename);
  }

  describe("skills", () => {
    beforeEach(async () => {
      await seedSkill("lisa", BUG_TRIAGE, SAMPLE_SKILL_MD);
      await seedSkill("lisa-expo", CONTAINER_VIEW, EXPO_SKILL_MD);
    });

    it("omits Expo skills from a non-Expo host", async () => {
      const result = await installSkills(lisaDir, destDir, [], [PLAIN_TS]);

      expect(result.installed.map(skill => skill.name)).toEqual([BUG_TRIAGE]);
      expect(await fs.pathExists(installedSkillPath(CONTAINER_VIEW))).toBe(
        false
      );
      expect(result.managedFiles).not.toContain(
        path.join(LISA_SKILLS_SUBDIR, CONTAINER_VIEW, SKILL_MD)
      );
    });

    it("still installs Expo skills on an Expo host", async () => {
      const result = await installSkills(lisaDir, destDir, [], ["expo"]);

      expect(result.installed.map(skill => skill.name)).toContain(
        CONTAINER_VIEW
      );
      expect(await fs.pathExists(installedSkillPath(CONTAINER_VIEW))).toBe(
        true
      );
      expect(await fs.pathExists(installedSkillPath(BUG_TRIAGE))).toBe(true);
    });

    it("prunes skills vendored by a prior ungated release", async () => {
      const before = await installSkills(lisaDir, destDir, [], ["expo"]);
      expect(await fs.pathExists(installedSkillPath(CONTAINER_VIEW))).toBe(
        true
      );

      const after = await installSkills(lisaDir, destDir, before.managedFiles, [
        PLAIN_TS,
      ]);

      expect(after.deleted).toContain(CONTAINER_VIEW);
      expect(await fs.pathExists(installedSkillPath(CONTAINER_VIEW))).toBe(
        false
      );
      expect(await fs.pathExists(installedSkillPath(BUG_TRIAGE))).toBe(true);
    });

    it("gates command-derived skills on project type too", async () => {
      await seedCommand("lisa-expo", `${EXPO_COMMAND}.md`, SAMPLE_COMMAND_MD);
      const gatedName = `${LISA_COMMAND_SKILL_PREFIX}${EXPO_COMMAND}`;

      const gated = await installSkills(lisaDir, destDir, [], [PLAIN_TS]);
      expect(gated.installed.map(skill => skill.name)).not.toContain(gatedName);

      const allowed = await installSkills(lisaDir, destDir, [], ["expo"]);
      expect(allowed.installed.map(skill => skill.name)).toContain(gatedName);
    });
  });

  describe("agents", () => {
    beforeEach(async () => {
      await seedAgent("lisa", `${BUG_FIXER}.md`, SAMPLE_AGENT_MD);
      await seedAgent("lisa-phaser", `${GAME_DESIGNER}.md`, GAME_AGENT_MD);
    });

    it("omits Phaser agents from a non-game host", async () => {
      const result = await discoverAndInstallAgents(
        lisaDir,
        destDir,
        [],
        [PLAIN_TS]
      );

      expect(result.installed.map(agent => agent.id)).toEqual([BUG_FIXER]);
      expect(await fs.pathExists(installedAgentPath(GAME_DESIGNER_OUT))).toBe(
        false
      );
    });

    it("still installs Phaser agents on a Phaser host", async () => {
      const result = await discoverAndInstallAgents(
        lisaDir,
        destDir,
        [],
        ["phaser"]
      );

      expect(result.installed.map(agent => agent.id)).toContain(GAME_DESIGNER);
      expect(await fs.pathExists(installedAgentPath(GAME_DESIGNER_OUT))).toBe(
        true
      );
    });

    it("prunes agents vendored by a prior ungated release", async () => {
      const before = await discoverAndInstallAgents(
        lisaDir,
        destDir,
        [],
        ["phaser"]
      );
      expect(await fs.pathExists(installedAgentPath(GAME_DESIGNER_OUT))).toBe(
        true
      );

      const after = await discoverAndInstallAgents(
        lisaDir,
        destDir,
        before.managedFiles,
        [PLAIN_TS]
      );

      expect(after.deleted).toContain(
        path.join(LISA_AGENTS_SUBDIR, GAME_DESIGNER_OUT)
      );
      expect(await fs.pathExists(installedAgentPath(GAME_DESIGNER_OUT))).toBe(
        false
      );
      expect(await fs.pathExists(installedAgentPath(BUG_FIXER_OUT))).toBe(true);
    });
  });

  describe("commands", () => {
    beforeEach(async () => {
      await seedCommand("lisa", "fix.md", SAMPLE_COMMAND_MD);
      await seedCommand("lisa-expo", `${EXPO_COMMAND}.md`, SAMPLE_COMMAND_MD);
    });

    it("omits Expo commands from a non-Expo host", async () => {
      const result = await discoverAndInstallCommands(
        lisaDir,
        destDir,
        [],
        [PLAIN_TS]
      );

      expect(result.installed.map(command => command.name)).toEqual([
        `${LISA_COMMAND_DISPLAY_PREFIX}fix`,
      ]);
      expect(await fs.pathExists(installedCommandPath(EXPO_COMMAND_OUT))).toBe(
        false
      );
    });

    it("still installs Expo commands on an Expo host", async () => {
      const result = await discoverAndInstallCommands(
        lisaDir,
        destDir,
        [],
        ["expo"]
      );

      expect(result.installed.map(command => command.name)).toContain(
        `${LISA_COMMAND_DISPLAY_PREFIX}${EXPO_COMMAND}`
      );
      expect(await fs.pathExists(installedCommandPath(EXPO_COMMAND_OUT))).toBe(
        true
      );
    });

    it("prunes commands vendored by a prior ungated release", async () => {
      const before = await discoverAndInstallCommands(
        lisaDir,
        destDir,
        [],
        ["expo"]
      );
      expect(await fs.pathExists(installedCommandPath(EXPO_COMMAND_OUT))).toBe(
        true
      );

      const after = await discoverAndInstallCommands(
        lisaDir,
        destDir,
        before.managedFiles,
        [PLAIN_TS]
      );

      expect(after.deleted).toContain(
        path.join(LISA_COMMANDS_SUBDIR, EXPO_COMMAND_OUT)
      );
      expect(await fs.pathExists(installedCommandPath(EXPO_COMMAND_OUT))).toBe(
        false
      );
    });
  });
});
