/**
 * Regression coverage for JIRA transition-history reads.
 *
 * Lisa's JIRA access layer is an executable operator contract. These assertions
 * protect the changelog/history operation that rejection detection consumes.
 * @module tests/unit/strategies/atlassian-access-changelog-history
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const readSkill = (root: string): string =>
  readFileSync(
    path.resolve(root, "skills/lisa-atlassian-access/SKILL.md"),
    "utf8"
  );

describe("atlassian-access changelog/history contract", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = readSkill(root);

    it("exposes changelog and history as first-class JIRA read operations", () => {
      expect(skill).toContain("operation: changelog");
      expect(skill).toContain("operation: history");
      expect(skill).toMatch(/`changelog key:<K>` \/ `history key:<K>`/);
      expect(skill).toContain("expand=changelog");
    });

    it("forbids using available transitions as past transition history", () => {
      expect(skill).toMatch(/`transitions` is a false friend/i);
      expect(skill).toMatch(/available next transitions/i);
      expect(skill).toMatch(/not the past status changes/i);
      expect(skill).toMatch(
        /fields=\*all` also does not imply `expand=changelog/i
      );
    });

    it("defines ordered status-change output with empty and unknown states", () => {
      expect(skill).toContain("statusChanges");
      expect(skill).toContain("historyStatus");
      expect(skill).toMatch(/oldest-to-newest `statusChanges` array/i);
      expect(skill).toMatch(/empty history is a valid result/i);
      expect(skill).toMatch(/historyStatus:"unknown"/i);
      expect(skill).toMatch(/instead of failing the build caller/i);
    });
  });
});
