/**
 * Regression coverage for issue #731: research, plan, and debrief must attach
 * direct usage entries to the artifacts they create or update.
 *
 * Assert both the upstream source skills/rules and the generated plugin copies
 * so plugin parity stays enforced.
 * @module tests/unit/strategies/usage-accounting-lifecycle-artifacts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;
const RULES = [
  "plugins/src/base/rules/reference/intent-routing.md",
  "plugins/lisa/rules/reference/intent-routing.md",
] as const;
const USAGE_SKILL = "lisa:usage-accounting";
const USAGE_SECTION = "## Lisa Usage";
const UNAVAILABLE_USAGE = /source:\s*unavailable/i;

const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

describe("research/plan/debrief usage-accounting integration", () => {
  describe.each(ROOTS)("%s", root => {
    it("records research usage on the PRD artifact", () => {
      const content = readSkill(root, "research");

      expect(content).toContain(USAGE_SKILL);
      expect(content).toContain(USAGE_SECTION);
      expect(content).toMatch(/Research run's direct usage/i);
      expect(content).toMatch(UNAVAILABLE_USAGE);
    });

    it("records plan usage on the PRD and created work items", () => {
      const content = readSkill(root, "plan");

      expect(content).toContain(USAGE_SKILL);
      expect(content).toMatch(/direct entry on the source PRD/i);
      expect(content).toMatch(/each created work item/i);
      expect(content).toMatch(UNAVAILABLE_USAGE);
      expect(content).toMatch(/prd-backlink/i);
      expect(content).toMatch(/rollup/i);
    });

    it("records debrief usage on the generated triage document", () => {
      const content = readSkill(root, "debrief");

      expect(content).toContain(USAGE_SKILL);
      expect(content).toContain(USAGE_SECTION);
      expect(content).toMatch(/Debrief run's direct usage/i);
      expect(content).toMatch(UNAVAILABLE_USAGE);
    });
  });
});

describe("implement/verify/intake usage-accounting integration", () => {
  describe.each(ROOTS)("%s", root => {
    it("records implement usage on the work artifact and refreshes ancestor totals when known", () => {
      const content = readSkill(root, "implement");

      expect(content).toContain(USAGE_SKILL);
      expect(content).toContain(USAGE_SECTION);
      expect(content).toMatch(/direct `implement` usage entry/i);
      expect(content).toMatch(/record_and_rollup/i);
      expect(content).toMatch(UNAVAILABLE_USAGE);
    });

    it("records verify usage on evidence artifacts before posting", () => {
      const content = readSkill(root, "verify");

      expect(content).toContain(USAGE_SKILL);
      expect(content).toContain(USAGE_SECTION);
      expect(content).toMatch(/direct `verify` usage entry/i);
      expect(content).toMatch(/tracker-evidence/i);
      expect(content).toMatch(UNAVAILABLE_USAGE);
    });

    it("records intake usage on cycle summaries and refreshes ancestor totals when known", () => {
      const content = readSkill(root, "intake");

      expect(content).toContain(USAGE_SKILL);
      expect(content).toContain(USAGE_SECTION);
      expect(content).toMatch(/direct `intake` entry/i);
      expect(content).toMatch(/record_and_rollup/i);
      expect(content).toMatch(UNAVAILABLE_USAGE);
    });

    it("routes tracker evidence usage through the shared usage-accounting contract", () => {
      const content = readSkill(root, "tracker-evidence");

      expect(content).toContain(USAGE_SKILL);
      expect(content).toContain(USAGE_SECTION);
      expect(content).toMatch(/direct `verify` usage entry/i);
      expect(content).toMatch(/record_and_rollup/i);
      expect(content).toMatch(UNAVAILABLE_USAGE);
    });
  });
});

describe("intent-routing lifecycle flows include usage writes", () => {
  describe.each(RULES)("%s", rulePath => {
    const content = readFileSync(path.resolve(rulePath), "utf8");

    it("adds Research usage recording after PRD creation", () => {
      expect(content).toMatch(/Record Research usage on the PRD artifact/i);
      expect(content).toContain(USAGE_SKILL);
      expect(content).toMatch(UNAVAILABLE_USAGE);
    });

    it("adds Plan usage recording plus PRD rollup refresh", () => {
      expect(content).toMatch(
        /Record Plan usage on the PRD and created work items/i
      );
      expect(content).toMatch(/Refresh the PRD usage rollup/i);
      expect(content).toMatch(/prd-backlink/i);
    });

    it("adds Debrief usage recording on the triage document", () => {
      expect(content).toMatch(/Record Debrief usage on the triage document/i);
      expect(content).toContain(USAGE_SECTION);
    });

    it("adds Implement usage recording on delivery work artifacts", () => {
      expect(content).toMatch(/Record Implement usage on the work artifact/i);
      expect(content).toContain(USAGE_SKILL);
      expect(content).toMatch(/record_and_rollup/i);
      expect(content).toMatch(UNAVAILABLE_USAGE);
    });

    it("adds Verify usage recording on evidence artifacts", () => {
      expect(content).toMatch(/Record Verify usage on the evidence artifact/i);
      expect(content).toContain(USAGE_SKILL);
      expect(content).toMatch(/tracker-evidence/i);
      expect(content).toMatch(UNAVAILABLE_USAGE);
    });
  });
});
