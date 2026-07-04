/**
 * Regression coverage for intake-explain build gate diagnosis.
 *
 * Issue #849 requires the read-only diagnosis surface to evaluate build items
 * with the same leaf-only, repo-scope, and dependency-hold semantics used by
 * build intake before claiming a ready issue.
 * @module tests/unit/strategies/intake-explain-build-gates
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const SKILL_REL = "skills/lisa-intake-explain/SKILL.md";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("intake-explain build gate diagnosis (#849)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    it("documents the GitHub build item reader signals used before verdicts", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toContain("## Build item gate diagnosis");
      expect(skill).toMatch(/native GitHub sub-issues/i);
      expect(skill).toMatch(/body parentage/i);
      expect(skill).toMatch(/type:Epic/);
      expect(skill).toMatch(/repo:<current>/);
      expect(skill).toMatch(/repo:<other>/);
      expect(skill).toMatch(/Blocked by:/);
      expect(skill).toMatch(/status:code-review/);
      expect(skill).toMatch(/status:on-dev/);
      expect(skill).toMatch(/status:on-stg/);
      expect(skill).toMatch(/status:done/);
    });

    it("maps leaf-only, repo-scope, and dependency gates to precise verdicts", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/open child work/i);
      expect(skill).toMatch(/NON_LEAF_CONTAINER/);
      expect(skill).toMatch(/repo-scope mismatch/i);
      expect(skill).toMatch(/MISCONFIGURED/);
      expect(skill).toMatch(/HELD_BY_BLOCKERS/);
      expect(skill).toMatch(/ELIGIBLE_FOR_INTAKE/);
      expect(skill).toMatch(/list the active blocker refs/i);
      expect(skill).toMatch(/single-repo leaf for the current repo/i);
    });

    it("keeps build diagnosis read-only even when execution intake would repair or split", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(
        /read-only diagnosis must not perform that repair/i
      );
      expect(skill).toMatch(/does not stamp/i);
      expect(skill).toMatch(/does not split/i);
      expect(skill).toMatch(/does not move/i);
      expect(skill).toMatch(/would do/i);
    });
  });
});
