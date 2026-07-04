/**
 * Operator-facing docs coverage for first-version GitHub Project coordination.
 *
 * Issue #706 adds the rollout-facing docs and static proof that setup, doctor,
 * README guidance, and the single-repo leaf invariant stay aligned while the
 * generated `plugins/lisa` command surfaces remain in lockstep with the
 * `plugins/src/base` sources.
 * @module tests/unit/strategies/github-project-operator-docs
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (filePath: string): string =>
  readFileSync(path.resolve(filePath), "utf8");

describe("GitHub Project coordination rollout docs (#706)", () => {
  it("keeps the single-repo leaf invariant stated and tracker setup discoverable in the README", () => {
    const readme = read("README.md");

    // The rewritten README defers vendor-specific setup (GitHub Projects,
    // per-tracker config keys, the v1 owner.slug/required semantics) to
    // "Prompt for your coding agent" blocks that read the live repo, so it no
    // longer hardcodes the GitHub Project coordination section. The durable
    // single-repo leaf invariant stays stated in prose; the detailed v1
    // semantics live in the setup/doctor command and skill files, asserted
    // below.
    expect(readme).toContain("Prompt for your coding agent");
    expect(readme).toMatch(/planning artifacts may span repositories/i);
    expect(readme).toMatch(/exactly one repository/i);
    expect(readme).toMatch(/which issue trackers/i);
    expect(readme).toMatch(/config keys select them/i);
  });

  describe.each(PLUGIN_ROOTS)("%s", root => {
    it("keeps setup and doctor command descriptions explicit about Project coordination", () => {
      const setupCommand = read(
        path.join(root, "commands", "lisa", "setup", "github.md")
      );
      const doctorCommand = read(
        path.join(root, "commands", "lisa", "doctor.md")
      );

      expect(setupCommand).toMatch(/optional GitHub ProjectV2 coordination/i);
      expect(setupCommand).toContain(".lisa.config.json");
      expect(setupCommand).toMatch(/tracker:\s*\\?"github\\?"/i);
      expect(doctorCommand).toMatch(
        /optional GitHub Project\/wiki coordination/i
      );
      expect(doctorCommand).toMatch(/PASS\/WARN\/FAIL\/SKIP/i);
    });

    it("keeps setup, doctor, and intake docs aligned with the single-repo leaf invariant", () => {
      const setupSkill = read(
        path.join(root, "skills", "lisa-setup-github", "SKILL.md")
      );
      const doctorSkill = read(
        path.join(root, "skills", "lisa-doctor", "SKILL.md")
      );
      const intakeSkill = read(
        path.join(root, "skills", "lisa-github-build-intake", "SKILL.md")
      );
      const decompositionSkill = read(
        path.join(root, "skills", "lisa-task-decomposition", "SKILL.md")
      );

      expect(setupSkill).toMatch(/Project membership is best-effort/i);
      expect(setupSkill).toMatch(
        /cross-namespace Project ownership is rejected/i
      );
      expect(doctorSkill).toMatch(/required:\s*false.*doctor `WARN`/i);
      expect(doctorSkill).toMatch(/required:\s*true.*doctor `FAIL`/i);
      expect(intakeSkill).toMatch(/repo:<name>/);
      expect(intakeSkill).toMatch(/Multi-repo leaf.*never claim/i);
      expect(decompositionSkill).toMatch(/PRD.*MAY span repos/i);
      expect(decompositionSkill).toMatch(
        /Task, Bug, Sub-task, Improvement.*MUST name exactly one repo/i
      );
    });
  });
});
