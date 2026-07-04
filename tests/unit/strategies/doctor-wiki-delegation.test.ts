/**
 * Regression coverage for doctor wiki delegation guidance.
 *
 * Issue #755 (Story #748, PRD #741): when a repo carries `wiki/`, the base
 * `/lisa:doctor` surface must either summarize the specialized
 * `lisa-wiki-doctor` verdict or explicitly advertise that deeper follow-up.
 * Non-wiki repos must keep the group as a clean skip instead of becoming
 * wiki-blocked by accident.
 * @module tests/unit/strategies/doctor-wiki-delegation
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const SKILL_REL = "skills/lisa-doctor/SKILL.md";

const readSkill = (root: string): string =>
  readFileSync(path.resolve(root, SKILL_REL), "utf8");

describe("doctor wiki delegation (#755)", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = readSkill(root);

    it("skips the wiki group cleanly when no wiki/ directory exists", () => {
      expect(skill).toMatch(
        /If no repo-local `wiki\/` directory exists, report/i
      );
      expect(skill).toMatch(/wiki group as `SKIP`/i);
    });

    it("summarizes an existing lisa-wiki-doctor verdict when available", () => {
      expect(skill).toContain("wiki/state/migration/doctor-report.json");
      expect(skill).toMatch(/summarize the specialized verdict/i);
      expect(skill).toContain("lisa-wiki-doctor");
    });

    it("advertises the specialized follow-up when no wiki report exists yet", () => {
      expect(skill).toMatch(
        /deeper wiki checks live behind `lisa-wiki-doctor`/i
      );
      expect(skill).toMatch(/run lisa-wiki-doctor/i);
      expect(skill).toMatch(/WARN wiki-follow-up/i);
    });

    it("keeps wiki readiness optional for non-wiki repositories", () => {
      expect(skill).toMatch(
        /Never require a wiki plugin surface when `wiki\/` is absent/i
      );
      expect(skill).toMatch(
        /Never let wiki-specific checks downgrade unrelated non-wiki repositories/i
      );
    });
  });
});
