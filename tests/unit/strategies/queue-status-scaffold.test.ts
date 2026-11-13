/**
 * Regression tests for the `/lisa:queue-status` command + skill scaffold.
 *
 * Issue #820 introduces the initial operator-facing distribution surfaces for
 * queue inspection: the base command file, the base skill scaffold, and the
 * generated `plugins/lisa` artifact mirror. Runtime adapters, lifecycle-role
 * readers, output rendering, smoke coverage, and operator docs land in follow-up
 * tickets.
 *
 * This suite proves the scaffold shipped in both plugin roots and documents the
 * intended contract clearly enough for the later implementation work:
 *   (1) the command delegates to `/lisa:queue-status`;
 *   (2) the skill is read-only and repo-scoped;
 *   (3) the skill reuses intake and repair-intake contract semantics rather than
 *       inventing a second source of truth;
 *   (4) the skill names the expected queue verdicts and vendor families;
 *   (5) the skill defines a grouped PRD/build output shape with an overall
 *       verdict and concise remediation guidance.
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

    it("uses a pass-through command that delegates to /lisa:queue-status", () => {
      const command = read(root, COMMAND_REL);

      expect(command).toMatch(/^---/);
      expect(command).toMatch(/description:/);
      expect(command).toMatch(/Use the \/lisa-queue-status skill/);
      expect(command).toContain("$ARGUMENTS");
    });

    it("documents a read-only, repo-scoped queue inspection surface", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/^---/);
      expect(skill).toMatch(/name:\s*lisa-queue-status/);
      expect(skill).toMatch(/allowed-tools:/);
    });

    it("names the expected queue verdicts and supported vendor families", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/IDLE/);
      expect(skill).toMatch(/HEALTHY/);
      expect(skill).toMatch(/ATTENTION_NEEDED/);
      expect(skill).toMatch(/MISCONFIGURED/);
      expect(skill).toMatch(/JIRA/);
    });

    it("documents the queue selector and actionable-highlight expectations", () => {
      const skill = read(root, SKILL_REL);
      expect(skill).toMatch(/queue=build/);
    });

    it("defines grouped queue sections and overall-verdict mapping", () => {
      const skill = read(root, SKILL_REL);
      expect(skill).toMatch(
        /`MISCONFIGURED` if any inspected queue is misconfigured/i
      );
      expect(skill).toMatch(
        /`ATTENTION_NEEDED` if any inspected queue needs operator follow-up/i
      );
      expect(skill).toMatch(/Otherwise `HEALTHY`|Otherwise HEALTHY/i);
      expect(skill).toMatch(/Otherwise `IDLE`|Otherwise IDLE/i);
    });
  });
});
