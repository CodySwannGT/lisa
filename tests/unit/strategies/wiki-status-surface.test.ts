/**
 * Regression tests for the Lisa wiki freshness status command and skill surfaces.
 *
 * Issue #929 exposes the deterministic wiki-status renderer through Claude
 * command and Codex skill surfaces. These assertions cover structure: the
 * files ship, their frontmatter, and source/generated parity. The skill's
 * prose is guidance and is reviewed, not pinned (#4867).
 * @module tests/unit/strategies/wiki-status-surface
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_PLUGIN_ROOT = "plugins/src/wiki";
const GENERATED_PLUGIN_ROOT = "plugins/lisa-wiki";
const PLUGIN_ROOTS = [SOURCE_PLUGIN_ROOT, GENERATED_PLUGIN_ROOT] as const;
const COMMAND_REL = "commands/status.md";
const SKILL_REL = "skills/lisa-wiki-status/SKILL.md";
const SCRIPT_REL = "scripts/wiki-status.mjs";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("wiki status command and skill surfaces (#929)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    it("ships the command, skill, and renderer script in this plugin root", () => {
      expect(existsSync(path.resolve(root, COMMAND_REL))).toBe(true);
      expect(existsSync(path.resolve(root, SKILL_REL))).toBe(true);
      expect(existsSync(path.resolve(root, SCRIPT_REL))).toBe(true);
    });

    it("ships a pass-through command that forwards its arguments", () => {
      const command = read(root, COMMAND_REL);

      expect(command).toMatch(/^---/);
      expect(command).toMatch(/description:/);
      expect(command).toContain("$ARGUMENTS");
    });

    it("declares the skill's frontmatter", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/^---/);
      expect(skill).toMatch(/name:\s*lisa-wiki-status/);
      expect(skill).toMatch(/allowed-tools:/);
    });
  });
});

describe("wiki status source/generated parity (#931)", () => {
  it("keeps the distributed status command in lockstep with the source command", () => {
    expect(read(GENERATED_PLUGIN_ROOT, COMMAND_REL)).toBe(
      read(SOURCE_PLUGIN_ROOT, COMMAND_REL)
    );
  });

  it("keeps the distributed status skill in lockstep with the source skill", () => {
    expect(read(GENERATED_PLUGIN_ROOT, SKILL_REL)).toBe(
      read(SOURCE_PLUGIN_ROOT, SKILL_REL)
    );
  });
});
