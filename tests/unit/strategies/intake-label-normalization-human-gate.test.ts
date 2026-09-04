/**
 * The human gate on the label-normalization promotion path (#3805).
 *
 * Two halves of one contract had drifted apart. The writer that files a
 * deliberately held work item stamps only the body marker — never the
 * configured human-needed label — so **every** correctly filed hold is
 * marker-only by construction. The repair sweep that promotes unlabelled items
 * into the build queue keyed on labels alone, and `human_needed` is one of the
 * lifecycle labels whose *absence* it enumerates. A marker-only hold is
 * therefore that sweep's population by definition, and the sweep applies the
 * build-ready label to it.
 *
 * The `[lisa-human-gate]` exclusion did exist — in a *different*, read-only
 * sweep in the same file. The one sweep that writes was the one that could not
 * see the marker.
 *
 * Both directions are pinned here, and neither is worth anything alone. A
 * suite proving only the hold is satisfied by a planner that normalizes
 * nothing, which stops the queue dead; a suite proving only the pass-through is
 * satisfied by the defect. The refusal REASON is asserted rather than the bare
 * refusal, because an item skipped for any other cause would satisfy a
 * not-normalized assertion while this gate stayed dead — which is exactly how
 * the ready-lane arm of the same defect (#3552) survived.
 *
 * The planner deliberately mutates nothing on a match. `planHumanGateReconciliation`
 * turns a match into durable state (it strips the ready role and applies the
 * label), so a false positive there latches. The match here is a bare substring
 * test whose imprecision is tracked separately (#3815), so this path refuses
 * and reports read-only instead of writing a label of its own — the safe
 * failure direction, without the latch.
 * @module tests/unit/strategies/intake-label-normalization-human-gate
 */
import { describe, expect, it } from "vitest";

