/**
 * Stale "blocked by" links on GitHub, and the cross-tracker guarantees
 * (CodySwannGT/lisa#5065): native dependencies and the `Blocked by` body
 * line are both cleared, a re-run never comments twice, a person's re-added
 * link is kept, a cycle is capped, and an item held back only by stale links
 * can be taken once they are gone, by the same rule the queue uses.
 * @module tests/unit/strategies/stale-blocker-sweep-github
 */
import { describe, expect, it } from "vitest";

import {
  normalizeGithubIssue,
  normalizeJiraIssue,
  normalizeLinearIssue,
  orderBacklogQueue,
  orderReadyQueue,
} from "../../../plugins/src/base/scripts/ready-queue-order.mjs";
import {
  parseBlockedByRefs,
  removeBlockedByRefs,
} from "../../../plugins/src/base/scripts/stale-blocker-edges.mjs";
import {
  STALE_LINK_MARKER,
  planStaleLinkSweep,
  summarizeStaleLinkSweep,
} from "../../../plugins/src/base/scripts/stale-blocker-sweep.mjs";
import {
  GH_DONE,
  GH_ROLES,
  IN_PROGRESS,
  REPO,
  applyGithubPlan,
  githubItem,
  jiraIssue,
  jiraLink,
  linearRelation,
} from "./stale-blocker-fixtures.js";

describe("GitHub", () => {
  const body = [
    "## Links",
    "",
    "Blocked by #9, #10",
    "- Blocked by: other-org/other-repo#4",
    "Relates to #3",
  ].join("\n");
  const item = githubItem(1, {
    body,
    native: [
      {
        id: 555,
        number: 20,
        repository: { full_name: REPO },
        state: "open",
        labels: [{ name: "status:done" }],
      },
      {
        id: 556,
        number: 21,
        repository: { full_name: REPO },
        state: "closed",
        state_reason: "not_planned",
      },
    ],
    found: {
      [`${REPO}#9`]: { state: "closed", state_reason: "completed" },
      [`${REPO}#10`]: { state: "open", labels: [] },
      "other-org/other-repo#4": { state: "closed" },
    },
  });
  const plan = planStaleLinkSweep({
    tracker: "github",
    items: [item],
    doneRoles: GH_DONE,
    roles: GH_ROLES,
  });

  it("parses every reference form in a Blocked by line", () => {
    expect(
      parseBlockedByRefs(
        "Blocked by: #1, owner/r#2 and https://github.com/o/x/issues/3",
        REPO
      )
    ).toEqual([`${REPO}#1`, "owner/r#2", "o/x#3"]);
  });

  it("deletes native dependencies and edits just the Blocked by line", () => {
    expect(plan.plans[0]).toMatchObject({
      actions: [
        {
          op: "delete-dependency",
          endpoint: `repos/${REPO}/issues/1/dependencies/blocked_by/555`,
        },
        {
          op: "delete-dependency",
          endpoint: `repos/${REPO}/issues/1/dependencies/blocked_by/556`,
        },
      ],
      removed: [`${REPO}#20`, `${REPO}#21`, `${REPO}#9`],
      body: [
        "## Links",
        "",
        "Blocked by #10",
        "- Blocked by: other-org/other-repo#4",
        "Relates to #3",
      ].join("\n"),
    });
  });

  it("drops a Blocked by line once every ref on it is gone", () => {
    expect(
      removeBlockedByRefs("a\nBlocked by #9\nb", [`${REPO}#9`], REPO)
    ).toBe("a\nb");
  });

  it("counts the open blocker as real and the other repo as cross-project", () => {
    expect(plan.report).toMatchObject({
      cleared: 3,
      realBlockers: 1,
      crossProject: 1,
    });
  });
});

/**
 * A GitHub REST issue as the queue normalizes it; fails the test on null.
 * @param raw - REST issue, optionally with its blockers attached
 * @param doneRoles - Configured terminal done labels
 * @returns Normalized item
 */
function normalized(
  raw: Record<string, unknown>,
  doneRoles: readonly string[] = []
) {
  const item = normalizeGithubIssue(raw, { repo: REPO, doneRoles });
  if (!item) throw new Error("normalizeGithubIssue returned null");
  return item;
}

