/**
 * The human gate on the ready-lane path (#3552).
 *
 * `[lisa-human-gate]` in a work item's body was invisible to ready-lane
 * selection. The check existed, read the body correctly, and had exactly one
 * caller — the pre-work re-probe, which by its own scope line runs only for
 * candidates NOT in the ready lane. An item already sitting in ready was
 * therefore claimed with the gate never consulted, and one was dispatched and
 * fully implemented before a human vetoed the merge.
 *
 * This is the shape where a control reports success while structurally unable
 * to see the thing it guards: every cycle that selected the gated item recorded
 * an honest "eligible candidate claimed". Nothing was broken and nothing warned,
 * because the gate was never asked.
 *
 * Two properties are pinned here, and the second is the one that is easy to get
 * wrong. Excluding the item is not enough on its own: `lisa-repair-intake`
 * sweeps items that are NOT in the ready role and excludes gated ones outright,
 * so a ready AND gated item is outside its filter twice over. Exclusion alone
 * would leave it re-rejected every cycle forever, visible to nothing — a quieter
 * failure, not a fixed one. The lane is therefore reconciled to match the hold.
 * @module tests/unit/strategies/intake-ready-human-gate
 */
import { describe, expect, it } from "vitest";

import {
  HUMAN_GATE_NOTE_MARKER,
  classifyReadyCandidate,
  formatHumanGateNote,
  planHumanGateReconciliation,
  summarizeHumanGateHolds,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";

/** The configured lane label a build-ready item carries. */
const READY = "status:ready";

/** The configured marker for a block only a person can clear. */
const NEEDED = "human-needed";

/** A body carrying the marker with a reason key, as most writers stamp it. */
const KEYED_BODY =
  "Held for a human product call.\n<!-- [lisa-human-gate] reason=pricing -->";

/** The same hold with no `reason=` key — equally valid, and easy to miss. */
const KEYLESS_BODY =
  "Some description.\n\n[lisa-human-gate]\n\nMore text after it.";

/** The verdict a held item must produce, asserted rather than a bare refusal. */
const HELD = "human-gate";

describe("a ready-lane candidate held for a person is not claimable", () => {
  it.each([
    ["with a reason key", KEYED_BODY],
    ["with no reason key", KEYLESS_BODY],
  ])("refuses the claim %s", (_variant, body) => {
    const verdict = classifyReadyCandidate({
      labels: [READY],
      body,
      humanNeededLabel: NEEDED,
    });

    expect(verdict.claimable).toBe(false);
    // The REASON is asserted, not just the refusal. A candidate skipped for
    // repo-scope or leaf-only would satisfy a bare not-claimable assertion
    // while this gate stayed dead — which is how the defect survived.
    expect(verdict.reason).toBe(HELD);
    expect(verdict.humanGated).toBe(true);
  });

  it("still refuses when the marker sits nowhere near the top", () => {
    const buried = `${"filler\n".repeat(40)}[lisa-human-gate] reason=late`;
    expect(classifyReadyCandidate({ body: buried }).reason).toBe(HELD);
  });

  // The rejection control. A suite asserting only the exclusion is satisfied by
  // a picker that excludes everything, which would stop the queue dead.
  it("claims an ordinary ready candidate with no marker", () => {
    const verdict = classifyReadyCandidate({
      labels: [READY],
      body: "An ordinary item. Nothing is held here.",
      humanNeededLabel: NEEDED,
    });

    expect(verdict.claimable).toBe(true);
    expect(verdict.reason).toBe("ready-eligible");
    expect(verdict.humanGated).toBe(false);
  });

  it("refuses on the configured label even with no marker in the body", () => {
    expect(
      classifyReadyCandidate({
        labels: [READY, NEEDED],
        body: "No marker in here.",
        humanNeededLabel: NEEDED,
      }).reason
    ).toBe(HELD);
  });
});

describe("the lane is reconciled to match the hold, exactly once", () => {
  it("moves a gated ready item out of the queue and marks it", () => {
    const plan = planHumanGateReconciliation({
      labels: [READY],
      body: KEYED_BODY,
      humanNeededLabel: NEEDED,
      readyLabel: READY,
    });

    expect(plan.gated).toBe(true);
    expect(plan.reason).toBe("reconcile");
    expect(plan.actions).toEqual({
      removeReadyRole: true,
      addHumanNeededLabel: true,
      comment: true,
    });
  });

  // The second rejection control, and the one that keeps this from becoming a
  // comment generator. An item already out of the queue and already marked has
  // nothing left to change.
  it("plans no second mutation for an already-reconciled item", () => {
    const plan = planHumanGateReconciliation({
      labels: [NEEDED],
      body: KEYED_BODY,
      humanNeededLabel: NEEDED,
      readyLabel: READY,
    });

    expect(plan.gated).toBe(true);
    expect(plan.reason).toBe("already-reconciled");
    expect(plan.actions).toEqual({
      removeReadyRole: false,
      addHumanNeededLabel: false,
      comment: false,
    });
  });

  it("finishes a half-done repair without commenting twice", () => {
    // Marked but still in the queue, and a note already posted — the shape a
    // partially failed earlier cycle leaves behind.
    const plan = planHumanGateReconciliation({
      labels: [READY, NEEDED],
      body: KEYED_BODY,
      humanNeededLabel: NEEDED,
      readyLabel: READY,
      alreadyNotified: true,
    });

    expect(plan.actions.removeReadyRole).toBe(true);
    expect(plan.actions.addHumanNeededLabel).toBe(false);
    expect(plan.actions.comment).toBe(false);
  });

  it("plans nothing at all for an item that is not held", () => {
    const plan = planHumanGateReconciliation({
      labels: [READY],
      body: "Ordinary work.",
      humanNeededLabel: NEEDED,
      readyLabel: READY,
    });

    expect(plan.gated).toBe(false);
    expect(plan.reason).toBe("not-gated");
    expect(plan.actions).toEqual({
      removeReadyRole: false,
      addHumanNeededLabel: false,
      comment: false,
    });
  });
});

describe("what the operator reads", () => {
  it("says what was found, what changed, and how to undo it", () => {
    const note = formatHumanGateNote();

    expect(note).toContain("What was found:");
    expect(note).toContain("What changed:");
    expect(note).toContain("To resume it:");
    expect(note).toContain(HUMAN_GATE_NOTE_MARKER);
  });

  it("uses no vocabulary the reader has to already know", () => {
    const note = formatHumanGateNote().replace(HUMAN_GATE_NOTE_MARKER, "");

    // The person standing at this gate is the one who applied the hold, not the
    // one who maintains intake. Naming a skill, a label, or a phase tells them
    // nothing they can act on.
    for (const jargon of [
      "status:",
      "lisa-",
      "Phase",
      "$READY",
      "label",
      "intake",
    ]) {
      expect(note).not.toContain(jargon);
    }
  });

  it("names what it held so the run is auditable", () => {
    expect(summarizeHumanGateHolds(["#41", "#87"])).toBe(
      "Held for a person (2): #41, #87."
    );
  });

  it("distinguishes nothing eligible from something held", () => {
    expect(summarizeHumanGateHolds([])).toBe("Held for a person: none.");
  });
});
