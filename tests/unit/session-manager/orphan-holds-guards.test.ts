/**
 * Guards on the hold sweep from PR review (CodySwannGT/lisa#4722): a hold
 * gets the same "not ours to touch" checks as an orphan (someone else's
 * item, an item touched within `staleHours`, an undated item), and a lift
 * that, once the lane check has failed closed, has nothing left to write is
 * skipped rather than spending the cap every cycle.
 * @module tests/unit/session-manager/orphan-holds-guards
 */
import { describe, expect, it } from "vitest";

import {
  NEEDED,
  RECENT,
  STRANGER,
  TOPIC,
  heldBody,
  hold,
  orphan,
  plan,
  ref,
} from "./support/orphan-fixtures.js";

/** A Jira-style lane vocabulary: roles are workflow states. */
const JIRA = {
  rolesAreStates: true,
  readyLabel: "Ready",
  lifecycleLabels: ["Ready", "In Progress", "Done", NEEDED],
  roleLabels: { ready: "Ready", claimed: "In Progress", done: ["Done"] },
};

/** The lift comment an earlier cycle already posted for {@link TOPIC}. */
const POSTED_LIFT = {
  body: `[lisa-human-gate-lifted] reason=${TOPIC}\nHold lifted earlier.`,
};

describe("holds get the orphan guards", () => {
  it("skips a hold assigned to someone who is neither me nor an operator", () => {
    const result = plan({ holds: [hold(1, { assignees: [STRANGER] })] });
    expect(result.skipped).toEqual([{ ref: ref(1), reason: "foreign" }]);
    expect(result.holds.keep).toEqual([]);
  });

  it("still lists a fresh hold that only a person can act on", () => {
    const result = plan({ holds: [hold(1, { updatedAt: RECENT })] });
    expect(result.holds.keep.map(entry => entry.ref)).toEqual([ref(1)]);
    expect(result.holds.digest.text).toContain(ref(1));
    expect(result.skipped).toEqual([]);
  });

  it("still lists an undated hold that only a person can act on", () => {
    const result = plan({ holds: [hold(1, { updatedAt: undefined })] });
    expect(result.holds.keep.map(entry => entry.ref)).toEqual([ref(1)]);
  });

  it("does not lift a fresh hold", () => {
    const result = plan({
      holds: [hold(1, { body: heldBody(TOPIC), updatedAt: RECENT })],
    });
    expect(result.holds.lift).toEqual([]);
    expect(result.skipped).toEqual([{ ref: ref(1), reason: "fresh" }]);
  });

  it("does not lift an undated hold", () => {
    const result = plan({
      holds: [hold(1, { body: heldBody(TOPIC), updatedAt: undefined })],
    });
    expect(result.holds.lift).toEqual([]);
    expect(result.skipped).toEqual([{ ref: ref(1), reason: "undated" }]);
  });

  it("keeps a fresh partial lift's human reasons but skips the lift", () => {
    const body = [
      "Two things are pending.",
      "<!-- [lisa-human-gate] reason=naming-triage -->",
      "<!-- [lisa-human-gate] reason=pricing-tier -->",
    ].join("\n");
    const result = plan(
      { holds: [hold(1, { body, updatedAt: RECENT })] },
      { humanOnly: ["pricing"] }
    );
    expect(result.holds.lift).toEqual([]);
    expect(result.skipped).toEqual([{ ref: ref(1), reason: "fresh" }]);
    expect(result.holds.keep).toEqual([
      { ref: ref(1), reason: expect.stringContaining("pricing tier") },
    ]);
  });

  it("keeps the digest fingerprint when a kept hold becomes fresh", () => {
    const stale = plan({ holds: [hold(1), hold(2, { body: "x" })] });
    const touched = plan({
      holds: [hold(1, { updatedAt: RECENT }), hold(2, { body: "x" })],
    });
    expect(touched.holds.digest.fingerprint).toBe(
      stale.holds.digest.fingerprint
    );
    const again = plan(
      { holds: [hold(1, { updatedAt: RECENT }), hold(2, { body: "x" })] },
      { previousDigest: stale.holds.digest.fingerprint }
    );
    expect(again.holds.digest.changed).toBe(false);
  });

  it("still judges an unassigned, stale hold", () => {
    const result = plan({
      holds: [hold(1), hold(2, { body: heldBody(TOPIC) })],
    });
    expect(result.holds.keep.map(entry => entry.ref)).toEqual([ref(1)]);
    expect(result.holds.lift.map(entry => entry.ref)).toEqual([ref(2)]);
    expect(result.skipped).toEqual([]);
  });
});

describe("a lift with nothing left to write", () => {
  it("is skipped, and does not spend the cap, when the lane check failed closed", () => {
    const result = plan(
      {
        items: [orphan(9, { pr: null })],
        holds: [
          hold(1, {
            labels: [],
            body: heldBody(TOPIC),
            comments: [POSTED_LIFT],
          }),
        ],
      },
      { ...JIRA, max: 1 }
    );
    expect(result.holds.lift).toEqual([]);
    expect(result.skipped).toContainEqual({
      ref: ref(1),
      reason: "nothing-to-write",
    });
    expect(result.return.map(entry => entry.ref)).toEqual([ref(9)]);
    expect(result.deferred).toEqual([]);
  });
});

describe("a re-lane-only lift", () => {
  it("carries no Decision line, since it decides nothing new", () => {
    const result = plan({
      holds: [
        hold(1, {
          labels: [NEEDED],
          body: heldBody(TOPIC),
          comments: [POSTED_LIFT],
        }),
      ],
    });
    expect(result.holds.lift).toHaveLength(1);
    expect(result.holds.lift[0]?.comments).toEqual([]);
    expect(result.holds.lift[0]?.decision).toBeNull();
  });
});
