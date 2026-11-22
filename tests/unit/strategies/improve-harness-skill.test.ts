/**
 * Regression tests for the bounded harness-improvement loop.
 *
 * The loop exists so a failed or expensive factory trajectory produces a
 * *proven* fix rather than a plausible one. The skill's guidance prose (the
 * taxonomy, verdict vocabulary, relevance gate) is not pinned (#4867); this
 * suite guards the structure: the command and skill exist with frontmatter and
 * an argument pass-through, and every generated root carries the skill.
 * @module tests/unit/strategies/improve-harness-skill
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = "plugins/src/base";
const ROOTS = [SOURCE_ROOT, "plugins/lisa"] as const;
const GENERATED_SKILL_ROOTS = [
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;
const COMMAND_REL = "commands/improve-harness.md";
const SKILL_REL = "skills/lisa-improve-harness/SKILL.md";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("improve-harness bounded improvement loop", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = read(root, SKILL_REL);
    const command = read(root, COMMAND_REL);

    it("ships the pass-through command and skill", () => {
      expect(existsSync(path.resolve(root, COMMAND_REL))).toBe(true);
      expect(existsSync(path.resolve(root, SKILL_REL))).toBe(true);
      expect(command).toContain("$ARGUMENTS");
      expect(command).toMatch(/argument-hint:/);
    });

    it("declares improve-harness frontmatter", () => {
      expect(skill).toMatch(/^---/);
      expect(skill).toMatch(/name:\s*lisa-improve-harness/);
      expect(skill).toMatch(/description:/);
    });
  });

  describe.each(GENERATED_SKILL_ROOTS)("generated root %s", root => {
    it("carries the improve-harness skill", () => {
      expect(
        existsSync(path.resolve(root, "lisa-improve-harness/SKILL.md"))
      ).toBe(true);
    });
  });
});
