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

/**
 * The four observed ways a recorded state outlives its truth. Each is a distinct
 * mechanism with a distinct countermeasure — this is a closed set, and losing an
 * entry re-opens that blind spot.
 */
const FAILURE_MODES = [
  "Expired blocker note",
  "Stale gate marker",
  "Prediction buried by closure",
  "Silent waiting gate",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("stale-state-claims rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/eager/stale-state-claims.md");
    const reference = read(root, "rules/reference/stale-state-claims.md");

    it("ships as a paired rule with a non-trivial body on both sides", () => {
      expect(eager.length).toBeGreaterThan(500);
      expect(reference.length).toBeGreaterThan(2000);
    });

    it("eager head breadcrumbs to the reference body verbatim", () => {
      expect(eager).toContain(
        "Full prose, worked examples, and the rewrite patterns: [reference/stale-state-claims.md](../reference/stale-state-claims.md)."
      );
    });

    it("states the core rule: a recorded blocker is a claim about the past", () => {
      expect(eager).toMatch(/claim about the past/i);
      // The load-bearing instruction, not just the observation.
      expect(eager).toMatch(/check the present before acting on it/i);
    });

    it("enumerates all four failure modes in the eager head", () => {
      for (const mode of FAILURE_MODES) {
        expect(eager).toContain(mode);
      }
    });

    it("expands every failure mode in the reference body", () => {
      for (const mode of FAILURE_MODES) {
        expect(reference).toContain(mode);
      }
      // Each mode needs its observed instance, or it reads as hypothetical and
      // gets skipped.
      expect(reference).toMatch(/Observed:/);
    });

    it("assigns ownership of the cleanup to whoever clears the condition", () => {
      // Without an owner the note survives every time, because the only person
      // who knows it is false is the one who just made it false.
      expect(eager).toMatch(/clears the condition deletes the claim/i);
      expect(reference).toMatch(/sweep for the notes that described it/i);
    });

    it("requires expiry-resistant forms over pending prose", () => {
      expect(eager).toMatch(/expiry-resistant/i);
      expect(eager).toMatch(/fails when it goes stale/i);
      expect(reference).toMatch(/Bind the claim to a check/);
      expect(reference).toMatch(/Bind the claim to a work item/);
    });

    it("routes a prediction on a closing item to tracked work or retraction", () => {
      expect(eager).toMatch(/becomes tracked work or is retracted/i);
      expect(eager).toMatch(/blocking link/i);
      expect(reference).toMatch(/before.{0,20}the parent item closes/i);
    });

    it("treats a gate that holds work silently as a defect in the gate", () => {
      expect(eager).toMatch(/defect in the gate/i);
      expect(eager).toMatch(/surfacing mechanism/i);
      // "Remember to check" is the same failure with a person's name on it.
      expect(reference).toMatch(/Fix the gate, not your habits/);
    });

    it("cross-references the sibling rules instead of restating them", () => {
      expect(eager).toContain("falsifiable-checks");
      expect(eager).toContain("empirical-inquiry");
      expect(eager).toContain("tracked-work");
      expect(eager).toContain("claim-archaeology");
      expect(reference).toMatch(/## Interaction with other rules/);
    });

    it("carries no originating-project identifiers", () => {
      // Eager rules ship to every consumer. Tracker refs and hostnames are the
      // two forms that survive a copy-paste from the project that produced the
      // observation.
      for (const doc of [eager, reference]) {
        expect(doc).not.toMatch(/\b[A-Z]{2,6}-\d{1,6}\b/);
        expect(doc).not.toMatch(/https?:\/\//);
        expect(doc).not.toMatch(/\b[a-z0-9-]+\.(com|net|org|io|dev)\b/);
      }
    });
  });

  describe.each(ROOTS)("%s sibling rule cross-references", root => {
    it("empirical-inquiry forbids treating a recorded note as current state", () => {
      const empirical = read(root, "rules/eager/empirical-inquiry.md");
      expect(empirical).toMatch(/stale-state-claims/);
      expect(empirical).toMatch(/human-gated/);
    });

    it("falsifiable-checks names it as the opposite-direction sibling", () => {
      const falsifiable = read(root, "rules/reference/falsifiable-checks.md");
      expect(falsifiable).toMatch(/stale-state-claims/);
      expect(falsifiable).toMatch(/nothing re-runs prose/);
    });
  });
});
