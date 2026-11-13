/**
 * Hold-sweep edge cases from review (CodySwannGT/lisa#4722): a hold on an
 * item a worker is on, or that is waiting on a person's answer, is never
 * judged; a hold on a Jira or Linear item, whose lane is a state rather than
 * a label, is never moved back to the `ready` role from the `claimed` role;
 * and a partly lifted hold still lists what is left for a person.
 * @module tests/unit/session-manager/orphan-holds-lanes
 */
import { describe, expect, it } from "vitest";

import {
  CREDENTIAL,
  NEEDED,
  READY,
  TOPIC,
  heldBody,
  hold,
  plan,
  ref,
} from "./support/orphan-fixtures.js";

/** A Jira-style lane vocabulary: roles are workflow states. */
const JIRA = {
  rolesAreStates: true,
  readyLabel: "Ready",
  lifecycleLabels: [
    "Ready",
    "In Progress",
    "In Review",
    "Blocked",
    "Done",
    NEEDED,
  ],
  roleLabels: {
    ready: "Ready",
    claimed: "In Progress",
    review: "In Review",
    done: ["Done"],
  },
};

describe("holds on live items", () => {
  it("skips a hold the ledger shows live, so it is never lifted or listed", () => {
    const result = plan(
      { holds: [hold(1), hold(2, { body: heldBody(TOPIC) })] },
      { liveRefs: [ref(1), ref(2)] }
    );
    expect(result.holds.lift).toEqual([]);
    expect(result.holds.keep).toEqual([]);
    expect(result.holds.digest.text).toBe("");
    expect(result.skipped).toEqual([
      { ref: ref(1), reason: "live" },
      { ref: ref(2), reason: "live" },
    ]);
  });
});

describe("holds whose lane is a state", () => {
  it("does not move a claimed Jira-style item to the ready role when lifting", () => {
    const result = plan(
      {
        holds: [
          hold(1, {
            role: "claimed",
            labels: [NEEDED],
            body: heldBody(TOPIC),
          }),
        ],
      },
      JIRA
    );
    expect(result.holds.lift[0]?.actions).toEqual({
      removeHumanNeededLabel: true,
      addReadyLabel: null,
    });
  });

  it.each([
    ["no role", {}],
    ["a done role", { role: "done" }],
    ["a role with no configured value", { role: "triage" }],
  ])(
    "fails closed on a Jira-style hold with %s: lifts it, never re-lanes it",
    (_, extra) => {
      const result = plan(
        {
          holds: [
            hold(1, { labels: [NEEDED], body: heldBody(TOPIC), ...extra }),
          ],
        },
        JIRA
      );
      expect(result.holds.lift[0]?.actions).toEqual({
        removeHumanNeededLabel: true,
        addReadyLabel: null,
      });
    }
  );

  it("still restores the ready label for a GitHub hold in no lane", () => {
    const result = plan({
      holds: [hold(1, { labels: [NEEDED], body: heldBody(TOPIC) })],
    });
    expect(result.holds.lift[0]?.actions.addReadyLabel).toBe(READY);
  });
});

describe("a partly lifted hold", () => {
  it("lifts the agent's reason and lists the person's reason for the operator", () => {
    const body = [
      "Two things are pending.",
      "<!-- [lisa-human-gate] reason=naming-triage -->",
      "<!-- [lisa-human-gate] reason=pricing-tier -->",
    ].join("\n");
    const result = plan(
      { holds: [hold(1, { body })] },
      { humanOnly: ["pricing"] }
    );
    expect(result.holds.lift.map(entry => entry.ref)).toEqual([ref(1)]);
    expect(result.holds.lift[0]?.comments).toHaveLength(1);
    expect(result.holds.keep).toEqual([
      { ref: ref(1), reason: expect.stringContaining("pricing tier") },
    ]);
    expect(result.holds.digest.text).toContain(`${ref(1)}: pricing tier`);
    expect(result.holds.keep[0]?.reason).not.toContain("naming");
  });

  it("lists a fully kept hold once, not as a lift too", () => {
    const result = plan({ holds: [hold(1, { body: heldBody(CREDENTIAL) })] });
    expect(result.holds.lift).toEqual([]);
    expect(result.holds.keep).toHaveLength(1);
  });
});
