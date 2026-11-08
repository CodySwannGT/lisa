/** Regression coverage for marketplace-only project skill delivery. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISA_SKILLS_SUBDIR,
  installSkills,
} from "../../../src/codex/skills-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("codex/skills-installer", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await fs.ensureDir(destDir);
  });

  afterEach(async () => cleanupTempDir(tempDir));

  /**
   * Seed an authored or Codex-only plugin skill.
   * @param pluginName Plugin directory name.
   * @param skillName Skill directory name.
   * @param codexOnly Whether to use the Codex-only skill root.
   */
  async function seedSkill(
    pluginName: string,
    skillName: string,
    codexOnly = false
  ): Promise<void> {
    await fs.outputFile(
      path.join(
        lisaDir,
        "plugins",
        pluginName,
        ...(codexOnly ? [".codex-plugin", "skills"] : ["skills"]),
        skillName,
        "SKILL.md"
      ),
      `---\nname: ${skillName}\ndescription: Test\n---\n`
    );
  }

  it("catalogs selected plugin skills without writing project copies or links", async () => {
    await seedSkill("lisa", "base");
    await seedSkill("lisa-expo", "expo-only");
    await seedSkill("lisa-rails", "rails-only");

    const result = await installSkills(lisaDir, destDir, [], ["expo"]);
    expect(result.installed.map(skill => skill.name)).toEqual([
      "base",
      "expo-only",
    ]);
    expect(result.managedFiles).toEqual([]);
    expect(
      await fs.pathExists(path.join(destDir, ".codex", LISA_SKILLS_SUBDIR))
    ).toBe(false);
  });

  it("prefers Codex-only plugin variants and deduplicates exact names", async () => {
    await seedSkill("lisa", "shared");
    await seedSkill("lisa", "shared", true);
    const result = await installSkills(lisaDir, destDir, []);
    expect(result.installed).toHaveLength(1);
    expect(result.installed[0]?.relativePath).toContain(
      path.join(".codex-plugin", "skills", "shared")
    );
  });

  it("removes legacy router, library, and native-link artifacts", async () => {
    await fs.outputFile(
      path.join(destDir, ".codex", LISA_SKILLS_SUBDIR, "SKILL.md"),
      "router\n"
    );
    await fs.outputFile(
      path.join(destDir, ".codex", "lisa-library", "skills", "old", "SKILL.md"),
      "old\n"
    );
    const result = await installSkills(lisaDir, destDir, [
      path.join(LISA_SKILLS_SUBDIR, "old-link"),
    ]);
    expect(result.deleted).toEqual(["old-link"]);
    expect(
      await fs.pathExists(path.join(destDir, ".codex", "lisa-library"))
    ).toBe(false);
    expect(
      await fs.pathExists(path.join(destDir, ".codex", LISA_SKILLS_SUBDIR))
    ).toBe(false);
  });
});

/**
 * Regression coverage for issue #774: Lisa must not install maintainer-only
 * internal skills into downstream host-project `.codex/skills/lisa/`.
 */
const SKILL_MD = "SKILL.md";
const PUBLIC_SKILL = "lisa-bug-triage";
const INTERNAL_SKILL = "harness-parity-council";
const INTERNAL_CODEX_SKILL_POLICY = JSON.stringify(
  {
    denylistedSkills: [INTERNAL_SKILL],
  },
  null,
  2
);

describe("codex/skills-installer internal skill policy (#774)", () => {
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
   * Seed a bundled skill into a fake Lisa plugin tree.
   * @param skillName - Skill directory name to create
   */
  async function seedSkill(skillName: string): Promise<void> {
    const skillDir = path.join(lisaDir, "plugins", "lisa", "skills", skillName);
    await fs.ensureDir(skillDir);
    await fs.writeFile(
      path.join(skillDir, SKILL_MD),
      `---\nname: ${skillName}\ndescription: Seeded skill\n---\n`,
      "utf8"
    );
  }

  /**
   * Seed the denylisted-skill policy file under the fake Lisa root.
   */
  async function seedInternalSkillPolicy(): Promise<void> {
    const filePath = path.join(
      lisaDir,
      "scripts",
      "internal-codex-skill-policy.json"
    );
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, INTERNAL_CODEX_SKILL_POLICY, "utf8");
  }

  it("skips denylisted internal skills during host-project installation", async () => {
    await seedInternalSkillPolicy();
    await seedSkill(INTERNAL_SKILL);
    await seedSkill(PUBLIC_SKILL);

    const result = await installSkills(lisaDir, destDir, []);

    expect(result.installed.map(skill => skill.name)).toEqual([PUBLIC_SKILL]);
    expect(
      await fs.pathExists(
        path.join(destDir, ".codex", LISA_SKILLS_SUBDIR, INTERNAL_SKILL)
      )
    ).toBe(false);
    expect(result.managedFiles).not.toContain(
      path.join(LISA_SKILLS_SUBDIR, INTERNAL_SKILL, SKILL_MD)
    );
  });
});
