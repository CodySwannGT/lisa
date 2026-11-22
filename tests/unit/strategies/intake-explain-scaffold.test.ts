/**
 * Regression tests for the `/lisa:intake-explain` command + skill scaffold.
 *
 * Issue #843 introduces the initial distribution surfaces for the per-item
 * intake/repair diagnosis flow: the base command file, the base skill scaffold,
 * and the generated `plugins/lisa` artifact mirror.
 *
 * The skill's guidance prose is reviewed, not pinned. This suite proves the
 * scaffold shipped in both plugin roots with the structure the command and
 * skill transformers read: frontmatter, the skill's `name` and
 * `allowed-tools`, and the `$ARGUMENTS` pass-through the Codex transformer
 * rewrites.
 *
 * Both plugin roots are asserted so a missed `bun run build:plugins` fails the
 * suite.
 * @module tests/unit/strategies/intake-explain-scaffold
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const COMMAND_REL = "commands/intake-explain.md";
const SKILL_REL = "skills/lisa-intake-explain/SKILL.md";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("intake-explain scaffold (#843)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    const commandPath = path.resolve(root, COMMAND_REL);
    const skillPath = path.resolve(root, SKILL_REL);

    it("ships the command and skill in this plugin root", () => {
      expect(existsSync(commandPath)).toBe(true);
      expect(existsSync(skillPath)).toBe(true);
    });

    it("uses a pass-through command with frontmatter and $ARGUMENTS", () => {
      const command = read(root, COMMAND_REL);

      expect(command).toMatch(/^---/);
      expect(command).toMatch(/description:/);
      expect(command).toContain("$ARGUMENTS");
    });

    it("declares the skill's name and allowed tools in frontmatter", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/^---/);
      expect(skill).toMatch(/name:\s*lisa-intake-explain/);
      expect(skill).toMatch(/allowed-tools:/);
    });
  });
});
