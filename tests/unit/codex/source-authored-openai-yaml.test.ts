/**
 * Regression test for issue #550: a hand-authored, source-resident
 * `skills/<name>/agents/openai.yaml` must survive the Codex artifact build
 * byte-for-byte, while skills that ship no such file still receive a generated
 * one.
 *
 * Why this is distinct from skill-agents-walk.test.ts: that suite calls
 * {@link writeSkillAgents} against a dir whose openai.yaml is pre-seeded
 * in place. It proves the generator's in-place guard, but NOT #550's actual
 * acceptance criterion — that a file authored under
 * `plugins/src/<plugin>/skills/<name>/agents/openai.yaml` reaches the built
 * artifact unchanged. The build pipeline (scripts/build-plugins.sh) gets the
 * source file into the built dir via `cp -r "$src/." "$out/"` BEFORE running
 * the generator; the no-clobber guard then leaves it untouched. This test
 * reproduces those two steps end-to-end against an isolated temp tree so the
 * copy-through contract cannot silently regress.
 * @module tests/unit/codex/source-authored-openai-yaml
 */
import { spawnSync } from "node:child_process";
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Absolute path to the generator the build pipeline invokes per plugin. */
const GENERATOR_PATH = path.resolve(
  "scripts/generate-codex-plugin-artifacts.mjs"
);
/** The per-skill artifact filename. */
const OPENAI_YAML = "openai.yaml";
/** Per-skill agents directory name. */
const AGENTS = "agents";
/** Top-level skills directory name. */
const SKILLS = "skills";
/** Skill that carries a hand-authored openai.yaml in these tests. */
const HAND_AUTHORED_SKILL = "lisa-exploratory-qa";
/** Sibling skill that ships no source openai.yaml (gets generated output). */
const GENERATED_SKILL = "apollo-client";
/** Dummy release version passed positionally to the generator. */
const VERSION = "9.9.9";
/**
 * Absolute path to the Node interpreter running this suite. Used instead of a
 * bare "node" so the spawn resolves a fixed executable (sonarjs
 * no-os-command-from-path).
 */
const NODE_BIN = process.execPath;

describe("codex/source-authored-openai-yaml (#550)", () => {
  let srcDir: string;
  let outDir: string;

  beforeEach(async () => {
    srcDir = await createTempDir();
    outDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(srcDir);
    await cleanupTempDir(outDir);
  });

  /**
   * Write a SKILL.md into srcDir at skills/<name>/SKILL.md.
   * @param name Skill directory name.
   * @param description Frontmatter description value.
   */
  async function writeSourceSkill(
    name: string,
    description: string
  ): Promise<void> {
    const skillDir = path.join(srcDir, SKILLS, name);
    await fs.ensureDir(skillDir);
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
    );
  }

  /**
   * Reproduce the two per-plugin build steps from scripts/build-plugins.sh:
   * `cp -r "$src/." "$out/"` followed by invoking the generator on the
   * built dir. Returns the spawn result so the caller can assert on it.
   * @returns The spawnSync result for the generator invocation.
   */
  function runBuildPipeline(): ReturnType<typeof spawnSync> {
    // A minimal Claude manifest is required: the generator exits early if
    // .claude-plugin/plugin.json is absent.
    fs.ensureDirSync(path.join(srcDir, ".claude-plugin"));
    fs.writeJsonSync(path.join(srcDir, ".claude-plugin", "plugin.json"), {
      name: "lisa-fixture",
      version: "0.0.0",
    });
    fs.copySync(srcDir, outDir);
    return spawnSync(NODE_BIN, [GENERATOR_PATH, outDir, VERSION], {
      encoding: "utf-8",
    });
  }

  /**
   * Resolve the built artifact path for a skill in outDir.
   * @param name Skill directory name.
   * @returns Absolute path to skills/<name>/agents/openai.yaml in outDir.
   */
  function builtYamlPath(name: string): string {
    return path.join(outDir, SKILLS, name, AGENTS, OPENAI_YAML);
  }

  /**
   * Plant a hand-authored agents/openai.yaml under a source skill dir.
   * @param name Skill directory name.
   * @param contents Raw openai.yaml body to author.
   */
  async function writeSourceOpenaiYaml(
    name: string,
    contents: string
  ): Promise<void> {
    const sourceAgentsDir = path.join(srcDir, SKILLS, name, AGENTS);
    await fs.ensureDir(sourceAgentsDir);
    await fs.writeFile(path.join(sourceAgentsDir, OPENAI_YAML), contents);
  }

  it("preserves a source-authored openai.yaml byte-for-byte through the build", async () => {
    await writeSourceSkill(HAND_AUTHORED_SKILL, "Hand-authored skill");
    const handAuthored =
      'display_name: "HAND AUTHORED #550"\n' +
      'short_description: "source-authored sentinel — must survive build"\n' +
      "default_prompt:\n" +
      '  - "Use $exploratory-qa: sentinel"\n';
    await writeSourceOpenaiYaml(HAND_AUTHORED_SKILL, handAuthored);

    const result = runBuildPipeline();

    expect(result.status).toBe(0);
    const built = await fs.readFile(builtYamlPath(HAND_AUTHORED_SKILL), "utf8");
    expect(built).toBe(handAuthored);
  });

  it("still generates openai.yaml for a sibling skill with no source file", async () => {
    await writeSourceSkill(HAND_AUTHORED_SKILL, "Hand-authored skill");
    const handAuthored = 'display_name: "HAND AUTHORED #550"\n';
    await writeSourceOpenaiYaml(HAND_AUTHORED_SKILL, handAuthored);
    // Sibling skill ships no agents/openai.yaml in source.
    await writeSourceSkill(GENERATED_SKILL, "Generated skill");

    const result = runBuildPipeline();

    expect(result.status).toBe(0);
    // Sentinel survived.
    expect(await fs.readFile(builtYamlPath(HAND_AUTHORED_SKILL), "utf8")).toBe(
      handAuthored
    );
    // Sibling received generated output (NOT the sentinel).
    const generated = await fs.readFile(builtYamlPath(GENERATED_SKILL), "utf8");
    expect(generated).not.toBe(handAuthored);
    expect(generated).toContain("display_name:");
    expect(generated).toContain("Apollo Client");
  });
});
