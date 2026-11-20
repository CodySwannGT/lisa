/**
 * Fourth CodeRabbit round on the stale "blocked by" clean-up
 * (CodySwannGT/lisa#5065), the pure rule:
 *
 * - a restored `Blocked by` line goes where it parses, never inside a code
 *   fence left open at the end of the body;
 * - a planned removal whose delete failed and whose blocker then reopened
 *   holds the item, so it does not "become ready";
 * - the cycle summary counts blockers as the read-backs show them;
 * - a comment whose marker is already live is never owed again;
 * - an item whose own blocker list could not be read plans nothing and is
 *   reported, while every other item is still planned.
 * @module tests/unit/strategies/stale-blocker-owed
 */
import { describe, expect, it } from "vitest";

import { parseBlockedByRefs } from "../../../plugins/src/base/scripts/stale-blocker-edges.mjs";
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
} from "./stale-blocker-fixtures.js";

const NO_PLAN = "expected a plan entry";
const FENCED_TAIL = "Context.\n\n```sh\nnpm run build";

describe("a Blocked by line put back on a body ending in an open fence", () => {
  const raw = githubItem(1, {
    body: `Blocked by #7\n\n${FENCED_TAIL}`,
    found: { [`${REPO}#7`]: { state: "closed" } },
  });
  const planned = planStaleLinkSweep({
    tracker: "github",
    items: [raw],
    doneRoles: GH_DONE,
    roles: GH_ROLES,
  }).plans[0];

  it("is placed where it parses as a blocker again", () => {
    if (!planned) throw new Error(NO_PLAN);
    const result = verifyStaleLinkRemoval({
      tracker: "github",
      plan: planned,
      after: { ...raw, body: FENCED_TAIL, bodyBlockers: {} },
      blockersNow: { [`${REPO}#7`]: { state: "open", labels: [] } },
      doneRoles: GH_DONE,
      roles: GH_ROLES,
    });
    const body = (result.restore as { op: string; body?: string }[]).find(
      action => action.op === "body"
    )?.body;
    expect(typeof body).toBe("string");
    expect(parseBlockedByRefs(String(body), REPO)).toEqual([`${REPO}#7`]);
    // The existing body is kept as it was.
    expect(String(body).endsWith(FENCED_TAIL)).toBe(true);
  });
});

describe("a failed delete whose blocker reopened after the read-back", () => {
  const before = jiraIssue("ABC-1", [
    jiraLink("1", "ABC-9", DONE),
    jiraLink("2", "ABC-8", DONE),
  ]);
  const swept = planStaleLinkSweep({
    tracker: "jira",
    items: [before],
    doneRoles: ["done"],
    roles: JIRA_ROLES,
  });
  const planned = swept.plans[0];
  if (!planned) throw new Error(NO_PLAN);
  // ABC-9's delete happened; ABC-8's did not, and the read-back still shows
  // it done. Read again afterwards, ABC-8 has reopened.
  const result = verifyStaleLinkRemoval({
    tracker: "jira",
    plan: planned,
    after: jiraIssue("ABC-1", [jiraLink("2", "ABC-8", DONE)]),
    blockersNow: {
      ...jiraNow(["ABC-9"]),
      ...jiraNow(["ABC-8"], IN_PROGRESS),
    },
    doneRoles: ["done"],
    roles: JIRA_ROLES,
  });

  it("holds the item instead of reporting it ready", () => {
    expect(result.confirmed).toEqual(["ABC-9"]);
    expect(result.stillPresent).toEqual(["ABC-8"]);
    expect(result.becameReady).toBe(false);
    expect(result.blockersAfter).toEqual({ real: 1, inaccessible: [] });
  });

  it("is counted as a real blocker in the cycle summary", () => {
    expect(swept.report.realBlockers).toBe(0);
    const summary = summarizeVerifiedSweep(swept.report, [result]);
    expect(summary).toContain("1 real blocker remains on 1 item");
    expect(summary).not.toContain("now ready");
  });
});

describe("a removal whose comment is already posted", () => {
  it("is not owed a second comment", () => {
    const before = jiraIssue("ABC-1", [jiraLink("1", "ABC-9", DONE)]);
    const planned = planStaleLinkSweep({
      tracker: "jira",
      items: [before],
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    }).plans[0];
    if (!planned) throw new Error(NO_PLAN);
    const result = verifyStaleLinkRemoval({
      tracker: "jira",
      plan: planned,
      after: jiraIssue("ABC-1", [], {
        comments: [{ body: `Cleared. ${STALE_LINK_MARKER} blocker=ABC-9` }],
      }),
      blockersNow: jiraNow(["ABC-9"]),
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    });
    expect(result.confirmed).toEqual(["ABC-9"]);
    expect(result.comment).toBeNull();
    expect(result.commentAdf).toBeNull();
  });
});

describe("an item whose dependency list could not be read", () => {
  const unread = {
    ...githubItem(1, {
      body: "Blocked by #7",
      found: { [`${REPO}#7`]: { state: "closed" } },
    }),
    nativeBlockers: null,
  };
  const other = githubItem(2, {
    body: "Blocked by #7",
    found: { [`${REPO}#7`]: { state: "closed" } },
  });
  const swept = planStaleLinkSweep({
    tracker: "github",
    items: [unread, other],
    doneRoles: GH_DONE,
    roles: GH_ROLES,
  });

  it("plans nothing for it and still plans the others", () => {
    expect(swept.plans.map(plan => plan.ref)).toEqual([`${REPO}#2`]);
  });

  it("is reported as unreadable", () => {
    expect(swept.report.inaccessible).toContainEqual({
      ref: `${REPO}#1`,
      blocker: "its blocker list",
    });
  });
});
