/**
 * Regression coverage for Linear transition-history reads via lisa-linear-access.
 *
 * The skill is the executable contract for Linear access. These assertions pin
 * the net-new `history` operation onto the documented Invocation Contract (an
 * undocumented-but-reachable capability is not "exposed"), protect the
 * IssueHistory GraphQL shape it reads through the existing adapter, and record
 * the honest label-history caveat plus the empty-is-valid / graceful-degrade
 * semantics callers depend on.
 * @module tests/unit/strategies/linear-access-history
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const readSkill = (root: string): string =>
  readFileSync(
    path.resolve(root, "skills/lisa-linear-access/SKILL.md"),
    "utf8"
  );

describe("linear access history contract", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = readSkill(root);

    it("lists the history operation in the documented Invocation Contract", () => {
      expect(skill).toContain("operation: history id:<ID>");
    });

    it("reads IssueHistory through the existing GraphQL adapter", () => {
      expect(skill).toContain("linear_graphql");
      expect(skill).toContain("fromState");
      expect(skill).toContain("toState");
      expect(skill).toMatch(/issue\(id:/);
      expect(skill).toContain("history");
    });

    it("documents the label-history caveat honestly", () => {
      // The caveat is still real — `human_needed` is a label and the PRD lane
      // rides on project labels — so the ID-delta indirection must stay
      // documented. What changed is that it no longer covers the BUILD lane.
      expect(skill).toContain("addedLabelIds");
      expect(skill).toContain("removedLabelIds");
      expect(skill).toMatch(/markers|marker/i);
    });

    it("points build-lifecycle callers at the state stream, not labels", () => {
      // The build lane reads `fromState`/`toState`, which the history inlines —
      // no catalog cross-reference and no lossy reconstruction from ID deltas.
      expect(skill).toMatch(/state-driven|states/i);
      expect(skill).toContain("fromState");
      expect(skill).toContain("toState");
    });

    it("documents empty-is-valid and graceful-degrade semantics", () => {
      expect(skill).toMatch(/empty history is a valid result, not an error/i);
      expect(skill).toMatch(/never block the build/i);
      expect(skill).toMatch(/unknown/i);
    });
  });
});
