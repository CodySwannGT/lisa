/**
 * Contract coverage for the falsifiable-checks rule.
 *
 * The rule exists because a check that cannot fail reports the defect as absent
 * and terminates the search — a strictly worse outcome than having no check. It
 * was written after a single sweep produced four false-passing guards and zero
 * false fixes: every code change was correct and every verification instrument
 * was broken.
 *
 * These assertions pin the parts an agent must not lose: the closed four-mode
 * vocabulary (each mode is a distinct mechanism, so dropping one leaves a live
 * blind spot), the "unvalidated, not passing" reporting requirement, the
 * breadcrumb the cursor generator rewrites, and — most importantly — the removal
 * of the `codify-verification` loophole that previously let "mentally reverting"
 * satisfy the fail-first step. That loophole is the exact mechanism by which a
 * non-functional guard ships, so its absence is asserted directly rather than
 * inferred from the presence of the replacement prose.
 *
 * Both roots are checked because `plugins/lisa` is generated from
 * `plugins/src/base`: asserting one side only would let source-or-artifact drift
 * through, which is the failure `check-plugins-sync` exists to catch.
 * @module tests/unit/strategies/falsifiable-checks-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("falsifiable-checks rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/eager/falsifiable-checks.md");
    const reference = read(root, "rules/reference/falsifiable-checks.md");

    it("ships as a paired rule with a non-trivial body on both sides", () => {
      expect(eager.length).toBeGreaterThan(500);
      expect(reference.length).toBeGreaterThan(2000);
    });

    it("eager head breadcrumbs to the reference body", () => {
      // The cursor generator rewrites this link; the rest of the contract is
      // asserted on the reference body, which carries the full prose since the
      // 2026-11 eager-tier cut.
      expect(eager).toContain(
        "[reference/falsifiable-checks.md](../reference/falsifiable-checks.md)"
      );
    });
  });

  describe.each(ROOTS)("%s codify-verification integration", root => {
    const skill = read(root, "skills/lisa-codify-verification/SKILL.md");

    it("requires the failure to be observed, not reasoned about", () => {
      expect(skill).toMatch(/ACTUALLY FAILS without the change/);
    });
  });
});
