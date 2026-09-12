/**
 * The human gate's inverse — what the release PLANS, and what it refuses.
 *
 * Half of #3852 is that a hold could not be lifted; the other half is that
 * there was no safe way to lift one by hand either. The only description write
 * the plugin has is a whole-body replacement, so deleting one HTML comment
 * meant rewriting an entire record — acceptance criteria, validation journey,
 * managed usage section and all. A release procedure that risks destroying what
 * it releases is not a release procedure, which is why each individual release
 * was a gamble nobody took and the population of held items only grew.
 *
 * So the plan asserted here writes labels and a comment and nothing else, and
 * it refuses in both directions: an item still held plans nothing, and an item
 * never held plans nothing — without which this would be a path that puts the
 * build-ready role on arbitrary items, a promotion mechanism wearing a release
 * mechanism's name.
 *
 * The held-ness verdict this consumes is covered in
 * `human-gate-release-inverse`.
 * @module tests/unit/strategies/human-gate-release-plan
 */
import { describe, expect, it } from "vitest";

import {
  HUMAN_GATE_RELEASE_MARKER,
  formatHumanGateNote,
  formatHumanGateReleaseNote,
  formatNormalizationHoldNote,
  planHumanGateRelease,
  summarizeHumanGateReleases,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";

import {
  BODY,
  HOLD_LINE,
  LIFECYCLE,
  NEEDED,
  OTHER_RELEASE,
  READY,
  REASON,
  RELEASE,
  trustedHistory,
} from "./human-gate-release-helpers.js";

describe("releasing a hold never rewrites the description", () => {
  it("plans only label and comment writes", () => {
    const plan = planHumanGateRelease({
      body: BODY,
      labels: [NEEDED],
      ...trustedHistory([RELEASE]),
      readyLabel: READY,
      lifecycleLabels: LIFECYCLE,
    });

    expect(plan.released).toBe(true);
    expect(plan.discharged).toEqual([REASON]);
    expect(plan.actions).toEqual({
      removeHumanNeededLabel: true,
      addReadyLabel: READY,
      comment: true,
    });
    // The plan's whole surface is these three keys. A body write cannot hide in
    // it, which is the structural form of "no whole-body replacement".
    expect(
      Object.keys(plan.actions).sort((a, b) => a.localeCompare(b))
    ).toEqual(["addReadyLabel", "comment", "removeHumanNeededLabel"]);
  });

  it("leaves the hold in the description as readable history", () => {
    const plan = planHumanGateRelease({
      body: BODY,
      labels: [NEEDED],
      ...trustedHistory([RELEASE]),
      readyLabel: READY,
      lifecycleLabels: LIFECYCLE,
    });

    expect(plan.released).toBe(true);
    // Nothing in the flow consumed or transformed the body, so the record an
    // operator would have had to rewrite is byte-for-byte what it was.
    expect(BODY).toContain(HOLD_LINE);
    expect(BODY).toContain("## Lisa Usage");
  });

  it("tells an operator to comment rather than edit the description", () => {
    for (const note of [formatHumanGateNote(), formatNormalizationHoldNote()]) {
      expect(note).toContain(HUMAN_GATE_RELEASE_MARKER);
      expect(note).toContain("do not edit the description");
      expect(note).not.toContain("remove the hold note from the description");
    }
  });

  it("says the description was left alone when it reports a release", () => {
    const note = formatHumanGateReleaseNote();

    expect(note).toMatch(/description is exactly as it was/i);
    expect(note).not.toContain(HUMAN_GATE_RELEASE_MARKER);
  });
});

describe("the release path can only ever un-do a hold", () => {
  it("plans nothing for an item that is still held", () => {
    const plan = planHumanGateRelease({
      body: BODY,
      labels: [NEEDED],
      ...trustedHistory([OTHER_RELEASE]),
      readyLabel: READY,
      lifecycleLabels: LIFECYCLE,
    });

    expect(plan).toEqual({
      released: false,
      reason: "hold-outstanding",
      discharged: [],
      actions: {
        removeHumanNeededLabel: false,
        addReadyLabel: null,
        comment: false,
      },
    });
  });

  it("plans nothing for an item that was never held", () => {
    // Without this it is a path that adds the build-ready role to arbitrary
    // items — a promotion mechanism wearing a release mechanism's name.
    const plan = planHumanGateRelease({
      body: "An ordinary ticket with no hold on it.",
      labels: [],
      ...trustedHistory([RELEASE]),
      readyLabel: READY,
      lifecycleLabels: LIFECYCLE,
    });

    expect(plan.released).toBe(false);
    expect(plan.reason).toBe("no-hold");
    expect(plan.actions.addReadyLabel).toBeNull();
  });

  it("does not drag an item that has moved on back to the queue", () => {
    const plan = planHumanGateRelease({
      body: BODY,
      labels: [NEEDED, "status:done"],
      ...trustedHistory([RELEASE]),
      readyLabel: READY,
      lifecycleLabels: LIFECYCLE,
    });

    expect(plan.actions.removeHumanNeededLabel).toBe(true);
    expect(plan.actions.addReadyLabel).toBeNull();
  });

  it("is idempotent by state, so a second cycle mutates nothing", () => {
    const plan = planHumanGateRelease({
      body: BODY,
      labels: [READY],
      ...trustedHistory([RELEASE]),
      readyLabel: READY,
      lifecycleLabels: LIFECYCLE,
    });

    expect(plan.reason).toBe("already-released");
    expect(plan.actions).toEqual({
      removeHumanNeededLabel: false,
      addReadyLabel: null,
      comment: false,
    });
  });

  it("does not let the marker label veto restoring the queue role", () => {
    // `human_needed` is one of the configured lifecycle labels AND the label
    // this plan removes. Counting it would clear the flag and leave the item in
    // no queue at all — the original defect with one fewer symptom.
    const plan = planHumanGateRelease({
      body: BODY,
      labels: [NEEDED],
      ...trustedHistory([RELEASE]),
      readyLabel: READY,
      lifecycleLabels: LIFECYCLE,
    });

    expect(plan.actions.addReadyLabel).toBe(READY);
  });
});

describe("an operator can see that a held item is waiting on nobody", () => {
  it("names what was released, and says so even when nothing was", () => {
    expect(summarizeHumanGateReleases(["#41", "#98"])).toBe(
      "Released back to the queue (2): #41, #98."
    );
    // Printed at zero on purpose: a release path that has stopped working and a
    // cycle with nothing to release read identically otherwise.
    expect(summarizeHumanGateReleases([])).toBe(
      "Released back to the queue: none."
    );
  });
});
