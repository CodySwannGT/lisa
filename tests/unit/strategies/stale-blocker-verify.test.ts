/**
 * The CodeRabbit findings on the stale-link sweep (CodySwannGT/lisa#5065):
 * a configured done name counts only in the project that declares it; `and`
 * inside a repository name is not a separator; every comment envelope is
 * read; a marker is posted only for a removal the read-back confirms, with a
 * confirmed removal's comment kept as pending until it posts; and the cycle
 * summary comes from verified results, with the plan's own summary worded as
 * a plan.
 * @module tests/unit/strategies/stale-blocker-verify
 */
import { describe, expect, it } from "vitest";

import { normalizeJiraIssue } from "../../../plugins/src/base/scripts/ready-queue-order.mjs";
import {
  parseBlockedByRefs,
  removeBlockedByRefs,
} from "../../../plugins/src/base/scripts/stale-blocker-edges.mjs";
import {
  addPending,
  failedPending,
  settlePending,
} from "../../../plugins/src/base/scripts/stale-blocker-pending.mjs";
import {
  STALE_LINK_MARKER,
  planStaleLinkSweep,
  summarizeStaleLinkSweep,
  summarizeVerifiedSweep,
} from "../../../plugins/src/base/scripts/stale-blocker-sweep.mjs";
import { verifyStaleLinkRemoval } from "../../../plugins/src/base/scripts/stale-blocker-verify.mjs";
import {
  DONE,
  JIRA_ROLES,
  jiraIssue,
  jiraLink,
} from "./stale-blocker-fixtures.js";

const SHIPPED = { name: "Shipped", category: "indeterminate" };
const NOW = "2026-11-19T12:00:00Z";

describe("a done name counts only in the project that declares it", () => {
  it("keeps another project's same-named status open in the queue", () => {
    const issue = jiraIssue("ABC-1", [
      jiraLink("1", "ABC-9", SHIPPED),
      jiraLink("2", "XYZ-3", SHIPPED),
    ]);
    expect(normalizeJiraIssue(issue, { doneRoles: ["shipped"] })).toMatchObject(
      { openBlockers: 1 }
    );
  });

  it("does not call an item ready while the other project's blocker is open", () => {
    const result = planStaleLinkSweep({
      tracker: "jira",
      items: [
        jiraIssue("ABC-1", [
          jiraLink("1", "ABC-9", SHIPPED),
          jiraLink("2", "XYZ-3", SHIPPED),
        ]),
      ],
      doneRoles: ["shipped"],
      roles: JIRA_ROLES,
    });
    expect(result.plans[0]).toMatchObject({
      removed: ["ABC-9"],
      remainingBlockers: 1,
      becomesClaimable: false,
    });
    expect(result.plans[0]?.comment).toContain(
      "It is still waiting on XYZ-3, which is not finished yet."
    );
  });
});

describe("Blocked by separators", () => {
  const repo = "example-org/demo-repo";

  it("keeps a repository named with 'and' whole", () => {
    expect(parseBlockedByRefs("Blocked by org/and#10", repo)).toEqual([
      "org/and#10",
    ]);
    expect(
      removeBlockedByRefs("Blocked by org/and#10, #3", [`${repo}#3`], repo)
    ).toBe("Blocked by org/and#10");
  });

  it("still splits '#1 and #2' and comma lists", () => {
    expect(parseBlockedByRefs("Blocked by #1 and #2, #3", repo)).toEqual([
      `${repo}#1`,
      `${repo}#2`,
      `${repo}#3`,
    ]);
  });
});

describe("comment envelopes", () => {
  const marked = { body: `${STALE_LINK_MARKER} blocker=ABC-9` };
  const link = [jiraLink("1", "ABC-9", DONE)];

  it.each([
    [
      "Jira fields.comment.comments",
      { fields: { comment: { comments: [marked] } } },
    ],
    ["a Linear-style connection", { comments: { nodes: [marked] } }],
    ["a bare string", { comments: [marked.body] }],
  ])("finds the marker in %s", (_name, extra) => {
    const base = jiraIssue("ABC-1", link);
    const raw = {
      ...base,
      ...extra,
      fields: { ...base.fields, ...(extra as { fields?: object }).fields },
    };
    const result = planStaleLinkSweep({
      tracker: "jira",
      items: [raw],
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    });
    expect(result.plans).toEqual([]);
    expect(result.report.keptByPerson).toEqual([
      { ref: "ABC-1", blocker: "ABC-9" },
    ]);
  });

  it("never throws on an envelope it does not know", () => {
    const raw = { ...jiraIssue("ABC-1", link), comments: { total: 3 } };
    expect(() =>
      planStaleLinkSweep({
        tracker: "jira",
        items: [raw],
        doneRoles: ["done"],
        roles: JIRA_ROLES,
      })
    ).not.toThrow();
  });
});

