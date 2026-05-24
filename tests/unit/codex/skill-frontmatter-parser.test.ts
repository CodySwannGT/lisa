/**
 * Unit tests for the SKILL.md YAML-frontmatter parser used by the Codex
 * artifact generator (scripts/generate-codex-plugin-artifacts.mjs).
 *
 * Covers the two acceptance-criteria scenarios from issue #545:
 *  - extracting name + description from a frontmatter block
 *  - returning the skip sentinel (null) when no frontmatter is present
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSkillFrontmatter } from "../../../scripts/generate-codex-plugin-artifacts.mjs";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("codex/skill-frontmatter-parser", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Write a SKILL.md file with the given contents into the test's temp dir.
   * @param contents Raw file body to write.
   * @returns Absolute path to the written SKILL.md.
   */
  async function writeSkill(contents: string): Promise<string> {
    const skillPath = path.join(tempDir, "SKILL.md");
    await fs.writeFile(skillPath, contents);
    return skillPath;
  }

  it("extracts name and description from frontmatter", async () => {
    const skillPath = await writeSkill(
      "---\n" +
        "name: exploratory-qa\n" +
        "description: Playwright-backed exploratory QA workflow for web apps.\n" +
        "---\n\n" +
        "# Exploratory QA\n\nBody text.\n"
    );

    const result = parseSkillFrontmatter(skillPath);

    expect(result).toEqual({
      name: "exploratory-qa",
      description: "Playwright-backed exploratory QA workflow for web apps.",
    });
  });

  it("returns the skip sentinel (null) when there is no frontmatter block", () => {
    const noFrontmatter = path.join(tempDir, "SKILL.md");
    fs.writeFileSync(
      noFrontmatter,
      "# Just a heading\n\nNo frontmatter here.\n"
    );

    expect(parseSkillFrontmatter(noFrontmatter)).toBeNull();
  });

  it("does not throw and returns null for a file with no frontmatter", () => {
    const noFrontmatter = path.join(tempDir, "SKILL.md");
    fs.writeFileSync(noFrontmatter, "plain content, no fences");

    expect(() => parseSkillFrontmatter(noFrontmatter)).not.toThrow();
    expect(parseSkillFrontmatter(noFrontmatter)).toBeNull();
  });

  it("returns null when the opening fence is never closed", async () => {
    const skillPath = await writeSkill(
      "---\nname: unterminated\ndescription: missing closing fence\n"
    );

    expect(parseSkillFrontmatter(skillPath)).toBeNull();
  });

  it("preserves all key/value pairs and strips surrounding quotes", async () => {
    const skillPath = await writeSkill(
      "---\n" +
        'name: "quoted-name"\n' +
        "description: A description with: an embedded colon.\n" +
        "argument-hint: <url>\n" +
        "---\n\n# Body\n"
    );

    const result = parseSkillFrontmatter(skillPath);

    expect(result).toEqual({
      name: "quoted-name",
      description: "A description with: an embedded colon.",
      "argument-hint": "<url>",
    });
  });

  it("ignores blank lines and comment lines inside the block", async () => {
    const skillPath = await writeSkill(
      "---\n" +
        "# a leading comment\n" +
        "\n" +
        "name: with-comments\n" +
        "\n" +
        "description: clean value\n" +
        "---\n\n# Body\n"
    );

    expect(parseSkillFrontmatter(skillPath)).toEqual({
      name: "with-comments",
      description: "clean value",
    });
  });

  it("parses CRLF-authored frontmatter identically to LF", async () => {
    const skillPath = await writeSkill(
      "---\r\nname: crlf-skill\r\ndescription: windows line endings\r\n---\r\n\r\n# Body\r\n"
    );

    expect(parseSkillFrontmatter(skillPath)).toEqual({
      name: "crlf-skill",
      description: "windows line endings",
    });
  });
});