import {
  NORMALIZATION_HOLD_NOTE_MARKER,
  formatNormalizationHoldNote,
  isHumanGated,
  planLabelNormalization,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";

/** The configured build-ready label the sweep applies. */
const READY = "status:ready";

/** The configured marker naming a hold only a person can clear. */
const NEEDED = "human-needed";

/** Every configured lifecycle label whose absence the sweep enumerates on. */
const LIFECYCLE = Object.freeze([
  READY,
  "status:in-progress",
  "status:blocked",
  "status:done",
  NEEDED,
]);

/** A hold written the way the vendor writers stamp it. */
const KEYED_BODY =
  "Held for a human product call: pricing.\n<!-- [lisa-human-gate] reason=pricing -->";

/** The same hold with no `reason=` key — equally valid, and easy to miss. */
const KEYLESS_BODY = "Some description.\n\n[lisa-human-gate]\n\nMore text.";

/** The verdict a held item must produce. */
const HELD = "human-gate";

/** An item body with no hold in it, used as the pass-through control. */
const UNGATED_BODY = "Ordinary work.";

describe("a marker-only hold is never normalized into the build queue", () => {
  it.each([
    ["with a reason key", KEYED_BODY],
    ["with no reason key", KEYLESS_BODY],
  ])("refuses to promote it %s", (_variant, body) => {
    const plan = planLabelNormalization({
      labels: ["type:Task", "component:docs"],
      body,
      humanNeededLabel: NEEDED,
      lifecycleLabels: LIFECYCLE,
      readyLabel: READY,
    });

    expect(plan.normalize).toBe(false);
    expect(plan.reason).toBe(HELD);
    expect(plan.humanGated).toBe(true);
    expect(plan.actions.addReadyLabel).toBeNull();
  });

  it("still refuses when the marker sits nowhere near the top", () => {
    const buried = `${"filler\n".repeat(40)}[lisa-human-gate] reason=late`;

    expect(
      planLabelNormalization({
        labels: [],
        body: buried,
        lifecycleLabels: LIFECYCLE,
        readyLabel: READY,
      }).reason
    ).toBe(HELD);
  });

  it("refuses on the configured label even with no marker in the body", () => {
    expect(
      planLabelNormalization({
        labels: [NEEDED],
        body: "No marker in here.",
        humanNeededLabel: NEEDED,
        lifecycleLabels: LIFECYCLE,
        readyLabel: READY,
      }).reason
    ).toBe(HELD);
  });

  // The hold is reported, not merely skipped. A promotion the sweep declines
  // and says nothing about is invisible, which is the quieter version of the
  // same failure.
  it("reports the hold so the run record names it", () => {
    expect(
      planLabelNormalization({
        labels: [],
        body: KEYED_BODY,
        lifecycleLabels: LIFECYCLE,
        readyLabel: READY,
      }).actions.reportHold
    ).toBe(true);
  });

  // The mirror defect, stated as a property. Writing a label here would turn a
  // false positive from a skipped cycle into durable state, which is #3815's
  // consequence arriving on a second path.
  it("writes no label of its own when it holds", () => {
    const plan = planLabelNormalization({
      labels: [],
      body: KEYED_BODY,
      humanNeededLabel: NEEDED,
      lifecycleLabels: LIFECYCLE,
      readyLabel: READY,
    });

    expect(plan.actions).toEqual({ addReadyLabel: null, reportHold: true });
  });

  // Order is load-bearing: the gate is consulted before anything else, so no
  // classification and no configured lane can promote an item a person parked.
  it("checks the hold before the lifecycle-membership test", () => {
    expect(
      planLabelNormalization({
        labels: ["status:blocked"],
        body: KEYED_BODY,
        lifecycleLabels: LIFECYCLE,
        readyLabel: READY,
      }).reason
    ).toBe(HELD);
  });
});

describe("a genuinely ungated item still flows", () => {
  // The rejection control. Without it the suite above is satisfied by a
  // planner that normalizes nothing at all.
  it("normalizes an unlabelled item with no marker", () => {
    const plan = planLabelNormalization({
      labels: ["type:Bug"],
      body: "An ordinary defect. Nothing is held here.",
      humanNeededLabel: NEEDED,
      lifecycleLabels: LIFECYCLE,
      readyLabel: READY,
    });

    expect(plan.normalize).toBe(true);
    expect(plan.reason).toBe("normalize");
    expect(plan.humanGated).toBe(false);
    expect(plan.actions).toEqual({ addReadyLabel: READY, reportHold: false });
  });

  it("applies the configured ready label verbatim, casing included", () => {
    expect(
      planLabelNormalization({
        labels: [],
        body: UNGATED_BODY,
        lifecycleLabels: LIFECYCLE,
        readyLabel: "PRD-Ready",
      }).actions.addReadyLabel
    ).toBe("PRD-Ready");
  });

  it("leaves an item that already carries a lifecycle label alone", () => {
    const plan = planLabelNormalization({
      labels: ["status:in-progress"],
      body: UNGATED_BODY,
      lifecycleLabels: LIFECYCLE,
      readyLabel: READY,
    });

    expect(plan.normalize).toBe(false);
    expect(plan.reason).toBe("already-in-lifecycle");
    expect(plan.actions).toEqual({ addReadyLabel: null, reportHold: false });
  });

  it("promotes nothing when no ready label is configured", () => {
    const plan = planLabelNormalization({
      labels: [],
      body: UNGATED_BODY,
      lifecycleLabels: LIFECYCLE,
      readyLabel: "",
    });

    expect(plan.normalize).toBe(false);
    expect(plan.reason).toBe("no-ready-label");
    expect(plan.actions.addReadyLabel).toBeNull();
  });
});

describe("the held-ness question has one answer, not several", () => {
  // Direction (3) of the ticket: the shared predicate is exported so no
  // selection or promotion path re-implements a label-only test. Two copies of
  // a substring test drift, and a drifted gate fails silently.
  it.each([
    ["the body marker alone", { body: KEYED_BODY }],
    ["the configured label alone", { labels: [NEEDED], body: "" }],
  ])("answers true for %s", (_variant, input) => {
    expect(isHumanGated({ ...input, humanNeededLabel: NEEDED })).toBe(true);
  });

  it("answers false for an item with neither", () => {
    expect(
      isHumanGated({
        labels: ["type:Task"],
        body: UNGATED_BODY,
        humanNeededLabel: NEEDED,
      })
    ).toBe(false);
  });
});

describe("what the operator reads when a hold is left alone", () => {
  it("says what was found, that nothing changed, and how to resume", () => {
    const note = formatNormalizationHoldNote();

    expect(note).toContain("What was found:");
    expect(note).toContain("What changed:");
    expect(note).toContain("To resume it:");
    expect(note).toContain(NORMALIZATION_HOLD_NOTE_MARKER);
  });

  // The note's own marker must not read as a hold declaration, or a sweep that
  // reads bodies would treat the note as the thing it is reporting on.
  it("carries a marker that is not itself the hold marker", () => {
    expect(NORMALIZATION_HOLD_NOTE_MARKER).not.toContain("[lisa-human-gate]");
  });

  it("uses no vocabulary the reader has to already know", () => {
    const note = formatNormalizationHoldNote().replace(
      NORMALIZATION_HOLD_NOTE_MARKER,
      ""
    );

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
});
