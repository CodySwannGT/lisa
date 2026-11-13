/**
 * Regression coverage for #1062: PRD-to-tracker dry-run validation must treat
 * S10 single-repo scope failures as internal repair work, not advisory output
 * that can be bypassed before writing leaf tickets.
 *
 * Both source and generated plugin roots are asserted so a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/prd-intake-s10-hard-gate
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;
const TO_TRACKER_SKILLS = [
  "lisa-notion-to-tracker",
  "lisa-confluence-to-tracker",
  "lisa-github-to-tracker",
  "lisa-linear-to-tracker",
] as const;
const REPAIR_LOOP_HEADING = "S10 hard gate repair loop";

const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

describe("PRD-to-tracker S10 hard gate repair loop (#1062)", () => {
  describe.each(TO_TRACKER_SKILLS)("%s", skill => {
    describe.each(ROOTS)("%s", root => {
      const content = readSkill(root, skill);

      it("documents S10 as a hard pre-write repair loop", () => {
        expect(content).toMatch(/lisa-tracker-validate --spec-only/);
      });

      it("requires auto-split or restamp before write when S10 fails", () => {
        const section = content.slice(content.indexOf(REPAIR_LOOP_HEADING));
        expect(section).toMatch(/lisa-task-decomposition.*step 1\.5/i);
      });
    });
  });

  describe.each(ROOTS)("%s/lisa-jira-write-ticket", root => {
    const content = readSkill(root, "lisa-jira-write-ticket");

    it("runs the validator before any JIRA write and forbids writes on FAIL", () => {
      expect(content).toMatch(
        /Before any write, invoke `lisa-jira-validate-ticket`/
      );
      expect(content).toMatch(
        /Never invoke `lisa-atlassian-access`.*write-ticket.*FAIL/s
      );
    });
  });
});
