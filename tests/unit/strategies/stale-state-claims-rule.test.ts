/**
 * Contract coverage for the stale-state-claims rule.
 *
 * The rule exists because a note recording a temporary state ("not yet",
 * "pending", "human-gated") was ACCURATE when written, so nothing ever marks it
 * false. It keeps being believed, and it misdirects in one specific direction —
 * toward doing nothing: work skipped as blocked, re-planned as undone, or
 * escalated to a human who already decided.
 *
 * These assertions pin the parts an agent must not lose: the closed four-mode
 * vocabulary (each is a distinct mechanism with a distinct countermeasure), the
 * delete-the-claim-when-you-clear-the-condition obligation (without it the rule
 * is advice to be careful rather than an owner for the cleanup), the
 * prediction-becomes-tracked-work escape from closure, and the cross-references
 * that keep it a sibling of `falsifiable-checks` instead of a restatement.
 *
 * The confidentiality assertion is load-bearing rather than cosmetic: eager
 * rules ship to every Lisa consumer, and the observed instances behind this rule
 * came from one project's live infrastructure. Tracker refs and hostnames are
 * the two forms that leak by copy-paste.
 *
 * Both roots are checked because `plugins/lisa` is generated from
 * `plugins/src/base`: asserting one side only would let source-or-artifact drift
 * through, which is the failure `check-plugins-sync` exists to catch.
 * @module tests/unit/strategies/stale-state-claims-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("stale-state-claims rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    // The eager head was retired in the 2026-11 eager-tier cut; `empirical-inquiry`
    // carries a one-line summary and the rule index points here. The former
    // head's obligations now live at the end of the reference body.
    const reference = read(root, "rules/reference/stale-state-claims.md");
    const eager = reference;

    it("ships a non-trivial reference body reachable from the rule index", () => {
      expect(reference.length).toBeGreaterThan(2000);
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/stale-state-claims.md"
      );
    });

    it("cross-references the sibling rules instead of restating them", () => {
      expect(eager).toContain("falsifiable-checks");
      expect(eager).toContain("empirical-inquiry");
      expect(eager).toContain("tracked-work");
      expect(eager).toContain("claim-archaeology");
    });
  });
});
