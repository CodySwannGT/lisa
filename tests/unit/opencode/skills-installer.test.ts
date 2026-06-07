/**
 * Unit tests for the OpenCode skills installer.
 *
 * Covers:
 *   - Bundled skill directory copy (verbatim, including nested files)
 *   - Command-to-skill conversion (preserve description, strip $ARGUMENTS,
 *     OpenCode runtime label in the compatibility note)
 *   - Skill name namespacing (`lisa-` prefix on commands, raw on skills)
 *   - Maintainer-only denylist (harness-parity-council excluded)
 *   - De-dup across plugins, stale cleanup, never deleting host skills
 *   - Target directory is `.opencode/skills/lisa/` (not `.codex/`)
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISA_SKILLS_SUBDIR,
  installSkills,
} from "../../../src/opencode/skills-installer.js";
import { LISA_COMMAND_SKILL_PREFIX } from "../../../src/core/lisa-skill-sources.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Reusable bundled-skill name for happy-path tests */
const BUG_TRIAGE = "bug-triage";
/** SKILL.md filename — appears in many path joins */
const SKILL_MD = "SKILL.md";
/** Command-derived skill name reused across assertions */
const LISA_FIX = "lisa-fix";
/** Stale-skill folder name reused across cleanup assertions */
const OLD_SKILL = "old-skill";
/** Maintainer-only skill name used in denylist assertions */
const PARITY_COUNCIL = "harness-parity-council";
/** Host-owned skill folder name used in safety assertions */
const HOST_SKILL = "host-skill";
/** OpenCode config dir all artifacts land under */
const OPENCODE_DIR = ".opencode";

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

