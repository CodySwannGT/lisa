/**
 * Regression coverage for Codex skill discovery across generated plugin
 * variants.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISA_SKILLS_SUBDIR,
  installSkills,
} from "../../../src/codex/skills-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Reusable bundled-skill name for the variant regression. */
const BUG_TRIAGE = "lisa-bug-triage";
/** Skill manifest filename. */
const SKILL_MD = "SKILL.md";

const SAMPLE_SKILL_MD = `---
name: bug-triage
description: Triage a bug
---

Body content here.
`;

describe("codex/skills-installer variant filtering", () => {
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
   * Write a fake plugin skill tree.
   * @param pluginName - Plugin directory name.
   * @param skillName - Skill directory name.
   * @param files - Relative filename to content map.
   */
  async function seedSkill(
    pluginName: string,
    skillName: string,
    files: Record<string, string>
  ): Promise<void> {
    const skillDir = path.join(
      lisaDir,
      "plugins",
      pluginName,
      "skills",
      skillName
    );
    await fs.ensureDir(skillDir);
    await Promise.all(
      Object.entries(files).map(async ([filename, content]) => {
        const filePath = path.join(skillDir, filename);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, content, "utf8");
      })
    );
  }

  it("installs Codex-shaped artifacts instead of generated cursor variants", async () => {
    const codexContent = `${SAMPLE_SKILL_MD}\nCodex sidecar.\n`;
    const cursorContent = `${SAMPLE_SKILL_MD}\nCursor copy.\n`;
    await seedSkill("lisa", BUG_TRIAGE, {
      [SKILL_MD]: codexContent,
      "agents/openai.yaml": "name: bug-triage\n",
    });
    await seedSkill("lisa-cursor", BUG_TRIAGE, {
      [SKILL_MD]: cursorContent,
    });

    await installSkills(lisaDir, destDir, []);
    const skillDir = path.join(
      destDir,
      ".codex",
      LISA_SKILLS_SUBDIR,
      BUG_TRIAGE
    );

    expect(await fs.readFile(path.join(skillDir, SKILL_MD), "utf8")).toBe(
      codexContent
    );
    expect(
      await fs.pathExists(path.join(skillDir, "agents", "openai.yaml"))
    ).toBe(true);
  });
});
