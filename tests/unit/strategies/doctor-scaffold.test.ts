/**
 * Regression tests for the `/lisa:doctor` command + skill scaffold.
 *
 * Issue #749 (Story #745, PRD #741): add the top-level doctor command entrypoint
 * and shared doctor skill surface to the base plugin, then prove the generated
 * `plugins/lisa` artifact ships the same surface after `bun run build:plugins`.
 *
 * This suite asserts the scaffold only:
 * 1. `commands/doctor.md` exists in both plugin roots and delegates to
 *    `/lisa:doctor`.
 * 2. `skills/doctor/SKILL.md` exists in both plugin roots with the expected
 *    frontmatter and read-only readiness-audit contract.
 * 3. The skill documents grouped `PASS` / `WARN` / `FAIL` / `SKIP` checks plus
 *    the overall `READY` / `READY_WITH_WARNINGS` / `NOT_READY` verdict ladder.
 *
 * Both plugin roots are asserted (`plugins/src/base` source of truth and the
 * generated `plugins/lisa` artifact), so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/doctor-scaffold
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const COMMAND_REL = "commands/doctor.md";
const SKILL_REL = "skills/doctor/SKILL.md";
const SCRIPT_REL = "scripts/doctor-report.mjs";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("doctor scaffold (#749)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    const commandPath = path.resolve(root, COMMAND_REL);
    const skillPath = path.resolve(root, SKILL_REL);
    const scriptPath = path.resolve(root, SCRIPT_REL);

    it("ships the command, skill, and shared report script in this plugin root", () => {
      expect(existsSync(commandPath)).toBe(true);
      expect(existsSync(skillPath)).toBe(true);
      expect(existsSync(scriptPath)).toBe(true);
    });

    describe(COMMAND_REL, () => {
      const command = read(root, COMMAND_REL);

      it("is a pass-through command that delegates to /lisa:doctor", () => {
        expect(command).toMatch(/^---/);
        expect(command).toMatch(/description:/);
        expect(command).toContain('argument-hint: "[--fix=false]"');
        expect(command).toMatch(/Use the \/lisa:doctor skill/);
        expect(command).toContain("$ARGUMENTS");
      });
    });

    describe(SKILL_REL, () => {
      const skill = read(root, SKILL_REL);

      it("declares name, description, and allowed-tools in frontmatter", () => {
        expect(skill).toMatch(/^---/);
        expect(skill).toMatch(/name:\s*doctor/);
        expect(skill).toMatch(/description:/);
        expect(skill).toMatch(/allowed-tools:/);
        expect(skill).toContain("Skill");
        expect(skill).toContain("Bash");
        expect(skill).toContain("Read");
      });

      it("documents a read-only readiness audit for the current repository", () => {
        expect(skill).toMatch(/read-only Lisa readiness audit/i);
        expect(skill).toMatch(/current repository/i);
        expect(skill).toMatch(
          /does \*\*not\*\* create automations, labels, tracker items/i
        );
      });

      it("documents grouped PASS, WARN, FAIL, and SKIP checks", () => {
        expect(skill).toContain("PASS");
        expect(skill).toContain("WARN");
        expect(skill).toContain("FAIL");
        expect(skill).toContain("SKIP");
        expect(skill).toMatch(/grouped sections/i);
      });

      it("documents the overall READY verdict ladder", () => {
        expect(skill).toContain("READY");
        expect(skill).toContain("READY_WITH_WARNINGS");
        expect(skill).toContain("NOT_READY");
        expect(skill).toMatch(/The verdict ladder is:/);
      });

      it("documents the shared grouped report rendering contract", () => {
        expect(skill).toContain("scripts/doctor-report.mjs");
        expect(skill).toMatch(/Overall verdict: <VERDICT>/);
        expect(skill).toMatch(/Counts:/);
        expect(skill).toMatch(/Observed:/);
        expect(skill).toMatch(/Remediation:/);
      });

      it("reuses existing contracts for GitHub Project and wiki checks", () => {
        expect(skill).toContain("config-resolution");
        expect(skill).toContain("github-project-v2");
        expect(skill).toContain("lisa-wiki-doctor");
      });
    });

    describe(SCRIPT_REL, () => {
      const script = read(root, SCRIPT_REL);

      it("exports the verdict helpers for later doctor checks", () => {
        expect(script).toContain("computeDoctorVerdict");
        expect(script).toContain("countDoctorStatuses");
        expect(script).toContain("renderDoctorReport");
      });

      it("keeps observed facts separate from remediation advice", () => {
        expect(script).toMatch(/Observed:/);
        expect(script).toMatch(/Remediation:/);
        expect(script).toContain("Overall verdict:");
      });
    });
  });
});
