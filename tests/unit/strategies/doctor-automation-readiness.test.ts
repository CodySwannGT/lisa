/**
 * Regression tests for the doctor automation-readiness contract.
 *
 * Issue #754 (Story #747, PRD #741): `/lisa:doctor` must explain how it audits
 * automation readiness without mutating scheduler state. The contract needs to
 * stay explicit about queue resolution, native scheduler availability, and the
 * repo-surface rules for exploratory automations.
 *
 * Both plugin roots and both rules roots are asserted so source-only or
 * artifact-only edits fail fast.
 * @module tests/unit/strategies/doctor-automation-readiness
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;
const RULE_ROOTS = [
  "plugins/src/base/rules/reference",
  "plugins/lisa/rules/reference",
] as const;

const readDoctorSkill = (root: string): string =>
  readFileSync(path.resolve(root, "lisa-doctor", "SKILL.md"), "utf8");

describe.each(SKILL_ROOTS)(
  "doctor automation-readiness contract (%s)",
  root => {
    const content = readDoctorSkill(root);

    it("documents read-only queue resolution for prd, build, and repair automations", () => {
      expect(content).toContain("### Minimum automation-readiness checks");
      expect(content).toMatch(
        /automation-readiness group stays read-only|automation-readiness group is also read-only/i
      );
      expect(content).toMatch(/Resolve the PRD queue from merged `source`/i);
      expect(content).toMatch(/Resolve the build queue from merged `tracker`/i);
      expect(content).toMatch(
        /Resolve the repair queue.*`lisa-repair-intake`/is
      );
      expect(content).toMatch(
        /report that automation as `FAIL` rather\s+than pretending scheduling can proceed safely/i
      );
    });

    it("checks native scheduler visibility without creating automations", () => {
      expect(content).toMatch(/Codex[\s\S]*`automation_update`/i);
      expect(content).toMatch(/Claude[\s\S]*`\/schedule`/i);
      expect(content).toMatch(/Other runtimes[\s\S]*no native Lisa scheduler/i);
      expect(content).toMatch(
        /Never create a placeholder automation just to prove the scheduler\s+works/i
      );
    });

    it("covers exploratory support and PASS WARN SKIP FAIL semantics", () => {
      expect(content).toMatch(
        /`exploratory-bugs`[\s\S]*`exploratory-qa`[\s\S]*`expo`[\s\S]*`rails`[\s\S]*`harper-fabric`/i
      );
      expect(content).toMatch(
        /When the repo does not ship `exploratory-qa`, report `exploratory-bugs` as `SKIP`/i
      );
      expect(content).toMatch(/`exploratory-prds` remains applicable/i);
      expect(content).toMatch(
        /`PASS` when an automation's queue inputs are resolvable/i
      );
      expect(content).toMatch(
        /`WARN` when Lisa remains usable manually, but the current runtime has no native scheduler\s+surface/i
      );
      expect(content).toMatch(
        /`FAIL` when the repo's config cannot resolve the queue that an automation needs/i
      );
    });
  }
);

describe.each(RULE_ROOTS)(
  "config-resolution doctor automation-readiness docs (%s)",
  rulesRoot => {
    const content = readFileSync(
      path.resolve(rulesRoot, "config-resolution.md"),
      "utf8"
    );

    it("defines one shared doctor automation-readiness section", () => {
      expect(content).toContain("### Doctor automation readiness");
      expect(content).toMatch(
        /recurring automations from the current runtime/i
      );
      expect(content).toMatch(
        /without creating[\s\S]*editing[\s\S]*deleting[\s\S]*reconciling any automation state/i
      );
    });

    it("documents queue resolution and runtime scheduler expectations", () => {
      expect(content).toMatch(
        /Resolve the PRD automation queue from merged `source`/i
      );
      expect(content).toMatch(
        /Resolve the build automation queue from merged `tracker`/i
      );
      expect(content).toMatch(/`lisa-intake`\s*\/\s*`lisa-repair-intake`/i);
      expect(content).toMatch(/Codex[\s\S]*`automation_update`/i);
      expect(content).toMatch(/Claude[\s\S]*`\/schedule`/i);
      expect(content).toMatch(/must not create a throwaway automation/i);
    });

    it("documents exploratory-support and severity mapping", () => {
      expect(content).toMatch(
        /`exploratory-bugs` exists only for stacks that ship `exploratory-qa`.*`expo`, `rails`,\s*`harper-fabric`/is
      );
      expect(content).toMatch(
        /doctor reports the automation as\s+`SKIP`, not `FAIL`/i
      );
      expect(content).toMatch(/Queue resolution failure is a doctor `FAIL`/i);
      expect(content).toMatch(
        /Missing native scheduler support.*doctor `WARN`/i
      );
      expect(content).toMatch(
        /optional exploratory automation surface is a doctor `SKIP`/i
      );
    });
  }
);