describe("opencode/skills-installer", () => {
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
   * @param pluginName - Plugin directory name.
   * @param skillName - Skill directory name (matches the `name` frontmatter).
   * @param files - Map of relative-to-skill-dir filename → content.
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
   * @param pluginName - Plugin directory name.
   * @param relPath - Path under commands/ (e.g. "fix.md", "git/commit.md").
   * @param content - Markdown content of the command file.
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
   * Resolve the absolute path of an installed Lisa skill folder file.
   * @param skillName - Installed skill folder name.
   * @param file - File inside the skill folder (default SKILL.md).
   * @returns Absolute path under `.opencode/skills/lisa/`.
   */
  function installedSkillPath(skillName: string, file = SKILL_MD): string {
    return path.join(
      destDir,
      OPENCODE_DIR,
      LISA_SKILLS_SUBDIR,
      skillName,
      file
    );
  }

  it("copies a bundled skill folder verbatim into .opencode/skills/lisa", async () => {
    await seedSkill("lisa", BUG_TRIAGE, {
      [SKILL_MD]: SAMPLE_SKILL_MD,
      "scripts/helper.sh": "#!/bin/bash\necho hi\n",
      "references/REFERENCE.md": "# Reference\n",
    });
    const result = await installSkills(lisaDir, destDir, []);

    expect(await fs.readFile(installedSkillPath(BUG_TRIAGE), "utf8")).toBe(
      SAMPLE_SKILL_MD
    );
    expect(
      await fs.readFile(
        installedSkillPath(BUG_TRIAGE, "scripts/helper.sh"),
        "utf8"
      )
    ).toContain("echo hi");
    expect(result.installed.find(s => s.name === BUG_TRIAGE)?.source).toBe(
      "bundled"
    );
  });

  it("converts a top-level command into a lisa- prefixed skill", async () => {
    await seedCommand("lisa", "fix.md", SAMPLE_COMMAND_MD);
    const result = await installSkills(lisaDir, destDir, []);

    const skillPath = installedSkillPath(`${LISA_COMMAND_SKILL_PREFIX}fix`);
    expect(await fs.pathExists(skillPath)).toBe(true);
    const content = await fs.readFile(skillPath, "utf8");
    expect(content).toMatch(/name: lisa-fix\n/);
    expect(content).not.toContain("$ARGUMENTS");
    expect(result.installed.find(s => s.name === LISA_FIX)?.source).toBe(
      "command"
    );
  });

  it("labels the command compatibility note for OpenCode (not Codex)", async () => {
    await seedCommand("lisa", "fix.md", SAMPLE_COMMAND_MD);
    await installSkills(lisaDir, destDir, []);
    const content = await fs.readFile(
      installedSkillPath(`${LISA_COMMAND_SKILL_PREFIX}fix`),
      "utf8"
    );
    expect(content).toContain("OpenCode invocation: `$lisa-fix`");
    expect(content).not.toContain("Codex invocation");
  });

  it("converts a nested command using dash-joined namespace", async () => {
    await seedCommand("lisa", "git/commit.md", SAMPLE_COMMAND_MD);
    const skillName = `${LISA_COMMAND_SKILL_PREFIX}git-commit`;
    const result = await installSkills(lisaDir, destDir, []);

    expect(await fs.pathExists(installedSkillPath(skillName))).toBe(true);
    expect(result.installed.find(s => s.name === skillName)?.source).toBe(
      "command"
    );
  });

  it("excludes maintainer-only skills on the denylist", async () => {
    await fs.ensureDir(path.join(lisaDir, "scripts"));
    await fs.writeFile(
      path.join(lisaDir, "scripts", "internal-opencode-skill-policy.json"),
      JSON.stringify({ denylistedSkills: [PARITY_COUNCIL] }),
      "utf8"
    );
    await seedSkill("lisa", PARITY_COUNCIL, {
      [SKILL_MD]: SAMPLE_SKILL_MD.replace("bug-triage", PARITY_COUNCIL),
    });
    await seedSkill("lisa", BUG_TRIAGE, { [SKILL_MD]: SAMPLE_SKILL_MD });
    const result = await installSkills(lisaDir, destDir, []);

    const names = result.installed.map(s => s.name);
    expect(names).toContain(BUG_TRIAGE);
    expect(names).not.toContain(PARITY_COUNCIL);
    expect(await fs.pathExists(installedSkillPath(PARITY_COUNCIL))).toBe(false);
  });

  it("returns managedFiles including bundled and command-derived skills", async () => {
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
      path.join(LISA_SKILLS_SUBDIR, LISA_FIX, SKILL_MD)
    );
  });

  it("de-duplicates skills by name across plugins (stack wins over base)", async () => {
    const railsContent = SAMPLE_SKILL_MD.replace(
      "Triage a bug",
      "Rails version"
    );
    await seedSkill("lisa", BUG_TRIAGE, { [SKILL_MD]: SAMPLE_SKILL_MD });
    await seedSkill("lisa-rails", BUG_TRIAGE, { [SKILL_MD]: railsContent });
    const result = await installSkills(lisaDir, destDir, []);

    expect(result.installed.filter(s => s.name === BUG_TRIAGE)).toHaveLength(1);
    expect(await fs.readFile(installedSkillPath(BUG_TRIAGE), "utf8")).toBe(
      railsContent
    );
  });

  it("deletes stale skills managed previously but not shipped now", async () => {
    await seedSkill("lisa", BUG_TRIAGE, { [SKILL_MD]: SAMPLE_SKILL_MD });
    const skillsDir = path.join(destDir, OPENCODE_DIR, LISA_SKILLS_SUBDIR);
    await fs.ensureDir(path.join(skillsDir, OLD_SKILL));
    await fs.writeFile(
      path.join(skillsDir, OLD_SKILL, SKILL_MD),
      "stale",
      "utf8"
    );
    const previousManagedFiles = [
      path.join(LISA_SKILLS_SUBDIR, BUG_TRIAGE, SKILL_MD),
      path.join(LISA_SKILLS_SUBDIR, OLD_SKILL, SKILL_MD),
    ];
    const result = await installSkills(lisaDir, destDir, previousManagedFiles);

    expect(result.deleted).toEqual([OLD_SKILL]);
    expect(await fs.pathExists(path.join(skillsDir, OLD_SKILL))).toBe(false);
    expect(await fs.pathExists(path.join(skillsDir, BUG_TRIAGE))).toBe(true);
  });

  it("never deletes skills outside .opencode/skills/lisa/", async () => {
    await seedSkill("lisa", BUG_TRIAGE, { [SKILL_MD]: SAMPLE_SKILL_MD });
    const hostSkillsDir = path.join(destDir, OPENCODE_DIR, "skills", "host");
    await fs.ensureDir(path.join(hostSkillsDir, HOST_SKILL));
    await fs.writeFile(
      path.join(hostSkillsDir, HOST_SKILL, SKILL_MD),
      "host-owned",
      "utf8"
    );
    const result = await installSkills(lisaDir, destDir, [
      path.join("skills", "host", HOST_SKILL, SKILL_MD),
    ]);

    expect(result.deleted).toEqual([]);
    expect(await fs.pathExists(path.join(hostSkillsDir, HOST_SKILL))).toBe(
      true
    );
  });

  it("idempotent: running twice produces the same files", async () => {
    await seedSkill("lisa", BUG_TRIAGE, { [SKILL_MD]: SAMPLE_SKILL_MD });
    await seedCommand("lisa", "fix.md", SAMPLE_COMMAND_MD);

    await installSkills(lisaDir, destDir, []);
    const skillFirst = await fs.readFile(
      installedSkillPath(BUG_TRIAGE),
      "utf8"
    );
    const cmdFirst = await fs.readFile(installedSkillPath(LISA_FIX), "utf8");

    await installSkills(lisaDir, destDir, []);
    expect(await fs.readFile(installedSkillPath(BUG_TRIAGE), "utf8")).toBe(
      skillFirst
    );
    expect(await fs.readFile(installedSkillPath(LISA_FIX), "utf8")).toBe(
      cmdFirst
    );
  });
});
