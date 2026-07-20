/**
 * Regression tests for the `/lisa:automation-status` command + skill scaffold.
 *
 * Issue #797 introduces only the distribution surfaces for the new operator
 * command: the base command file, the base skill scaffold, and the generated
 * `plugins/lisa` artifact mirror. The runtime adapters, contract resolution,
 * drift detection, and read-only smoke coverage land in follow-up tickets.
 *
 * This suite proves the scaffold shipped in both plugin roots and documents the
 * intended contract clearly enough for the later implementation work:
 *   (1) the command delegates to `/lisa:automation-status`;
 *   (2) the skill is read-only and repo-scoped;
 *   (3) the skill reuses `setup-automations` / `tear-down-automations`
 *       contract semantics rather than inventing a second source of truth;
 *   (4) the skill names the expected fleet outcomes and runtime branches.
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

    it("uses a pass-through command that delegates to /lisa:automation-status", () => {
      const command = read(root, COMMAND_REL);

      expect(command).toMatch(/^---/);
      expect(command).toMatch(/description:/);
      expect(command).toMatch(/Use the \/lisa-automation-status skill/);
      expect(command).toContain("$ARGUMENTS");
    });

    it("documents a read-only, repo-scoped operator surface", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/^---/);
      expect(skill).toMatch(/name:\s*lisa-automation-status/);
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

    it("reuses setup-automations contract semantics instead of inventing new ones", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/setup-automations/);
      expect(skill).toMatch(/tear-down-automations/);
      expect(skill).toMatch(/same contract/i);
      expect(skill).toMatch(
        /do \*\*not\*\* invent a second source of truth|do not invent a second source of truth/i
      );
      expect(skill).toMatch(/queue arguments/i);
      expect(skill).toMatch(/stack-support/i);
    });

    it("derives the fleet from the resolver, not a hardcoded roster (#1796)", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toContain("resolveExpectedAutomationFleet");
      expect(skill).toContain("scripts/automation-status-expected-fleet.mjs");
      expect(skill).toContain("automation-runbook-contract");
      expect(skill).toMatch(/membership is registration, not a\s+roster/i);
      expect(skill).toMatch(/carry no fixed list of loop names/i);
      // The pre-#1796 roster bullet list must be gone.
      expect(skill).not.toMatch(/^- `intake-repair`$/m);
    });

    it("names the expected runtime branches and fleet outcomes", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toContain("Codex");
      expect(skill).toContain("Claude");
      expect(skill).toMatch(/unsupported in this runtime/i);
      expect(skill).toMatch(/healthy/i);
      expect(skill).toMatch(/missing/i);
      expect(skill).toMatch(/unsupported/i);
      expect(skill).toMatch(/drift/i);
      expect(skill).toMatch(/stale/i);
      expect(skill).toMatch(/failing/i);
      expect(skill).toMatch(/HEALTHY/);
      expect(skill).toMatch(/ATTENTION_NEEDED/);
      expect(skill).toMatch(/PARTIAL_SUPPORT/);
    });

    it("documents the shared grouped report rendering contract", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toContain("scripts/automation-status-report.mjs");
      expect(skill).toMatch(/Overall verdict: <VERDICT>/);
      expect(skill).toMatch(/Counts:/);
      expect(skill).toMatch(/Runtime inspected:/);
      expect(skill).toMatch(/Expected:/);
      expect(skill).toMatch(/Observed:/);
      expect(skill).toMatch(/Remediation:/);
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