describe("verifyStaleLinkRemoval", () => {
  const before = jiraIssue("ABC-1", [
    jiraLink("1", "ABC-9", DONE),
    jiraLink("2", "ABC-8", DONE),
  ]);
  const planned = planStaleLinkSweep({
    tracker: "jira",
    items: [before],
    doneRoles: ["done"],
    roles: JIRA_ROLES,
  }).plans[0];
  if (!planned) throw new Error("expected a plan entry");
  const verify = (after: unknown) =>
    verifyStaleLinkRemoval({
      tracker: "jira",
      plan: planned,
      after: after as Record<string, unknown>,
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    });

  it("posts a marker only for the removal that read back as done", () => {
    const result = verify(jiraIssue("ABC-1", [jiraLink("2", "ABC-8", DONE)]));
    expect(result).toMatchObject({
      confirmed: ["ABC-9"],
      stillPresent: ["ABC-8"],
      // ABC-8 is finished, so the link still on the item holds nothing: the
      // item is ready by the same rule the queue uses, though its link stays
      // until the next cycle removes it.
      becameReady: true,
    });
    expect(result.comment).toContain(`${STALE_LINK_MARKER} blocker=ABC-9`);
    expect(result.comment).not.toContain(`${STALE_LINK_MARKER} blocker=ABC-8`);
    expect(result.commentAdf).toMatchObject({ type: "doc", version: 1 });
  });

  it("posts nothing when no deletion happened, so the next plan retries it", () => {
    const result = verify(before);
    expect(result.comment).toBeNull();
    const next = planStaleLinkSweep({
      tracker: "jira",
      items: [before],
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    });
    expect(next.plans[0]?.removed).toEqual(["ABC-9", "ABC-8"]);
    expect(next.report.keptByPerson).toEqual([]);
  });

  it("says the item became ready once every link is gone", () => {
    expect(verify(jiraIssue("ABC-1", []))).toMatchObject({
      confirmed: ["ABC-9", "ABC-8"],
      becameReady: true,
    });
  });

  it("keeps a confirmed removal's comment pending until it posts", () => {
    const result = verify(jiraIssue("ABC-1", [jiraLink("2", "ABC-8", DONE)]));
    const owed = addPending([], result, NOW);
    expect(owed).toEqual([
      {
        ref: "ABC-1",
        removed: ["ABC-9"],
        comment: result.comment,
        commentAdf: result.commentAdf,
        since: NOW,
        attempts: 0,
      },
    ]);
    expect(addPending(owed, result, NOW)).toHaveLength(1);
    expect(failedPending(owed, "ABC-1")[0]?.attempts).toBe(1);
    expect(settlePending(owed, "ABC-1")).toEqual([]);
    expect(addPending([], verify(before), NOW)).toEqual([]);
  });
});

describe("summaries", () => {
  const report = {
    scanned: 3,
    skippedBlockedRole: 0,
    cleared: 3,
    itemsCleared: 2,
    claimable: ["ABC-1"],
    deferred: ["ABC-7"],
    realBlockers: 1,
    itemsWithRealBlockers: 1,
    crossProject: 0,
    inaccessible: [],
    keptByPerson: [],
  };

  it("words the plan as a plan", () => {
    expect(summarizeStaleLinkSweep(report)).toBe(
      "stale links (plan): planned removal of 3 stale blocker links on 2 items; 1 would become ready to start; 1 item left for the next cycle; 1 real blocker remains on 1 item."
    );
  });

  it("reports only what the read-backs confirmed", () => {
    const results = [
      { confirmed: ["ABC-9", "ABC-8"], stillPresent: [], becameReady: true },
      { confirmed: [], stillPresent: ["ABC-5"], becameReady: false },
    ];
    expect(summarizeVerifiedSweep(report, results)).toBe(
      "stale links: cleared 2 stale blocker links on 1 item; 1 now ready to start; 1 planned removal not done (retried next cycle); 1 item left for the next cycle; 1 real blocker remains on 1 item."
    );
  });
});