describe("idempotency, cap and readiness", () => {
  const stale = githubItem(5, {
    body: "Blocked by #9",
    native: [
      {
        id: 700,
        number: 30,
        repository: { full_name: REPO },
        state: "open",
        labels: [{ name: "status:done" }],
      },
    ],
    found: { [`${REPO}#9`]: { state: "closed", state_reason: "completed" } },
  });

  it("plans nothing, and no second comment, on a re-run", () => {
    const first = planStaleLinkSweep({
      tracker: "github",
      items: [stale],
      doneRoles: GH_DONE,
      roles: GH_ROLES,
    });
    const after = applyGithubPlan(stale, first.plans[0]);
    const second = planStaleLinkSweep({
      tracker: "github",
      items: [after],
      doneRoles: GH_DONE,
      roles: GH_ROLES,
    });
    expect(first.plans).toHaveLength(1);
    expect(second.plans).toEqual([]);
    expect(second.report).toMatchObject({ cleared: 0, keptByPerson: [] });
  });

  it("keeps a link a person put back after it was removed", () => {
    const readded = {
      ...stale,
      comments: [{ body: `${STALE_LINK_MARKER} blocker=${REPO}#30` }],
    };
    const result = planStaleLinkSweep({
      tracker: "github",
      items: [readded],
      doneRoles: GH_DONE,
      roles: GH_ROLES,
    });
    expect(result.plans[0]?.removed).toEqual([`${REPO}#9`]);
    expect(result.report).toMatchObject({
      keptByPerson: [{ ref: `${REPO}#5`, blocker: `${REPO}#30` }],
    });
  });

  it("caps the items per cycle, ready items first, and defers the rest", () => {
    const items = [7, 6, 8].map(number =>
      githubItem(number, {
        body: "Blocked by #9",
        labels: number === 8 ? ["status:ready"] : [],
        found: { [`${REPO}#9`]: { state: "closed" } },
      })
    );
    const result = planStaleLinkSweep({
      tracker: "github",
      items,
      doneRoles: GH_DONE,
      roles: GH_ROLES,
      max: 2,
    });
    expect(result.plans.map(plan => plan.ref)).toEqual([
      `${REPO}#8`,
      `${REPO}#6`,
    ]);
    expect(result.deferred).toEqual([`${REPO}#7`]);
    expect(summarizeStaleLinkSweep(result.report)).toBe(
      "stale links: cleared 2 stale blocker links on 2 items; 1 now ready to start; 1 item left for the next cycle; 0 real blockers remain on 0 items."
    );
  });

  it("makes an item held back only by stale links claimable once they are gone", () => {
    const ready = { ...stale, labels: [{ name: GH_ROLES.ready }] };
    const queueRow = (item: Record<string, unknown>) => ({
      ...item,
      title: "Item",
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    });
    const order = (item: Record<string, unknown>) => {
      const row = normalized(queueRow(item), GH_DONE);
      return {
        ready: orderReadyQueue([row]).ordered.map(entry => entry.ref),
        backlog: orderBacklogQueue([row]),
        openBlockers: row.openBlockers,
      };
    };
    // GitHub's own summary counts the open blocker carrying the done label,
    // which is what held the item before the queue used the shared rule.
    const legacy = orderBacklogQueue([
      normalized(
        queueRow({ number: 5, issue_dependencies_summary: { blocked_by: 1 } })
      ),
    ]);
    expect(legacy.excluded).toEqual([
      { ref: `${REPO}#5`, reason: "blocked-by-open-item" },
    ]);
    // With its blockers attached the queue agrees with intake: both are done.
    expect(order(ready).openBlockers).toBe(0);

    const plan = planStaleLinkSweep({
      tracker: "github",
      items: [ready],
      doneRoles: GH_DONE,
      roles: GH_ROLES,
    });
    expect(plan.plans[0]).toMatchObject({
      becomesClaimable: true,
      remainingBlockers: 0,
    });
    // The next queue input is built from the item as the writes leave it.
    const after = applyGithubPlan(ready, plan.plans[0]);
    expect(after.nativeBlockers).toEqual([]);
    expect(parseBlockedByRefs(after.body, REPO)).toEqual([]);
    const next = order(after);
    expect(next.ready).toEqual([`${REPO}#5`]);
    expect(next.backlog.ordered.map(entry => entry.ref)).toEqual([`${REPO}#5`]);
  });

  it("never calls an item with a real blocker left claimable", () => {
    const held = {
      ...stale,
      labels: [{ name: GH_ROLES.ready }],
      body: "Blocked by #9, #10",
      bodyBlockers: {
        [`${REPO}#9`]: { state: "closed", state_reason: "completed" },
        [`${REPO}#10`]: { state: "open", labels: [] },
      },
    };
    const plan = planStaleLinkSweep({
      tracker: "github",
      items: [held],
      doneRoles: GH_DONE,
      roles: GH_ROLES,
    });
    expect(plan.plans[0]).toMatchObject({
      becomesClaimable: false,
      remainingBlockers: 1,
    });
    const after = applyGithubPlan(held, plan.plans[0]);
    const row = normalized({ ...after, title: "Item" }, GH_DONE);
    expect(row.openBlockers).toBe(1);
    expect(orderBacklogQueue([row]).excluded).toEqual([
      { ref: `${REPO}#5`, reason: "blocked-by-open-item" },
    ]);
  });

  it("agrees with the queue on a blocker in the configured done state", () => {
    const doneRoles = ["shipped"];
    const jira = normalizeJiraIssue(
      jiraIssue("ABC-4", [
        jiraLink("40", "ABC-9", { name: "Shipped", category: "indeterminate" }),
      ]),
      { doneRoles }
    );
    const linear = normalizeLinearIssue(
      {
        identifier: "ENG-4",
        inverseRelations: [
          linearRelation("r9", "ENG-9", { name: "Shipped", type: "started" }),
        ],
      },
      { doneRoles }
    );
    expect(jira.openBlockers).toBe(0);
    expect(linear.openBlockers).toBe(0);
    expect(
      normalizeJiraIssue(
        jiraIssue("ABC-5", [jiraLink("41", "ABC-9", IN_PROGRESS)]),
        { doneRoles }
      ).openBlockers
    ).toBe(1);
  });
});
