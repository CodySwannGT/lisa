/**
 * Structural tests for the self-hardening rework-triage loop.
 *
 * The skill's guidance prose (rework detection signals, the cause taxonomy,
 * the upstream routing) is reviewed, not pinned. This suite proves the command
 * and skill ship in every plugin root with the structure the transformers
 * read: skill frontmatter and the command's `$ARGUMENTS` pass-through.
 *
 * Both source and generated plugin roots are asserted so a missed
 * `bun run build:plugins` fails this suite.
 * @module tests/unit/strategies/rework-triage-skill
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
const COMMAND_REL = "commands/rework-triage.md";
const SKILL_REL = "skills/lisa-rework-triage/SKILL.md";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("rework-triage self-hardening loop", () => {
  describe.each(ROOTS)("%s", root => {
    it("ships the pass-through command and skill", () => {
      expect(existsSync(path.resolve(root, COMMAND_REL))).toBe(true);
      expect(existsSync(path.resolve(root, SKILL_REL))).toBe(true);
      expect(read(root, COMMAND_REL)).toContain("$ARGUMENTS");
    });

    it("declares rework-triage frontmatter", () => {
      const skill = read(root, SKILL_REL);
      expect(skill).toMatch(/^---/);
      expect(skill).toMatch(/name:\s*lisa-rework-triage/);
    });
  });

  describe.each(GENERATED_SKILL_ROOTS)("generated root %s", root => {
    it("carries the rework-triage skill", () => {
      expect(
        existsSync(path.resolve(root, "lisa-rework-triage/SKILL.md"))
      ).toBe(true);
    });
  });
});
