/**
 * Regression tests for the Lisa wiki freshness status command and skill surfaces.
 *
 * Issue #929 exposes the deterministic wiki-status renderer through Claude
 * command and Codex skill surfaces while keeping the operation read-only.
 * @module tests/unit/strategies/wiki-status-surface
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/wiki", "plugins/lisa-wiki"] as const;
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

    it("uses a pass-through command that delegates to lisa-wiki-status", () => {
      const command = read(root, COMMAND_REL);

      expect(command).toMatch(/^---/);
      expect(command).toMatch(/description:/);
      expect(command).toMatch(/Use the lisa-wiki-status skill/);
      expect(command).toContain("$ARGUMENTS");
    });

    it("documents a read-only freshness surface backed by repository evidence", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/^---/);
      expect(skill).toMatch(/name:\s*lisa-wiki-status/);
      expect(skill).toMatch(/allowed-tools:/);
      expect(skill).toContain("Bash");
      expect(skill).toContain("Read");
      expect(skill).toMatch(/read-only/i);
      expect(skill).toContain("wiki/lisa-wiki.config.json");
      expect(skill).toContain("wiki/log.md");
      expect(skill).toContain("wiki/sources/**");
      expect(skill).toContain("wiki/state/**");
    });

    it("names freshness verdicts, targeted next actions, and lint separation", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toContain("fresh");
      expect(skill).toContain("stale");
      expect(skill).toContain("never_ingested");
      expect(skill).toContain("skipped");
      expect(skill).toContain("blocked");
      expect(skill).toMatch(/exact next action/i);
      expect(skill).toMatch(/lisa-wiki-lint/);
      expect(skill).toMatch(/Do not conflate freshness/i);
    });
  });
});
