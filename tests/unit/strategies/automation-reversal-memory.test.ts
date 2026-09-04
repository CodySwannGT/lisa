/**
 * Contract coverage for the repair-side half of `rejection-detection`.
 *
 * The claim-time half remembers work a human bounced backward through the
 * review lanes; the proposal-time half remembers a proposal a human declined.
 * This third half remembers something a human did to the flow itself — an
 * automated repair moved an item's lifecycle role and a human moved it back.
 *
 * The defect it closes is inversion, not forgetfulness (CodySwannGT/lisa#3646):
 * a state-only recurrence brake reads the revert as *changed state*, and
 * changed state warranted a re-attempt — so the correction became the trigger,
 * and the promptest reviewer produced the fastest recurrence. These assertions
 * pin the new classification, the authorship signal that distinguishes a human
 * override from the world moving on, the ordering discipline, the degrade, the
 * inverted warrant, and the per-path signing that keeps the protective
 * staleness reading intact.
 * @module tests/unit/strategies/automation-reversal-memory
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source of truth and the generated Claude copy that ships to consumers. */
const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The classification this half adds. */
const REVERSAL = "automation-reversal";

/** The marker a suppressed reversal escalates to. */
const HUMAN_GATE = "human_needed";

/** The consuming skill — the first loop that writes a role as a repair. */
const REPAIR_SKILL = "skills/lisa-repair-intake/SKILL.md";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("automation-reversal memory (repair-side rejection-detection)", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/eager/rejection-detection.md");
    const reference = read(root, "rules/reference/rejection-detection.md");
    const repair = read(root, REPAIR_SKILL);

    it("names a distinct classification for a reversed automation transition", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain(REVERSAL);
      }
    });

    it("keeps it orthogonal to rejection-reclaim rather than widening that predicate", () => {
      // rejection-reclaim is anchored on the READY lane (a review/done-ward
      // item bounced back to ready) and answers a rejection by re-implementing.
      // A reversed repair lands in BLOCKED and must answer by withdrawing a
      // decision, so widening the first would fire it on a lane it was never
      // written for.
      expect(reference).toMatch(/orthogonal/i);
      expect(reference).toMatch(/never merged into `?rejection-reclaim`?/i);
    });

    it("keys on authorship, not merely on a backward move", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/authored by/i);
      }
      expect(reference).toMatch(/backward/i);
    });

    it("names the negative classification alongside the positive one", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("no-reversal");
      }
    });

    // The two controls below are what stop this predicate from degenerating.
    // A classification that only ever says "reversal" is satisfied by a rule
    // that suppresses everything, and a suppress-everything rule reads as a
    // hardening while switching the loop off. Each acceptance case above is
    // paired with one of these.

    it("CONTROL: the loop's own backward move is not a reversal", () => {
      // Without this, the skill reads its own transitions as human
      // corrections and suppresses itself into doing nothing at all.
      expect(reference).toMatch(/the later move was itself automation/i);
      expect(eager).toMatch(/with no automation move after it/i);
    });

    it("CONTROL: a genuine new blocker stays a legitimate warrant", () => {
      // A predicate keyed on DIRECTION rather than authorship would suppress
      // this too — the item returned to blocked because the world moved on,
      // not because anyone was overruled — and the loop would stop responding
      // to real blockers while looking like it had been tightened.
      expect(reference).toMatch(/genuine new blocker appeared/i);
      expect(reference).toMatch(/world moving on/i);
      expect(eager).toMatch(/real new blocker appeared/i);
    });

    it("requires the order of the two events to be established, never inferred from co-occurrence", () => {
      // A hold label applied BEFORE a transition guards it; the same label
      // applied AFTER records that the transition was undone. Sourcing and
      // attribution both pass on an invented sequence; only ordering does not.
      for (const doc of [eager, reference]) {
        expect(doc).toContain("say nothing until you know their order");
      }
    });

    it("binds authorship to each vendor history surface", () => {
      expect(reference).toContain("actor");
      expect(reference).toContain("author");
      expect(reference).toContain("lisa-github-read-issue");
      expect(reference).toContain("changelog key:<K>");
      expect(reference).toContain("history id:<ID>");
    });

    it("treats an unexposed actor as unknown, never as an assumed human", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/never an assumed human/i);
      }
    });

    it("resolves the blocked lane from config like every other lane", () => {
      expect(reference).toContain("build.blocked");
      expect(reference).toMatch(/never hardcode/i);
    });

    it("degrades to unknown and never blocks the sweep", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/neither a reversal nor a clearance/i);
      }
      expect(reference).toMatch(/never blocks the sweep/i);
      expect(repair).toMatch(/never blocks the sweep/i);
    });

    it("inherits the learning-loop exclusion", () => {
      expect(reference).toMatch(/same learning-loop exclusion applies/i);
      expect(reference).toContain("learning:needs-triage");
    });

    it("inverts the warrant: suppress, escalate, and require postdating evidence", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/suppress|do not re-apply/i);
        expect(doc).toContain(HUMAN_GATE);
        expect(doc).toMatch(/postdates the reversal/i);
      }
    });

    it("is signed per path — the stalled-work keep-alive reading is unchanged", () => {
      // The trap: a global "human activity no longer counts as a warrant"
      // reads as tightening while switching off the staleness path, where a
      // human comment already suppresses action and is protective.
      for (const doc of [eager, reference, repair]) {
        expect(doc).toMatch(/signed per path/i);
      }
      expect(repair).toMatch(/staleness clock/i);
    });

    it("repair-intake cites the reversal half, not only the proposal half", () => {
      expect(repair).toContain(REVERSAL);
      expect(repair).toContain("rejection-detection");
    });

    it("classifies before any lifecycle write, so it wraps every repair path", () => {
      // A reversed rollup reconciliation involves no dependency link at all,
      // so detection cannot live inside the blocker-classification branches.
      expect(repair).toMatch(/before any lifecycle write/i);
    });

    it("the fingerprint carries authorship and an overturn bit, not only state", () => {
      expect(repair).toMatch(/overturn/i);
      expect(repair).toMatch(/authorship/i);
    });

    it("a changed fingerprint is no longer an unconditional warrant to re-attempt", () => {
      expect(repair).toMatch(/not on its own a\s+warrant/i);
    });

    it("reports a suppressed reversal as its own bucket, never folded into still_blocked", () => {
      // "I declined to act because I was overruled" and "I looked and the
      // blocker stands" are different facts about the loop, and only the first
      // tells an operator their correction was received.
      expect(repair).toContain("reversal_suppressed");
      expect(repair).toMatch(/reversed transition/i);
      expect(repair).toContain("approval-requested");
    });

    it("checks the human-gate marker before ANY repair transition, not only Class C", () => {
      expect(repair).toMatch(/before \*\*any\*\* repair transition/i);
    });

    it("never removes a human-gate marker this skill did not apply", () => {
      expect(repair).toMatch(/did not apply/i);
      expect(repair).toMatch(/leave the marker in place/i);
    });
  });
});
