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
  pruneInternalCodexSkills,
  writeSkillAgents,
} from "../../../scripts/generate-codex-plugin-artifacts.mjs";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** The per-skill artifact filename the walk emits. */
const OPENAI_YAML = "openai.yaml";
/** A representative skill name used by the derivation tests. */
const EXPLORATORY_QA = "exploratory-qa";
/** Internal maintainer-only skill that must never ship in Codex artifacts. */
const HARNESS_PARITY_COUNCIL = "harness-parity-council";
/** Public skill used to prove non-denylisted artifacts still emit normally. */
const PUBLIC_SKILL = "public-skill";

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

    // display_name is humanized (#548): the lowercase directory name is
    // title-cased on emit, so "alpha" -> "Alpha".
    for (const [name, displayName] of [
      ["alpha", "Alpha"],
      ["beta", "Beta"],
      ["gamma", "Gamma"],
    ]) {
      const yamlPath = openaiYamlPath(name);
      expect(await fs.pathExists(yamlPath)).toBe(true);
      const parsed = parseYaml(await fs.readFile(yamlPath, "utf8")) as Record<
        string,
        unknown
      >;
      expect(parsed.display_name).toBe(displayName);
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

  it("prunes denylisted internal skills before Codex artifacts are emitted", async () => {
    await writeSkill(
      HARNESS_PARITY_COUNCIL,
      frontmatter(HARNESS_PARITY_COUNCIL, "Maintainer-only workflow")
    );
    await writeSkill(PUBLIC_SKILL, frontmatter(PUBLIC_SKILL, "Ships"));

    const removed = pruneInternalCodexSkills(tempDir);
    writeSkillAgents(tempDir);

    expect(removed).toEqual([HARNESS_PARITY_COUNCIL]);
    expect(
      await fs.pathExists(path.join(tempDir, "skills", HARNESS_PARITY_COUNCIL))
    ).toBe(false);
    expect(await fs.pathExists(openaiYamlPath(PUBLIC_SKILL))).toBe(true);
  });

  describe("deriveSkillInterface", () => {
    // The PRD's reference frontmatter description for the exploratory-qa skill.
    const EXPLORATORY_QA_DESCRIPTION =
      "Playwright-backed exploratory QA workflow for web apps. Use when asked to audit an app or project with Playwright/e2e tests, find human-noticeable bugs, identify gaps in automated test coverage, test responsive breakpoints, observe slow or unclear load states, exercise mutable workflows with cleanup, or produce a QA gaps report.";

    // ---- Acceptance criteria from issue #548 ----

    it("humanizes display_name from the frontmatter name (AC: exploratory-qa -> Exploratory QA)", () => {
      const iface = deriveSkillInterface(
        { name: EXPLORATORY_QA, description: EXPLORATORY_QA_DESCRIPTION },
        EXPLORATORY_QA
      );
      expect(iface.display_name).toBe("Exploratory QA");
    });

    it("default_prompt references the skill token (AC: contains $exploratory-qa)", () => {
      const iface = deriveSkillInterface(
        { name: EXPLORATORY_QA, description: EXPLORATORY_QA_DESCRIPTION },
        EXPLORATORY_QA
      );
      expect(iface.default_prompt).toHaveLength(1);
      expect(iface.default_prompt[0]).toContain(`$${EXPLORATORY_QA}`);
    });

    // ---- display_name humanization ----

    it("title-cases multi-word kebab names", () => {
      const iface = deriveSkillInterface(
        { name: "review-local", description: "Review local changes." },
        "review-local"
      );
      expect(iface.display_name).toBe("Review Local");
    });

    it("upper-cases known acronyms in display_name", () => {
      const iface = deriveSkillInterface(
        { name: "setup-jira-api", description: "Set it up." },
        "setup-jira-api"
      );
      expect(iface.display_name).toBe("Setup Jira API");
    });

    it("humanizes snake_case and whitespace-delimited names too", () => {
      expect(
        deriveSkillInterface(
          { name: "foo_bar baz", description: "Do a thing." },
          "foo_bar baz"
        ).display_name
      ).toBe("Foo Bar Baz");
    });

    it("title-cases (does not force all-caps) tokens not in the acronym set", () => {
      // "jsdoc" is a mixed-case product name, not a pure initialism, so it is
      // deliberately NOT in the acronym set — forcing "JSDOC" would be wrong.
      expect(
        deriveSkillInterface(
          { name: "jsdoc-best-practices", description: "Enforce JSDoc." },
          "jsdoc-best-practices"
        ).display_name
      ).toBe("Jsdoc Best Practices");
    });

    it("preserves mixed-case brand names (PostHog) in display_name", () => {
      const iface = deriveSkillInterface(
        { name: "posthog-access", description: "Access PostHog." },
        "posthog-access"
      );
      expect(iface.display_name).toBe("PostHog Access");
    });

    it("preserves mixed-case brand names (SonarCloud) in display_name", () => {
      const iface = deriveSkillInterface(
        { name: "sonarcloud-access", description: "Access SonarCloud." },
        "sonarcloud-access"
      );
      expect(iface.display_name).toBe("SonarCloud Access");
    });

    // ---- short_description summarization ----

    it("derives a concise short_description from the first sentence", () => {
      const iface = deriveSkillInterface(
        { name: EXPLORATORY_QA, description: EXPLORATORY_QA_DESCRIPTION },
        EXPLORATORY_QA
      );
      expect(iface.short_description).toBe(
        "Playwright-backed exploratory QA workflow for web apps"
      );
    });

    it("strips a 'This skill should be used when ...' boilerplate prefix", () => {
      const iface = deriveSkillInterface(
        {
          name: "git-commit",
          description:
            "This skill should be used when creating conventional commits for current changes. It groups related changes into logical commits.",
        },
        "git-commit"
      );
      expect(iface.short_description).toBe(
        "creating conventional commits for current changes"
      );
    });

    it("clamps an over-long single-sentence description with an ellipsis", () => {
      const longSentence = `${"word ".repeat(60).trim()} end`;
      const iface = deriveSkillInterface(
        { name: "verbose", description: longSentence },
        "verbose"
      );
      expect(iface.short_description.length).toBeLessThanOrEqual(141);
      expect(iface.short_description.endsWith("…")).toBe(true);
    });

    // ---- default_prompt composition ----

    it("composes default_prompt as 'Use $<name>: <summary>.'", () => {
      const iface = deriveSkillInterface(
        { name: EXPLORATORY_QA, description: EXPLORATORY_QA_DESCRIPTION },
        EXPLORATORY_QA
      );
      expect(iface.default_prompt).toEqual([
        "Use $exploratory-qa: Playwright-backed exploratory QA workflow for web apps.",
      ]);
    });

    it("falls back to a bare 'Use $<name>' when there is no description", () => {
      const iface = deriveSkillInterface(
        { name: "no-desc", description: "" },
        "no-desc"
      );
      expect(iface.short_description).toBe("");
      expect(iface.default_prompt).toEqual(["Use $no-desc"]);
    });

    // ---- fallback when frontmatter is missing ----

    it("falls back to the humanized directory name when frontmatter is null", () => {
      const iface = deriveSkillInterface(null, "fallback-skill");
      expect(iface.display_name).toBe("Fallback Skill");
      expect(iface.short_description).toBe("");
      expect(iface.default_prompt).toEqual(["Use $fallback-skill"]);
    });
  });
});
