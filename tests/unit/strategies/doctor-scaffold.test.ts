/**
 * Regression tests for the `/lisa:doctor` command + skill scaffold.
 *
 * Issue #749 (Story #745, PRD #741): add the top-level doctor command entrypoint
 * and shared doctor skill surface to the base plugin, then prove the generated
 * `plugins/lisa` artifact ships the same surface after `bun run build:plugins`.
 *
 * This suite asserts the scaffold only:
 * 1. `commands/doctor.md` exists in both plugin roots with frontmatter and a
 *    `$ARGUMENTS` pass-through.
 * 2. `skills/lisa-doctor/SKILL.md` exists in both plugin roots with the expected
 *    frontmatter.
 * 3. `scripts/doctor-report.mjs` exports the verdict helpers.
 *
 * The skill's guidance prose is not pinned (#4867).
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
const SKILL_REL = "skills/lisa-doctor/SKILL.md";
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

      it("has command frontmatter and passes $ARGUMENTS through", () => {
        expect(command).toMatch(/^---/);
        expect(command).toMatch(/description:/);
        expect(command).toContain("$ARGUMENTS");
      });
    });

    describe(SKILL_REL, () => {
      const skill = read(root, SKILL_REL);

      it("declares name, description, and allowed-tools in frontmatter", () => {
        expect(skill).toMatch(/^---/);
        expect(skill).toMatch(/name:\s*lisa-doctor/);
        expect(skill).toMatch(/description:/);
        expect(skill).toMatch(/allowed-tools:/);
        expect(skill).toContain("Skill");
        expect(skill).toContain("Bash");
        expect(skill).toContain("Read");
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
