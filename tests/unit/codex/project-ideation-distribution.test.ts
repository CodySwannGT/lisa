/**
 * Regression coverage for issue #670: project-ideation must ship from the base
 * plugin source into the generated Lisa plugin with Codex runtime metadata.
 * @module tests/unit/codex/project-ideation-distribution
 */
import * as fs from "fs-extra";
import { load as parseYaml } from "js-yaml";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SKILL_NAME = "lisa-project-ideation";
const SOURCE_SKILL = path.join(
  REPO_ROOT,
  "plugins",
  "src",
  "base",
  "skills",
  SKILL_NAME,
  "SKILL.md"
);
const BUILT_SKILL = path.join(
  REPO_ROOT,
  "plugins",
  "lisa",
  "skills",
  SKILL_NAME,
  "SKILL.md"
);
const BUILT_OPENAI_YAML = path.join(
  REPO_ROOT,
  "plugins",
  "lisa",
  "skills",
  SKILL_NAME,
  "agents",
  "openai.yaml"
);
const CODEX_MANIFEST = path.join(
  REPO_ROOT,
  "plugins",
  "lisa",
  ".codex-plugin",
  "plugin.json"
);

describe("codex/project-ideation-distribution (#670)", () => {
  it("ships project-ideation from base source into Lisa plugin artifacts", async () => {
    await expect(fs.pathExists(SOURCE_SKILL)).resolves.toBe(true);
    await expect(fs.pathExists(BUILT_SKILL)).resolves.toBe(true);

    const sourceSkill = await fs.readFile(SOURCE_SKILL, "utf8");
    const builtSkill = await fs.readFile(BUILT_SKILL, "utf8");

    expect(builtSkill).toBe(sourceSkill);
    expect(builtSkill).toContain("name: lisa-project-ideation");
    expect(builtSkill).toContain("Practicality gate");
    expect(builtSkill).toContain("Empirical verification gate");
  });

  it("emits Codex runtime metadata for project-ideation", async () => {
    const manifest = await fs.readJson(CODEX_MANIFEST);
    const openaiYaml = await fs.readFile(BUILT_OPENAI_YAML, "utf8");
    const metadata = parseYaml(openaiYaml) as {
      default_prompt?: unknown;
      display_name?: unknown;
      short_description?: unknown;
    };

    expect(manifest.skills).toBe("./skills/");
    expect(metadata.display_name).toBe("Project Ideation");
    expect(metadata.short_description).toBe(
      "Generate practical, verifiable product or workflow ideas for the current host project"
    );
    expect(metadata.default_prompt).toEqual(
      expect.arrayContaining([
        "Use $lisa-project-ideation: Generate practical feature ideas for this project.",
        "Use $lisa-project-ideation: Looking at an external public product, what should we add here?",
        "Use $lisa-project-ideation: Suggest practical improvements we can verify ourselves.",
      ])
    );
  });
});
