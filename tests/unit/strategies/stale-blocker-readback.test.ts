/**
 * The third round of CodeRabbit findings on the stale-link sweep
 * (CodySwannGT/lisa#5065): confirm skips an item closed since the plan and
 * keeps only the planned relationships; `Blocked by` text inside a code fence
 * is literal; "ready to start" follows the queue's container rule; a
 * read-back without its relation list confirms nothing; the comment describes
 * the remaining blockers as the read-back shows them; and one owed comment
 * settles without dropping another for the same item.
 * @module tests/unit/strategies/stale-blocker-readback
 */
import { describe, expect, it } from "vitest";

import { confirmStaleLinkPlan } from "../../../plugins/src/base/scripts/stale-blocker-confirm.mjs";
import {
  parseBlockedByRefs,
  removeBlockedByRefs,
} from "../../../plugins/src/base/scripts/stale-blocker-edges.mjs";
import {
  addPending,
  failedPending,
  settlePending,
} from "../../../plugins/src/base/scripts/stale-blocker-pending.mjs";
import { planStaleLinkSweep } from "../../../plugins/src/base/scripts/stale-blocker-sweep.mjs";
import { verifyStaleLinkRemoval } from "../../../plugins/src/base/scripts/stale-blocker-verify.mjs";
import {
  DONE,
  GH_DONE,
  GH_ROLES,
  IN_PROGRESS,
  JIRA_ROLES,
  REPO,
  githubItem,
  jiraIssue,
  jiraLink,
  linearRelation,
} from "./stale-blocker-fixtures.js";

const NOW = "2026-11-19T12:00:00Z";
const CLOSED = { state: "closed" };
const NO_PLAN = "expected a plan entry";

/**
 * Plan one GitHub item and return its single entry.
 * @param raw - GitHub item
 * @returns The plan entry
 */
function githubPlan(raw: ReturnType<typeof githubItem>) {
  const entry = planStaleLinkSweep({
    tracker: "github",
    items: [raw],
    doneRoles: GH_DONE,
    roles: GH_ROLES,
  }).plans[0];
  if (!entry) throw new Error(NO_PLAN);
  return entry;
}

describe("confirm", () => {
  const raw = githubItem(1, {
    body: "Blocked by #7",
    found: { [`${REPO}#7`]: CLOSED },
  });

  it("skips an item closed since the plan", () => {
    const result = confirmStaleLinkPlan({
      tracker: "github",
      plan: githubPlan(raw),
      fresh: { ...raw, state: "closed" },
      doneRoles: GH_DONE,
      roles: GH_ROLES,
    });
    expect(result).toEqual({
      plan: null,
      skipped: [{ blocker: `${REPO}#7`, reason: "item-closed" }],
    });
  });

  it("never adds a native dependency added since the plan to the same blocker", () => {
    const fresh = {
      ...raw,
      nativeBlockers: [
        {
          id: 901,
          number: 7,
          repository: { full_name: REPO },
          state: "closed",
          labels: [],
        },
      ],
    };
    const result = confirmStaleLinkPlan({
      tracker: "github",
      plan: githubPlan(raw),
      fresh,
      doneRoles: GH_DONE,
      roles: GH_ROLES,
    });
    // The planned body edit is rebuilt; the new native DELETE is not added.
    expect(result.plan).toMatchObject({ actions: [], body: "" });
  });

  it("refuses a fresh read with no relation list", () => {
    const planned = planStaleLinkSweep({
      tracker: "jira",
      items: [jiraIssue("ABC-1", [jiraLink("1", "ABC-9", DONE)])],
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    }).plans[0];
    if (!planned) throw new Error(NO_PLAN);
    expect(() =>
      confirmStaleLinkPlan({
        tracker: "jira",
        plan: planned,
        fresh: { key: "ABC-1", fields: { status: { name: "Ready" } } },
        doneRoles: ["done"],
        roles: JIRA_ROLES,
      })
    ).toThrow(/no blocker relation list/u);
  });
});

