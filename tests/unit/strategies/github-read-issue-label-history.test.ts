/**
 * Regression coverage for GitHub issue transition-history reads.
 *
 * The skill is the executable contract for GitHub issue context reads. These
 * assertions protect the widened timeline query that keeps PR cross-reference
 * behavior while adding label-event history for rejection detection.
 * @module tests/unit/strategies/github-read-issue-label-history
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const readSkill = (root: string): string =>
  readFileSync(
    path.resolve(root, "skills/lisa-github-read-issue/SKILL.md"),
    "utf8"
  );

describe("github read issue label history contract", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = readSkill(root);

    it("widens the existing timeline query without dropping PR cross-references", () => {
      expect(skill).toContain("CROSS_REFERENCED_EVENT");
      expect(skill).toContain("LABELED_EVENT");
      expect(skill).toContain("UNLABELED_EVENT");
      expect(skill).toContain("...on CrossReferencedEvent");
      expect(skill).toContain("...on LabeledEvent");
      expect(skill).toContain("...on UnlabeledEvent");
    });

    it("captures label event payload and preserves pagination", () => {
      expect(skill).toContain("pageInfo{hasNextPage endCursor}");
      expect(skill).toContain("after:$cursor");
      expect(skill).toMatch(/label\{name\}/);
      expect(skill).toMatch(/actor\{login\}/);
      expect(skill).toMatch(
        /chronological `LabeledEvent` and `UnlabeledEvent`/
      );
      expect(skill).toContain("Preserve oldest");
    });

    it("documents non-blocking unknown history on read failure", () => {
      expect(skill).toMatch(/label-event history as `unknown`/i);
      expect(skill).toMatch(/must never block the build/i);
    });
  });
});
