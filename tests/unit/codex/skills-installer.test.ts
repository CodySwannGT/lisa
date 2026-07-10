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
