/**
 * Regression tests for the `/lisa:automation-status` command + skill scaffold.
 *
 * Issue #797 introduces only the distribution surfaces for the new operator
 * command: the base command file, the base skill scaffold, and the generated
 * `plugins/lisa` artifact mirror. The runtime adapters, contract resolution,
 * drift detection, and read-only smoke coverage land in follow-up tickets.
 *
 * This suite proves the scaffold shipped in both plugin roots: the command,
 * skill and report script exist, the command and skill carry their
 * frontmatter, and the report script exports its helpers. The skill's prose
 * is guidance and is reviewed, not pinned (#4867).
 *
 * Both plugin roots are asserted so a missed `bun run build:plugins` fails the
 * suite.
 * @module tests/unit/strategies/automation-status-scaffold
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const COMMAND_REL = "commands/automation-status.md";
const SKILL_REL = "skills/lisa-automation-status/SKILL.md";
const SCRIPT_REL = "scripts/automation-status-report.mjs";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("automation-status scaffold (#797)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    const commandPath = path.resolve(root, COMMAND_REL);
    const skillPath = path.resolve(root, SKILL_REL);
    const scriptPath = path.resolve(root, SCRIPT_REL);

    it("ships the command, skill, and shared report script in this plugin root", () => {
      expect(existsSync(commandPath)).toBe(true);
      expect(existsSync(skillPath)).toBe(true);
      expect(existsSync(scriptPath)).toBe(true);
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
      expect(skill).toMatch(/name:\s*lisa-automation-status/);
      expect(skill).toMatch(/allowed-tools:/);
    });

    it("ships report helper exports for later runtime adapters", () => {
      const script = read(root, SCRIPT_REL);

      expect(script).toContain("computeAutomationFleetVerdict");
      expect(script).toContain("countAutomationHealthStatuses");
      expect(script).toContain("renderAutomationStatusReport");
      expect(script).toMatch(/Overall verdict:/);
      expect(script).toMatch(/Remediation:/);
    });
  });
});