describe("Blocked by inside a code fence", () => {
  const body = [
    "Blocked by #3",
    "Example:",
    "```",
    "Blocked by #10",
    "```",
    "~~~md",
    "Blocked by #11",
    "~~~",
  ].join("\n");

  it("is not a blocker", () => {
    expect(parseBlockedByRefs(body, REPO)).toEqual([`${REPO}#3`]);
  });

  it("is never edited when a real line is removed", () => {
    expect(removeBlockedByRefs(body, [`${REPO}#3`, `${REPO}#10`], REPO)).toBe(
      body.split("\n").slice(1).join("\n")
    );
  });
});

describe("ready to start follows the queue's container rule", () => {
  const epic = {
    ...jiraIssue("ABC-1", [jiraLink("1", "ABC-9", DONE)]),
  };
  epic.fields = { ...epic.fields, issuetype: { name: "Epic" } } as never;

  it("never calls a container ready, in the plan or the read-back", () => {
    const planned = planStaleLinkSweep({
      tracker: "jira",
      items: [epic],
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    });
    expect(planned.plans[0]).toMatchObject({
      remainingBlockers: 0,
      becomesClaimable: false,
    });
    expect(planned.report.claimable).toEqual([]);
    const entry = planned.plans[0];
    if (!entry) throw new Error(NO_PLAN);
    const after = { ...epic, fields: { ...epic.fields, issuelinks: [] } };
    expect(
      verifyStaleLinkRemoval({
        tracker: "jira",
        plan: entry,
        after,
        doneRoles: ["done"],
        roles: JIRA_ROLES,
      })
    ).toMatchObject({ confirmed: ["ABC-9"], becameReady: false });
  });
});

describe("verify", () => {
  it("confirms nothing from a Linear read-back without inverseRelations", () => {
    const item = {
      identifier: "ENG-1",
      team: { key: "ENG" },
      state: { name: "Ready" },
      inverseRelations: {
        nodes: [
          linearRelation("rel-1", "ENG-9", { name: "Done", type: "completed" }),
        ],
      },
      comments: [],
    };
    const planned = planStaleLinkSweep({
      tracker: "linear",
      items: [item],
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    }).plans[0];
    if (!planned) throw new Error(NO_PLAN);
    const { inverseRelations: _dropped, ...without } = item;
    const verify = (after: Record<string, unknown>) =>
      verifyStaleLinkRemoval({
        tracker: "linear",
        plan: planned,
        after,
        doneRoles: ["done"],
        roles: JIRA_ROLES,
      });
    expect(() => verify(without)).toThrow(/no blocker relation list/u);
    // A present but empty list is a real "none left".
    expect(
      verify({ ...without, inverseRelations: { nodes: [] } })
    ).toMatchObject({ confirmed: ["ENG-9"], stillPresent: [] });
  });

  it("describes the remaining blockers as the read-back shows them", () => {
    const before = jiraIssue("ABC-1", [
      jiraLink("1", "ABC-7", DONE),
      jiraLink("2", "ABC-8", IN_PROGRESS),
    ]);
    const planned = planStaleLinkSweep({
      tracker: "jira",
      items: [before],
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    }).plans[0];
    if (!planned) throw new Error(NO_PLAN);
    expect(planned.comment).toContain("still waiting on ABC-8");
    // ABC-8 finished between the confirm and the read-back.
    const result = verifyStaleLinkRemoval({
      tracker: "jira",
      plan: planned,
      after: jiraIssue("ABC-1", [jiraLink("2", "ABC-8", DONE)]),
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    });
    expect(result.confirmed).toEqual(["ABC-7"]);
    expect(result.comment).not.toContain("still waiting on ABC-8");
  });
});

describe("settling one owed comment", () => {
  const first = {
    ref: "ABC-1",
    confirmed: ["ABC-9"],
    stillPresent: [],
    comment: "first",
    commentAdf: null,
    becameReady: false,
  };
  const second = { ...first, confirmed: ["ABC-8"], comment: "second" };
  const owed = addPending(addPending([], first, NOW), second, NOW);

  it("keeps the other comment owed for the same item", () => {
    expect(owed).toHaveLength(2);
    expect(settlePending(owed, "ABC-1", ["ABC-9"])).toEqual([owed[1]]);
  });

  it("counts a failure on that comment only", () => {
    const failed = failedPending(owed, "ABC-1", ["ABC-8"]);
    expect(failed.map(one => one.attempts)).toEqual([0, 1]);
  });
});
