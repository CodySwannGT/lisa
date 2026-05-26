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
 *   (4) the skill names the expected queue verdicts and vendor families.
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
const SKILL_REL = "skills/queue-status/SKILL.md";

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
      expect(command).toMatch(/Use the \/lisa:queue-status skill/);
      expect(command).toContain("$ARGUMENTS");
    });

    it("documents a read-only, repo-scoped queue inspection surface", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/^---/);
      expect(skill).toMatch(/name:\s*queue-status/);
      expect(skill).toMatch(/allowed-tools:/);
      expect(skill).toContain("Skill");
      expect(skill).toContain("Bash");
      expect(skill).toContain("Read");
      expect(skill).toMatch(/read-only/i);
      expect(skill).toMatch(/current repo|current project/i);
      expect(skill).toMatch(
        /do \*\*not\*\* ask for confirmation|do not ask for confirmation/i
      );
    });

    it("reuses intake and repair-intake contract semantics", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/intake/);
      expect(skill).toMatch(/repair-intake/);
      expect(skill).toMatch(/same contract/i);
      expect(skill).toMatch(
        /do \*\*not\*\* invent a second source of truth|do not invent a second source of truth/i
      );
      expect(skill).toMatch(/queue source/i);
      expect(skill).toMatch(/build tracker/i);
    });

    it("names the expected queue verdicts and supported vendor families", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/IDLE/);
      expect(skill).toMatch(/HEALTHY/);
      expect(skill).toMatch(/ATTENTION_NEEDED/);
      expect(skill).toMatch(/MISCONFIGURED/);
      expect(skill).toMatch(/GitHub/);
      expect(skill).toMatch(/Linear/);
      expect(skill).toMatch(/JIRA/);
      expect(skill).toMatch(/Notion/);
      expect(skill).toMatch(/Confluence/);
    });

    it("documents the queue selector and actionable-highlight expectations", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/queue=prd/);
      expect(skill).toMatch(/queue=build/);
      expect(skill).toMatch(/blocked/i);
      expect(skill).toMatch(/in-review|in review/i);
      expect(skill).toMatch(/claimed/i);
      expect(skill).toMatch(/shipped/i);
      expect(skill).toMatch(/remediation/i);
    });
  });
});
