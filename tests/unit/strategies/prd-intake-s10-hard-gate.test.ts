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
        expect(content).toContain(REPAIR_LOOP_HEADING);
        expect(content).toMatch(/Dry-run validation is not advisory/i);
        expect(content).toMatch(/Before any Phase 5 write/i);
        expect(content).toMatch(/lisa-tracker-validate --spec-only/);
      });

      it("requires auto-split or restamp before write when S10 fails", () => {
        const section = content.slice(content.indexOf(REPAIR_LOOP_HEADING));
        expect(section).toMatch(/fails S10/i);
        expect(section).toMatch(/auto-split or restamp/i);
        expect(section).toMatch(/lisa-task-decomposition.*step 1\.5/i);
        expect(section).toMatch(/add the repo bracket/i);
        expect(section).toMatch(/Repository/);
      });

      it("forbids creating or bypassing tickets while S10 still fails", () => {
        const section = content.slice(content.indexOf(REPAIR_LOOP_HEADING));
        expect(section).toMatch(/If S10 still fails after repair/i);
        expect(section).toMatch(/abort the ticket write/i);
        expect(section).toMatch(/do not create the ticket/i);
        expect(section).toMatch(/do not bypass with direct vendor writes/i);
        expect(section).toMatch(/product_relevant: false/);
      });

      it("requires sub-tasks to carry repo scope in both summary and body", () => {
        expect(content).toMatch(/summary: `\[repo-name\]`/);
        expect(content).toMatch(/Repository/);
        expect(content).toMatch(/description|body/);
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

    it("requires Repository for all JIRA leaf work units including Improvement", () => {
      expect(content).toMatch(
        /Single-repo scope \| Bug, Task, Sub-task, Improvement/
      );
      expect(content).toMatch(
        /Required for Bug \/ Task \/ Sub-task \/ Improvement/
      );
    });
  });
});
