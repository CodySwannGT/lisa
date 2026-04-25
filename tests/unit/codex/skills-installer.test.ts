/**
 * Unit tests for the Codex skills installer.
 *
 * Covers:
 *   - Bundled skill directory copy (verbatim, including nested files)
 *   - Command-to-skill conversion (preserve description, strip $ARGUMENTS)
 *   - Skill name namespacing (`lisa-` prefix on commands, raw on skills)
 *   - Manifest file tracking
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISA_COMMAND_SKILL_PREFIX,
  LISA_SKILLS_SUBDIR,
  installSkills,
} from "../../../src/codex/skills-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Reusable bundled-skill name for happy-path tests */
const BUG_TRIAGE = "bug-triage";
/** SKILL.md filename — appears in many path joins */
const SKILL_MD = "SKILL.md";
/** Host-skill folder used in safety/no-delete tests */
const HOST_SKILL = "host-skill";

const SAMPLE_SKILL_MD = `---
name: bug-triage
description: Triage a bug
---

Body content here.
`;

const SAMPLE_COMMAND_MD = `---
description: "Fix a bug. Reproduces, analyzes, fixes via TDD."
argument-hint: "<description>"
---

Apply the intent-routing rule and execute the Implement flow.

$ARGUMENTS
`;

describe("codex/skills-installer", () => {
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
   * Write a fake plugin tree under <lisaDir>/plugins/<plugin>/skills/<n>/.
   * @param pluginName - Plugin directory name
   * @param skillName - Skill directory name (matches the `name` frontmatter)
   * @param files - Map of relative-to-skill-dir filename → content
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
    for (const [filename, content] of Object.entries(files)) {
      const filePath = path.join(skillDir, filename);
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, content, "utf8");
    }
  }

  /**
   * Write a fake command file under plugins/<plugin>/commands/<...path>.md.
   * @param pluginName - Plugin directory name
   * @param relPath - Path under commands/ (e.g. "fix.md", "git/commit.md")
   * @param content - Markdown content of the command file
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

  describe("installSkills", () => {
    it("copies a bundled skill folder verbatim", async () => {
      await seedSkill("lisa", BUG_TRIAGE, {
        [SKILL_MD]: SAMPLE_SKILL_MD,
        "scripts/helper.sh": "#!/bin/bash\necho hi\n",
        "references/REFERENCE.md": "# Reference\n",
      });
      const result = await installSkills(lisaDir, destDir, []);

      const skillDir = path.join(
        destDir,
        ".codex",
        LISA_SKILLS_SUBDIR,
        BUG_TRIAGE
      );
      expect(await fs.readFile(path.join(skillDir, SKILL_MD), "utf8")).toBe(
        SAMPLE_SKILL_MD
      );
      expect(
        await fs.readFile(path.join(skillDir, "scripts/helper.sh"), "utf8")
      ).toContain("echo hi");
      expect(
        await fs.readFile(
          path.join(skillDir, "references/REFERENCE.md"),
          "utf8"
        )
      ).toContain("# Reference");

      expect(result.installed.find(s => s.name === BUG_TRIAGE)?.source).toBe(
        "bundled"
      );
    });

    it("converts a top-level command into a lisa- prefixed skill", async () => {
      await seedCommand("lisa", "fix.md", SAMPLE_COMMAND_MD);
      const result = await installSkills(lisaDir, destDir, []);

      const skillPath = path.join(
        destDir,
        ".codex",
        LISA_SKILLS_SUBDIR,
        `${LISA_COMMAND_SKILL_PREFIX}fix`,
        SKILL_MD
      );
      expect(await fs.pathExists(skillPath)).toBe(true);
      const content = await fs.readFile(skillPath, "utf8");
      expect(content).toMatch(/name: lisa-fix\n/);
      expect(content).not.toContain("$ARGUMENTS");

      expect(result.installed.find(s => s.name === "lisa-fix")?.source).toBe(
        "command"
      );
    });

    it("converts a nested command using dash-joined namespace", async () => {
      await seedCommand("lisa", "git/commit.md", SAMPLE_COMMAND_MD);
      const result = await installSkills(lisaDir, destDir, []);

      const skillName = `${LISA_COMMAND_SKILL_PREFIX}git-commit`;
      const skillPath = path.join(
        destDir,
        ".codex",
        LISA_SKILLS_SUBDIR,
        skillName,
        SKILL_MD
      );
      expect(await fs.pathExists(skillPath)).toBe(true);
      const content = await fs.readFile(skillPath, "utf8");
      expect(content).toMatch(new RegExp(`name: ${skillName}\\n`));

      expect(result.installed.find(s => s.name === skillName)?.source).toBe(
        "command"
      );
    });

    it("ignores non-md files in the commands tree", async () => {
      await seedCommand("lisa", "fix.md", SAMPLE_COMMAND_MD);
      await seedCommand("lisa", "README.txt", "just a readme");
      const result = await installSkills(lisaDir, destDir, []);
      expect(result.installed.find(s => s.name === "lisa-fix")).toBeDefined();
      expect(
        result.installed.find(s => s.name.includes("README"))
      ).toBeUndefined();
    });

    it("returns managedFiles list including bundled and command-derived skills", async () => {
      await seedSkill("lisa", BUG_TRIAGE, {
        [SKILL_MD]: SAMPLE_SKILL_MD,
        "scripts/helper.sh": "#!/bin/bash\n",
      });
      await seedCommand("lisa", "fix.md", SAMPLE_COMMAND_MD);

      const result = await installSkills(lisaDir, destDir, []);
      expect(result.managedFiles).toContain(
        path.join(LISA_SKILLS_SUBDIR, BUG_TRIAGE, SKILL_MD)
      );
      expect(result.managedFiles).toContain(
        path.join(LISA_SKILLS_SUBDIR, BUG_TRIAGE, "scripts", "helper.sh")
      );
      expect(result.managedFiles).toContain(
        path.join(LISA_SKILLS_SUBDIR, "lisa-fix", SKILL_MD)
      );
    });

    it("de-duplicates skills by name across plugins (stack plugin wins over base lisa)", async () => {
      await seedSkill("lisa", BUG_TRIAGE, {
        [SKILL_MD]: SAMPLE_SKILL_MD,
      });
      await seedSkill("lisa-rails", BUG_TRIAGE, {
        [SKILL_MD]: SAMPLE_SKILL_MD.replace(BUG_TRIAGE, "bug-triage-rails"),
      });
      const result = await installSkills(lisaDir, destDir, []);
      const installedNames = result.installed.map(s => s.name);
      expect(installedNames.filter(n => n === BUG_TRIAGE)).toHaveLength(1);
    });

    it("non-base plugin whose name sorts before 'lisa' alphabetically still wins over base lisa", async () => {
      // "aardvark" sorts before "lisa" alphabetically.
      // With a naive alphabetical sort + last-wins-Map, lisa would overwrite
      // aardvark. The fix (base lisa first, others after) ensures any non-base
      // plugin wins regardless of its sort position.
      const baseContent = `---\nname: ${BUG_TRIAGE}\ndescription: Base description\n---\n\nBase body.\n`;
      const stackContent = `---\nname: ${BUG_TRIAGE}\ndescription: Stack description\n---\n\nStack body.\n`;
      await seedSkill("lisa", BUG_TRIAGE, { [SKILL_MD]: baseContent });
      await seedSkill("aardvark", BUG_TRIAGE, { [SKILL_MD]: stackContent });
      await installSkills(lisaDir, destDir, []);
      const written = await fs.readFile(
        path.join(destDir, ".codex", LISA_SKILLS_SUBDIR, BUG_TRIAGE, SKILL_MD),
        "utf8"
      );
      // Non-base plugins win over base lisa regardless of alphabetical sort order
      expect(written).toContain("Stack description");
    });

    it("deletes stale skills that were managed previously but not shipped now", async () => {
      // Seed only one skill; manifest claims two existed before
      await seedSkill("lisa", BUG_TRIAGE, { [SKILL_MD]: SAMPLE_SKILL_MD });
      const skillsDir = path.join(destDir, ".codex", LISA_SKILLS_SUBDIR);
      await fs.ensureDir(skillsDir);
      // Simulate stale leftover
      await fs.ensureDir(path.join(skillsDir, "old-skill"));
      await fs.writeFile(
        path.join(skillsDir, "old-skill", SKILL_MD),
        "stale",
        "utf8"
      );

      const previousManagedFiles = [
        path.join(LISA_SKILLS_SUBDIR, BUG_TRIAGE, SKILL_MD),
        path.join(LISA_SKILLS_SUBDIR, "old-skill", SKILL_MD),
      ];
      const result = await installSkills(
        lisaDir,
        destDir,
        previousManagedFiles
      );

      expect(result.deleted).toEqual(["old-skill"]);
      expect(await fs.pathExists(path.join(skillsDir, "old-skill"))).toBe(
        false
      );
      expect(await fs.pathExists(path.join(skillsDir, BUG_TRIAGE))).toBe(true);
    });

    it("never deletes skills outside .codex/skills/lisa/", async () => {
      await seedSkill("lisa", BUG_TRIAGE, { [SKILL_MD]: SAMPLE_SKILL_MD });
      const hostSkillsDir = path.join(destDir, ".codex", "skills", "host");
      await fs.ensureDir(path.join(hostSkillsDir, HOST_SKILL));
      await fs.writeFile(
        path.join(hostSkillsDir, HOST_SKILL, SKILL_MD),
        "host-owned",
        "utf8"
      );
      const previousManagedFiles = [
        path.join("skills", "host", HOST_SKILL, SKILL_MD),
      ];
      const result = await installSkills(
        lisaDir,
        destDir,
        previousManagedFiles
      );

      expect(result.deleted).toEqual([]);
      expect(await fs.pathExists(path.join(hostSkillsDir, HOST_SKILL))).toBe(
        true
      );
    });

    it("idempotent: running twice produces the same files", async () => {
      await seedSkill("lisa", BUG_TRIAGE, {
        [SKILL_MD]: SAMPLE_SKILL_MD,
      });
      await seedCommand("lisa", "fix.md", SAMPLE_COMMAND_MD);

      await installSkills(lisaDir, destDir, []);
      const skillFile = path.join(
        destDir,
        ".codex",
        LISA_SKILLS_SUBDIR,
        BUG_TRIAGE,
        SKILL_MD
      );
      const cmdFile = path.join(
        destDir,
        ".codex",
        LISA_SKILLS_SUBDIR,
        "lisa-fix",
        SKILL_MD
      );
      const skillFirst = await fs.readFile(skillFile, "utf8");
      const cmdFirst = await fs.readFile(cmdFile, "utf8");

      await installSkills(lisaDir, destDir, []);
      expect(await fs.readFile(skillFile, "utf8")).toBe(skillFirst);
      expect(await fs.readFile(cmdFile, "utf8")).toBe(cmdFirst);
    });
  });
});
