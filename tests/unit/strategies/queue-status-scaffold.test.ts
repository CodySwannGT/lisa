/**
 * Regression tests for the `/lisa:queue-status` command + skill scaffold.
 *
 * Issue #820 introduces the initial operator-facing distribution surfaces for
 * queue inspection: the base command file, the base skill scaffold, and the
 * generated `plugins/lisa` artifact mirror. Runtime adapters, lifecycle-role
 * readers, output rendering, smoke coverage, and operator docs land in follow-up
 * tickets.
 *
 * This suite proves the scaffold shipped in both plugin roots: the command
 * and skill exist, the command passes `$ARGUMENTS` through, and the skill
 * frontmatter declares its name and allowed tools. The skill's guidance prose
 * is not pinned (#4867).
 *
 * Both plugin roots are asserted so a missed `bun run build:plugins` fails the
 * suite.
 * @module tests/unit/strategies/queue-status-scaffold
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const COMMAND_REL = "commands/queue-status.md";
const SKILL_REL = "skills/lisa-queue-status/SKILL.md";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("queue-status scaffold (#820)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    const commandPath = path.resolve(root, COMMAND_REL);
    const skillPath = path.resolve(root, SKILL_REL);

    it("ships the command and skill in this plugin root", () => {
      expect(existsSync(commandPath)).toBe(true);
      expect(existsSync(skillPath)).toBe(true);
    });

    it("has command frontmatter and passes $ARGUMENTS through", () => {
      const command = read(root, COMMAND_REL);

      expect(command).toMatch(/^---/);
      expect(command).toMatch(/description:/);
      expect(command).toContain("$ARGUMENTS");
    });

    it("declares name and allowed-tools in skill frontmatter", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/^---/);
      expect(skill).toMatch(/name:\s*lisa-queue-status/);
      expect(skill).toMatch(/allowed-tools:/);
      expect(skill).toContain("Skill");
      expect(skill).toContain("Bash");
      expect(skill).toContain("Read");
    });
  });
});
