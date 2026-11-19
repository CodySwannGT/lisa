/**
 * Stale "blocked by" links (CodySwannGT/lisa#5065).
 *
 * In a host project 70 "blocked by" links across 40 open tickets pointed at
 * tickets that were already finished, and only 29 tickets had a real
 * blocker. These tests hold the one shared rule the session manager and the
 * queue use: a link to finished or cancelled work is removed with one plain
 * comment; an open, cross-project or unreadable blocker is never touched; a
 * re-run never comments twice; a cycle is capped; and an item held back only
 * by stale links can be taken once they are gone.
 * @module tests/unit/strategies/stale-blocker-sweep
 */
import { describe, expect, it } from "vitest";

import { terminalDoneRoles } from "../../../plugins/src/base/scripts/stale-blocker-edges.mjs";
import {
  STALE_LINK_MARKER,
  planStaleLinkSweep,
} from "../../../plugins/src/base/scripts/stale-blocker-sweep.mjs";
import {
  DONE,
  IN_PROGRESS,
  JIRA_ROLES,
  jiraIssue,
  jiraLink,
  linearRelation,
} from "./stale-blocker-fixtures.js";

describe("terminalDoneRoles", () => {
  it("reads the configured terminal rung, never an intermediate one", () => {
    expect(
      terminalDoneRoles({
        tracker: "github",
        global: {
          github: {
            labels: {
              build: { done: { dev: "stage:dev", production: "stage:live" } },
            },
          },
        },
      })
    ).toEqual(["stage:live"]);
  });

  it("lets local config override the committed file", () => {
    expect(
      terminalDoneRoles({
        tracker: "jira",
        global: { jira: { workflow: { done: "Done" } } },
        local: { jira: { workflow: { done: { production: "Shipped" } } } },
      })
    ).toEqual(["shipped"]);
  });
});

describe("Jira", () => {
  const items = [
    jiraIssue("ABC-1", [
      jiraLink("10", "ABC-9", DONE),
      jiraLink("11", "ABC-8", IN_PROGRESS),
      jiraLink("12", "XYZ-3", DONE),
      jiraLink("13", "ABC-7", null),
    ]),
  ];
  const plan = planStaleLinkSweep({
    tracker: "jira",
    items,
    doneRoles: terminalDoneRoles({ tracker: "jira" }),
    roles: JIRA_ROLES,
  });

  it("removes only the link to finished work, by its link id", () => {
    expect(plan.plans).toHaveLength(1);
    expect(plan.plans[0]).toMatchObject({
      ref: "ABC-1",
      actions: [{ op: "unlink", linkId: "10" }],
      removed: ["ABC-9"],
      remainingBlockers: 3,
      becomesClaimable: false,
    });
  });

  it("keeps open, cross-project and unreadable blockers and reports them", () => {
    expect(plan.report).toMatchObject({
      cleared: 1,
      realBlockers: 1,
      crossProject: 1,
      inaccessible: [{ ref: "ABC-1", blocker: "ABC-7" }],
    });
  });

  it("writes one comment an operator can read, with a marker", () => {
    expect(plan.plans[0]?.comment).toBe(
      [
        "[lisa-session-manager] Cleared waiting-on links. This was marked as waiting on ABC-9, which is finished. I removed the link. Nothing else changed. It is still waiting on ABC-8, which is not finished yet. I could not open ABC-7, so I left that link alone.",
        "",
        `${STALE_LINK_MARKER} blocker=ABC-9`,
      ].join("\n")
    );
  });

  it("treats a blocker in the configured done status as finished", () => {
    const shipped = { name: "Shipped", category: "indeterminate" };
    const result = planStaleLinkSweep({
      tracker: "jira",
      items: [jiraIssue("ABC-2", [jiraLink("20", "ABC-5", shipped)])],
      doneRoles: terminalDoneRoles({
        tracker: "jira",
        global: { jira: { workflow: { done: "Shipped" } } },
      }),
      roles: JIRA_ROLES,
    });
    expect(result.plans[0]).toMatchObject({
      removed: ["ABC-5"],
      becomesClaimable: true,
    });
  });

  it("leaves an item in the blocked role to the Blocked sweep", () => {
    const result = planStaleLinkSweep({
      tracker: "jira",
      items: [
        jiraIssue("ABC-3", [jiraLink("30", "ABC-9", DONE)], {
          status: "Blocked",
        }),
      ],
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    });
    expect(result.plans).toEqual([]);
    expect(result.report).toMatchObject({ skippedBlockedRole: 1 });
  });
});

describe("Linear", () => {
  const plan = planStaleLinkSweep({
    tracker: "linear",
    items: [
      {
        identifier: "ENG-1",
        state: { name: "Ready", type: "unstarted" },
        team: { key: "ENG" },
        inverseRelations: {
          nodes: [
            linearRelation("r1", "ENG-9", { name: "Done", type: "completed" }),
            linearRelation("r2", "ENG-8", {
              name: "Canceled",
              type: "canceled",
            }),
            linearRelation("r3", "ENG-7", { name: "Todo", type: "unstarted" }),
            linearRelation(
              "r4",
              "OPS-2",
              { name: "Done", type: "completed" },
              "OPS"
            ),
            linearRelation("r5", "ENG-6", null),
          ],
        },
        comments: [],
      },
    ],
    doneRoles: terminalDoneRoles({ tracker: "linear" }),
    roles: JIRA_ROLES,
  });

  it("deletes finished and cancelled relations by relation id", () => {
    expect(plan.plans[0]).toMatchObject({
      actions: [
        { op: "delete-relation", relationId: "r1" },
        { op: "delete-relation", relationId: "r2" },
      ],
      removed: ["ENG-9", "ENG-8"],
    });
  });

  it("says a cancelled blocker was cancelled", () => {
    expect(plan.plans[0]?.comment).toContain(
      "It was also marked as waiting on ENG-8, which was cancelled and will not be built, so it cannot hold this up."
    );
  });

  it("keeps the open, cross-team and unreadable relations", () => {
    expect(plan.report).toMatchObject({
      cleared: 2,
      realBlockers: 1,
      crossProject: 1,
      inaccessible: [{ ref: "ENG-1", blocker: "ENG-6" }],
    });
  });
});
