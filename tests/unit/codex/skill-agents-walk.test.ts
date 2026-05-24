/**
 * Unit tests for the per-skill agents/openai.yaml walk used by the Codex
 * artifact generator (scripts/generate-codex-plugin-artifacts.mjs).
 *
 * Covers the acceptance-criteria scenarios from issue #547:
 *  - every skill with a SKILL.md gets a skills/<name>/agents/openai.yaml that
 *    carries an interface block
 *  - the agents/ directory is created when missing
 *
 * Plus the boundaries declared by the parent PRD (#521):
 *  - no-op when the plugin has no skills/ directory
 *  - never clobber a hand-authored openai.yaml already present in the dir
 *  - leave the commands/ directory untouched
 */
import { load as parseYaml } from "js-yaml";
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deriveSkillInterface,
  writeSkillAgents,
} from "../../../scripts/generate-codex-plugin-artifacts.mjs";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** The per-skill artifact filename the walk emits. */
const OPENAI_YAML = "openai.yaml";
/** A representative skill name used by the derivation tests. */
const EXPLORATORY_QA = "exploratory-qa";

describe("codex/skill-agents-walk", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Resolve the emitted openai.yaml path for a skill in the test plugin dir.
   * @param name Skill directory name.
   * @returns Absolute path to skills/<name>/agents/openai.yaml.
   */
  function openaiYamlPath(name: string): string {
    return path.join(tempDir, "skills", name, "agents", OPENAI_YAML);
  }

  /**
   * Write a SKILL.md into skills/<name>/ inside the test plugin dir.
   * @param name Skill directory name.
   * @param contents Raw SKILL.md body.
   */
  async function writeSkill(name: string, contents: string): Promise<void> {
    const skillDir = path.join(tempDir, "skills", name);
    await fs.ensureDir(skillDir);
    await fs.writeFile(path.join(skillDir, "SKILL.md"), contents);
  }

  /**
   * Standard frontmatter block for a skill.
   * @param name Frontmatter name value.
   * @param description Frontmatter description value.
   * @returns A SKILL.md body string.
   */
  function frontmatter(name: string, description: string): string {
    return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
  }

  it("emits one openai.yaml per skill, each with an interface block", async () => {
    await writeSkill("alpha", frontmatter("alpha", "First skill"));
    await writeSkill("beta", frontmatter("beta", "Second skill"));
    await writeSkill("gamma", frontmatter("gamma", "Third skill"));

    writeSkillAgents(tempDir);

    for (const name of ["alpha", "beta", "gamma"]) {
      const yamlPath = openaiYamlPath(name);
      expect(await fs.pathExists(yamlPath)).toBe(true);
      const parsed = parseYaml(await fs.readFile(yamlPath, "utf8")) as Record<
        string,
        unknown
      >;
      expect(parsed.display_name).toBe(name);
      expect(parsed).toHaveProperty("short_description");
      expect(parsed).toHaveProperty("default_prompt");
    }
  });

  it("creates the agents/ directory when missing", async () => {
    await writeSkill("solo", frontmatter("solo", "Only skill"));
    const agentsDir = path.join(tempDir, "skills", "solo", "agents");
    expect(await fs.pathExists(agentsDir)).toBe(false);

    writeSkillAgents(tempDir);

    expect(await fs.pathExists(agentsDir)).toBe(true);
    expect(await fs.pathExists(path.join(agentsDir, OPENAI_YAML))).toBe(true);
  });

  it("is a no-op when the plugin has no skills/ directory", async () => {
    expect(() => writeSkillAgents(tempDir)).not.toThrow();
    expect(await fs.pathExists(path.join(tempDir, "skills"))).toBe(false);
  });

  it("does not clobber a hand-authored openai.yaml", async () => {
    await writeSkill(
      "kept",
      frontmatter("kept", "Has hand-authored interface")
    );
    const yamlPath = openaiYamlPath("kept");
    await fs.ensureDir(path.dirname(yamlPath));
    const handAuthored =
      'display_name: "HAND AUTHORED"\nshort_description: "keep me"\ndefault_prompt: []\n';
    await fs.writeFile(yamlPath, handAuthored);

    writeSkillAgents(tempDir);

    expect(await fs.readFile(yamlPath, "utf8")).toBe(handAuthored);
  });

  it("leaves the commands/ directory untouched", async () => {
    await writeSkill("withcmd", frontmatter("withcmd", "Skill with command"));
    const commandsDir = path.join(tempDir, "commands");
    await fs.ensureDir(commandsDir);
    await fs.writeFile(path.join(commandsDir, "withcmd.md"), "# command\n");

    writeSkillAgents(tempDir);

    // commands/ must not gain an agents/openai.yaml or any generated artifact.
    expect(await fs.pathExists(path.join(commandsDir, "agents"))).toBe(false);
    expect(
      await fs.readFile(path.join(commandsDir, "withcmd.md"), "utf8")
    ).toBe("# command\n");
  });

  it("skips directories that have no SKILL.md", async () => {
    await fs.ensureDir(path.join(tempDir, "skills", "not-a-skill"));

    writeSkillAgents(tempDir);

    expect(await fs.pathExists(openaiYamlPath("not-a-skill"))).toBe(false);
  });

  describe("deriveSkillInterface", () => {
    it("uses frontmatter name and description", () => {
      const iface = deriveSkillInterface(
        { name: EXPLORATORY_QA, description: "QA workflow" },
        EXPLORATORY_QA
      );
      expect(iface.display_name).toBe(EXPLORATORY_QA);
      expect(iface.short_description).toBe("QA workflow");
      expect(iface.default_prompt).toEqual([`Use $${EXPLORATORY_QA}`]);
    });

    it("falls back to the directory name when frontmatter is null", () => {
      const iface = deriveSkillInterface(null, "fallback-skill");
      expect(iface.display_name).toBe("fallback-skill");
      expect(iface.short_description).toBe("");
      expect(iface.default_prompt).toEqual(["Use $fallback-skill"]);
    });
  });
});
