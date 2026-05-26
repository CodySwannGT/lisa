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
  it("documents operator entrypoints and v1 semantics in the README", () => {
    const readme = read("README.md");

    expect(readme).toContain("### Optional GitHub Project Coordination");
    expect(readme).toContain("/lisa:setup-github");
    expect(readme).toContain("/lisa:doctor");
    expect(readme).toMatch(/optional coordination layer/i);
    expect(readme).toMatch(/not the lifecycle source of truth/i);
    expect(readme).toMatch(/owner\.slug.*must match.*github\.org/i);
    expect(readme).toMatch(/required:\s*false.*best-effort/i);
    expect(readme).toMatch(/required:\s*true.*blocking readiness error/i);
    expect(readme).toMatch(/single-repo leaf rule/i);
    expect(readme).toMatch(/Task, Bug, Sub-task, or Improvement/i);
    expect(readme).toMatch(/exactly one `repo:<name>` marker/i);
  });

  describe.each(PLUGIN_ROOTS)("%s", root => {
    it("keeps setup and doctor command descriptions explicit about Project coordination", () => {
      const setupCommand = read(
        path.join(root, "commands", "setup", "github.md")
      );
      const doctorCommand = read(path.join(root, "commands", "doctor.md"));

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
        path.join(root, "skills", "setup-github", "SKILL.md")
      );
      const doctorSkill = read(path.join(root, "skills", "doctor", "SKILL.md"));
      const intakeSkill = read(
        path.join(root, "skills", "github-build-intake", "SKILL.md")
      );
      const decompositionSkill = read(
        path.join(root, "skills", "task-decomposition", "SKILL.md")
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
