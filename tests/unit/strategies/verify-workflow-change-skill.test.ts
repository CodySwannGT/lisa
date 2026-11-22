/**
 * Regression tests for the workflow-change verification skill.
 *
 * Issue #1615 adds a Lisa skill for pre-merge GitHub Actions workflow proof.
 * These assertions cover structure only: the command and skill ship in every
 * plugin root, the command forwards `$ARGUMENTS`, and the skill's frontmatter
 * names it and declares its tools. The procedure prose is guidance and is
 * reviewed, not pinned (#4867).
 * @module tests/unit/strategies/verify-workflow-change-skill
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const GENERATED_SKILL_ROOTS = [
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;
const COMMAND_REL = "commands/verify-workflow-change.md";
const SKILL_REL = "skills/lisa-verify-workflow-change/SKILL.md";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("verify workflow change skill (#1615)", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = read(root, SKILL_REL);
    const command = read(root, COMMAND_REL);

    it("ships the pass-through command and skill", () => {
      expect(existsSync(path.resolve(root, COMMAND_REL))).toBe(true);
      expect(existsSync(path.resolve(root, SKILL_REL))).toBe(true);
      expect(command).toContain("$ARGUMENTS");
    });

    it("declares workflow verification frontmatter", () => {
      expect(skill).toMatch(/^---/);
      expect(skill).toMatch(/name:\s*lisa-verify-workflow-change/);
      expect(skill).toContain('allowed-tools: ["Bash", "Read"]');
    });
  });

  it.each(GENERATED_SKILL_ROOTS)(
    "ships the generated skill for %s",
    skillRoot => {
      expect(
        existsSync(
          path.resolve(skillRoot, "lisa-verify-workflow-change", "SKILL.md")
        )
      ).toBe(true);
    }
  );
});
