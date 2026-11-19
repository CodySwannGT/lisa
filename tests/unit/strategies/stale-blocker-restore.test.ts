/**
 * A blocker that reopens between the confirm and the delete
 * (CodySwannGT/lisa#5065): verify reads each removed blocker again, and a
 * link whose blocker is no longer safe to delete is put back (restore
 * actions), gets no marker, and is reported. Also: `Blocked by` text in
 * inline code is literal.
 * @module tests/unit/strategies/stale-blocker-restore
 */
import { describe, expect, it } from "vitest";

import {
  parseBlockedByRefs,
  removeBlockedByRefs,
} from "../../../plugins/src/base/scripts/stale-blocker-edges.mjs";
import {
  STALE_LINK_MARKER,
  planStaleLinkSweep,
  summarizeVerifiedSweep,
} from "../../../plugins/src/base/scripts/stale-blocker-sweep.mjs";
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
  jiraNow,
  linearRelation,
} from "./stale-blocker-fixtures.js";

const NO_PLAN = "expected a plan entry";

describe("a Jira blocker reopened before the delete", () => {
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
  if (!planned) throw new Error(NO_PLAN);
  const after = jiraIssue("ABC-1", []);

  it("is put back with no marker, and the other removal is confirmed", () => {
    const result = verifyStaleLinkRemoval({
      tracker: "jira",
      plan: planned,
      after,
      blockersNow: {
        ...jiraNow(["ABC-8"]),
        ...jiraNow(["ABC-9"], IN_PROGRESS),
      },
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    });
    expect(result).toMatchObject({
      confirmed: ["ABC-8"],
      restored: [{ blockerRef: "ABC-9", verdict: "open" }],
      restore: [{ op: "link", from: "ABC-9", to: "ABC-1", type: "Blocks" }],
      becameReady: false,
    });
    expect(result.comment).toContain(`${STALE_LINK_MARKER} blocker=ABC-8`);
    expect(result.comment).not.toContain(`${STALE_LINK_MARKER} blocker=ABC-9`);
  });

  it("is put back when it cannot be read again", () => {
    const result = verifyStaleLinkRemoval({
      tracker: "jira",
      plan: planned,
      after,
      blockersNow: jiraNow(["ABC-8"]),
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    });
    expect(result.restored).toEqual([
      { blockerRef: "ABC-9", verdict: "inaccessible" },
    ]);
  });

  it("refuses a verify that did not read the blockers again", () => {
    expect(() =>
      verifyStaleLinkRemoval({
        tracker: "jira",
        plan: planned,
        after,
        doneRoles: ["done"],
        roles: JIRA_ROLES,
      } as unknown as Parameters<typeof verifyStaleLinkRemoval>[0])
    ).toThrow(/blockersNow/u);
  });

  it("is counted as put back, not as cleared", () => {
    const result = verifyStaleLinkRemoval({
      tracker: "jira",
      plan: planned,
      after,
      blockersNow: {
        ...jiraNow(["ABC-8"]),
        ...jiraNow(["ABC-9"], IN_PROGRESS),
      },
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    });
    const report = planStaleLinkSweep({
      tracker: "jira",
      items: [before],
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    }).report;
    expect(summarizeVerifiedSweep(report, [result])).toMatch(
      /^stale links: cleared 1 stale blocker link on 1 item; put back 1 link whose blocker reopened; 0 real blockers/u
    );
  });
});

describe("restore actions for the other trackers", () => {
  it("recreates a Linear blocks relation", () => {
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
    const result = verifyStaleLinkRemoval({
      tracker: "linear",
      plan: planned,
      after: { ...item, inverseRelations: { nodes: [] } },
      blockersNow: {
        "ENG-9": {
          identifier: "ENG-9",
          state: { name: "In Progress", type: "started" },
          team: { key: "ENG" },
        },
      },
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    });
    expect(result.restore).toEqual([
      {
        op: "create-relation",
        issue: "ENG-9",
        relatedIssue: "ENG-1",
        type: "blocks",
      },
    ]);
  });

  it("re-adds a GitHub dependency and the Blocked by line", () => {
    const raw = githubItem(1, {
      body: "Context.\n\nBlocked by #7",
      native: [
        {
          id: 801,
          number: 20,
          repository: { full_name: REPO },
          state: "closed",
          labels: [],
        },
      ],
      found: { [`${REPO}#7`]: { state: "closed" } },
    });
    const planned = planStaleLinkSweep({
      tracker: "github",
      items: [raw],
      doneRoles: GH_DONE,
      roles: GH_ROLES,
    }).plans[0];
    if (!planned) throw new Error(NO_PLAN);
    const reopened = { state: "open", labels: [] };
    const result = verifyStaleLinkRemoval({
      tracker: "github",
      plan: planned,
      after: { ...raw, body: "Context.", nativeBlockers: [], bodyBlockers: {} },
      blockersNow: { [`${REPO}#20`]: reopened, [`${REPO}#7`]: reopened },
      doneRoles: GH_DONE,
      roles: GH_ROLES,
    });
    expect(result.confirmed).toEqual([]);
    expect(result.comment).toBeNull();
    expect(result.restore).toEqual([
      {
        op: "add-dependency",
        endpoint: `repos/${REPO}/issues/1/dependencies/blocked_by`,
        issueId: "801",
      },
      { op: "body", body: "Context.\n\nBlocked by #7" },
    ]);
  });
});

describe("Blocked by in inline code", () => {
  const body = "Blocked by #3, `#10`\nUse `Blocked by #11` to declare one.";

  it("is not a blocker", () => {
    expect(parseBlockedByRefs(body, REPO)).toEqual([`${REPO}#3`]);
  });

  it("survives the removal of the real ref beside it", () => {
    expect(removeBlockedByRefs(body, [`${REPO}#3`], REPO)).toBe(
      "Blocked by `#10`\nUse `Blocked by #11` to declare one."
    );
  });
});
