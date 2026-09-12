/**
 * Regression coverage for the human gate's inverse — the verdict itself.
 *
 * The defect (#3852): a path existed that APPLIED a hold — it found the marker,
 * pulled the item out of the build queue and stamped it as needing a person —
 * and no path existed that RELEASED one. A person could be asked to decide,
 * decide, record the decision on the item, and the item stayed held. Forever.
 * The expensive part of the pipeline — getting a person's attention, framing
 * the question, obtaining a judgment — was paid for and the answer discarded.
 *
 * These tests bite in BOTH directions, because a fix that ends holds by ending
 * the gate would be far worse than the defect it replaces:
 * - a hold whose recorded release names it is LIFTED, and
 * - a hold with no matching release still HOLDS.
 *
 * The release direction fails against the pre-fix reader, which had no
 * discharge branch at all; the still-held direction passes against it, which is
 * what makes this a control rather than a demonstration that the code runs.
 *
 * What the release PLANS is covered in `human-gate-release-plan`, and the
 * registry row, the five shipped copies and the skills in
 * `human-gate-release-reach`.
 * @module tests/unit/strategies/human-gate-release-inverse
 */
import { describe, expect, it } from "vitest";

import {
  HUMAN_GATE_MARKER,
  HUMAN_GATE_RELEASE_MARKER,
  classifyPreWorkCandidate,
  classifyReadyCandidate,
  humanGateDischarged,
  humanGateHolds,
  humanGateMentions,
  humanGateReleases,
  humanGateVerdict,
  isHumanGated,
  planLabelNormalization,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";

import {
  BODY,
  LIFECYCLE,
  NEEDED,
  OTHER_RELEASE,
  READY,
  REASON,
  RELEASE,
  trustedHistory,
  UNRELATED,
  TRUSTED_HUMAN_ACTOR_IDS,
} from "./human-gate-release-helpers.js";

const gated = (comments: readonly string[]): boolean =>
  isHumanGated({ body: BODY, labels: [NEEDED], ...trustedHistory(comments) });

describe("a discharged hold releases the item", () => {
  it("stops reporting the item as held once the release is recorded", () => {
    // Pre-fix this was true for ANY comment history, because the reader had no
    // discharge branch at all: the marker's presence was the whole verdict.
    expect(gated([UNRELATED, RELEASE])).toBe(false);
  });

  it("lets the ready-lane claim gate select it again", () => {
    expect(
      classifyReadyCandidate({
        body: BODY,
        labels: [NEEDED, READY],
        ...trustedHistory([RELEASE]),
      })
    ).toEqual({
      claimable: true,
      reason: "ready-eligible",
      humanGated: false,
    });
  });

  it("lets the pre-work classifier select it again", () => {
    const result = classifyPreWorkCandidate({
      laneType: "unstarted",
      body: BODY,
      labels: [NEEDED],
      ...trustedHistory([RELEASE]),
      statedBlocker: "",
    });

    expect(result.humanGated).toBe(false);
    expect(result.selectable).toBe(true);
  });

  it("lets the label-normalization sweep promote it again", () => {
    const result = planLabelNormalization({
      body: BODY,
      labels: [],
      ...trustedHistory([RELEASE]),
      lifecycleLabels: LIFECYCLE,
      readyLabel: READY,
    });

    expect(result.humanGated).toBe(false);
    expect(result.actions.addReadyLabel).toBe(READY);
  });
});

describe("a hold nobody answered still holds", () => {
  it("holds with no comments at all", () => {
    expect(gated([])).toBe(true);
  });

  it("holds when the comments say everything except the release", () => {
    expect(gated([UNRELATED, "We discussed this in standup and agreed."])).toBe(
      true
    );
  });

  it("holds when a release names a different hold", () => {
    expect(gated([OTHER_RELEASE])).toBe(true);
  });

  it("holds when only one of two declared holds was answered", () => {
    const twoHolds = `${BODY}\n<!-- ${HUMAN_GATE_MARKER} reason=legal-review -->`;

    expect(isHumanGated({ body: twoHolds, ...trustedHistory([RELEASE]) })).toBe(
      true
    );
    expect(
      isHumanGated({
        body: twoHolds,
        ...trustedHistory([RELEASE, OTHER_RELEASE]),
      })
    ).toBe(false);
  });

  it("refuses to claim or promote an unanswered hold", () => {
    expect(
      classifyReadyCandidate({
        body: BODY,
        labels: [READY],
        ...trustedHistory([]),
      })
    ).toEqual({ claimable: false, reason: "human-gate", humanGated: true });
    expect(
      classifyPreWorkCandidate({
        laneType: "unstarted",
        body: BODY,
        ...trustedHistory([UNRELATED]),
        statedBlocker: "",
      }).selectable
    ).toBe(false);
  });

  it("fails CLOSED when the discharge surface was never read", () => {
    // Every caller that has not been taught to pass comments keeps its current
    // behaviour by construction. Holding a gate that may be stale beats
    // releasing one that is not, and this fix must not remove a control while
    // correcting one.
    expect(isHumanGated({ body: BODY, labels: [NEEDED] })).toBe(true);
  });
});

describe("the release is symmetric with the hold it ends", () => {
  it("records the discharge against the reason the hold declared", () => {
    expect(humanGateHolds(BODY)).toEqual([REASON]);
    expect(
      humanGateReleases(
        trustedHistory([RELEASE]).comments,
        TRUSTED_HUMAN_ACTOR_IDS
      )
    ).toEqual([REASON]);
    expect(
      humanGateDischarged({ body: BODY, ...trustedHistory([RELEASE]) })
    ).toBe(true);
  });

  it("reads the discharge with the same reader that reads the hold", () => {
    const verdict = humanGateVerdict({
      body: BODY,
      labels: [NEEDED],
      ...trustedHistory([RELEASE]),
    });

    expect(verdict.held).toBe(false);
    expect(verdict.reason).toBe("hold-released");
    expect(verdict.declared).toBe(1);
    expect(verdict.released).toEqual([REASON]);
    expect(verdict.labelPresent).toBe(true);
  });

  it("pairs a hold and a release across letter case and spacing drift", () => {
    const loose = `${HUMAN_GATE_RELEASE_MARKER} reason=  Pricing-Tier `;

    expect(isHumanGated({ body: BODY, ...trustedHistory([loose]) })).toBe(
      false
    );
  });

  it("discharges a keyless hold only with a keyless release", () => {
    const keyless = `${HUMAN_GATE_MARKER} someone needs to look at this`;

    expect(humanGateHolds(keyless)).toEqual([""]);
    expect(isHumanGated({ body: keyless, ...trustedHistory([RELEASE]) })).toBe(
      true
    );
    expect(
      isHumanGated({
        body: keyless,
        ...trustedHistory([HUMAN_GATE_RELEASE_MARKER]),
      })
    ).toBe(false);
  });

  it("treats the marker label as a mirror of the hold, not a second hold", () => {
    // The writers stamp both surfaces for ONE hold. Counting the label
    // separately would leave every mirrored hold permanently outstanding under
    // a keyed release — this defect, one layer down.
    expect(gated([RELEASE])).toBe(false);
  });

  it("holds on a label-only item until a keyless release is recorded", () => {
    expect(
      isHumanGated({ labels: [NEEDED], ...trustedHistory([UNRELATED]) })
    ).toBe(true);
    expect(
      isHumanGated({
        labels: [NEEDED],
        ...trustedHistory([HUMAN_GATE_RELEASE_MARKER]),
      })
    ).toBe(false);
  });

  it("does not let a release marker read as a fresh hold declaration", () => {
    // `[lisa-human-gate]` closes with `]`, so the release marker is not a
    // superstring of it. A release that declared a hold would re-arm the gate
    // it just lifted.
    expect(HUMAN_GATE_RELEASE_MARKER.includes(HUMAN_GATE_MARKER)).toBe(false);
    expect(humanGateMentions(RELEASE).declared).toBe(0);
  });

  it("does not read a comment DISCUSSING a release as a release", () => {
    const chatter = `Should we post a \`${HUMAN_GATE_RELEASE_MARKER}\` here?`;

    expect(
      humanGateReleases(
        trustedHistory([chatter]).comments,
        TRUSTED_HUMAN_ACTOR_IDS
      )
    ).toEqual([]);
    expect(isHumanGated({ body: BODY, ...trustedHistory([chatter]) })).toBe(
      true
    );
  });

  it("reads an authorized release out of a vendor comment object", () => {
    expect(
      isHumanGated({
        body: BODY,
        comments: [{ body: RELEASE, user: { id: TRUSTED_HUMAN_ACTOR_IDS[0] } }],
        trustedHumanActorIds: TRUSTED_HUMAN_ACTOR_IDS,
      })
    ).toBe(false);
  });
});
