/**
 * Regression tests for the `/lisa:intake-explain` command + skill scaffold.
 *
 * Issue #843 introduces the initial distribution surfaces for the per-item
 * intake/repair diagnosis flow: the base command file, the base skill scaffold,
 * and the generated `plugins/lisa` artifact mirror. The lifecycle readers,
 * verdict renderer, vendor adapters, and read-only smoke coverage land in the
 * follow-up tickets under PRD #838.
 *
 * This suite proves the scaffold shipped in both plugin roots and documents the
 * intended contract clearly enough for later implementation work:
 *   (1) the command delegates to `/lisa:intake-explain`;
 *   (2) the skill is read-only and scoped to one repo/project item;
 *   (3) the skill reuses `lisa-intake` / `repair-intake` contract semantics rather
 *       than inventing a second source of truth;
 *   (4) the skill names the expected verdict families and supported vendors;
 *   (5) the skill defines a stable per-item output shape and next-action model.
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

    it("uses a pass-through command that delegates to /lisa:intake-explain", () => {
      const command = read(root, COMMAND_REL);

      expect(command).toMatch(/^---/);
      expect(command).toMatch(/description:/);
      expect(command).toContain('argument-hint: "<item-ref>"');
      expect(command).toMatch(/Use the \/lisa-intake-explain skill/);
      expect(command).toContain("$ARGUMENTS");
    });

    it("documents a read-only, single-item operator surface", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/^---/);
      expect(skill).toMatch(/name:\s*lisa-intake-explain/);
      expect(skill).toMatch(/allowed-tools:/);
    });

    it("names the expected verdict families and supported vendors", () => {
      const skill = read(root, SKILL_REL);
      expect(skill).toMatch(/MISCONFIGURED/);
      expect(skill).toMatch(/JIRA/);
    });

    it("documents the key gate families and next-action handoff", () => {
      const skill = read(root, SKILL_REL);
      expect(skill).toMatch(/\/lisa:intake/);
      expect(skill).toMatch(/\/lisa:repair-intake/);
    });

    it("defines a stable per-item output shape", () => {
      const skill = read(root, SKILL_REL);
      expect(skill).toMatch(/Lifecycle: <PRD\|BUILD>/);
      expect(skill).toMatch(/Verdict: <VERDICT>/);
    });
  });
});
