/**
 * Regression coverage for JIRA transition-history reads via lisa-atlassian-access.
 *
 * The skill is the executable contract for JIRA access. These assertions protect
 * the net-new `changelog` operation (`?expand=changelog`) that exposes ordered
 * past status transitions for rejection detection, keep the `transitions` row
 * flagged as a false-friend so nobody reuses it for history, and pin the
 * graceful-degrade / empty-is-valid semantics callers depend on.
 * @module tests/unit/strategies/atlassian-access-changelog
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

describe("atlassian access changelog contract", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = readSkill(root);

    it("adds a changelog/history read operation using expand=changelog", () => {
      expect(skill).toContain("`changelog key:<K>`");
      expect(skill).toContain("?expand=changelog");
      expect(skill).toContain("changelog.histories[].items[]");
      expect(skill).toMatch(/field\s*==\s*"?status"?/);
    });

    it("flags the transitions row as a false friend, not past history", () => {
      expect(skill).toMatch(/false friend/i);
      expect(skill).toMatch(/available transitions from current status/i);
      expect(skill).toMatch(/for history use.*changelog/i);
    });

    it("documents empty-is-valid and graceful-degrade semantics", () => {
      expect(skill).toMatch(/empty history is a valid result, not an error/i);
      expect(skill).toMatch(/never block the build/i);
      expect(skill).toMatch(/unknown/i);
    });

    it("notes changelog pagination / truncation", () => {
      expect(skill).toMatch(/\/changelog/);
      expect(skill).toMatch(/paginat/i);
    });
  });
});
