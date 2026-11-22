/**
 * Conformance follow-up on the stale "blocked by" clean-up
 * (CodySwannGT/lisa#5065, AC-2): an open blocker in another project keeps
 * its link (the sweep never touches another project) and still holds the
 * item, so the cycle reports it as a real blocker. A finished one holds
 * nothing and is not counted. An item closed since it was listed is never
 * planned, so it never takes a cap slot.
 * @module tests/unit/strategies/stale-blocker-cross-project
 */
import { describe, expect, it } from "vitest";

import {
  planStaleLinkSweep,
  summarizeVerifiedSweep,
} from "../../../plugins/src/base/scripts/stale-blocker-sweep.mjs";
import { verifyStaleLinkRemoval } from "../../../plugins/src/base/scripts/stale-blocker-verify.mjs";
import {
  DONE,
  IN_PROGRESS,
  JIRA_ROLES,
  jiraIssue,
  jiraLink,
  jiraNow,
} from "./stale-blocker-fixtures.js";

const SWEEP = {
  tracker: "jira" as const,
  doneRoles: ["done"],
  roles: JIRA_ROLES,
};

describe("an open blocker in another project", () => {
  const held = jiraIssue("ABC-2", [jiraLink("21", "OTHER-7", IN_PROGRESS)]);
  const finished = jiraIssue("ABC-3", [jiraLink("31", "OTHER-8", DONE)]);
  const swept = planStaleLinkSweep({ ...SWEEP, items: [held, finished] });

  it("keeps the link and plans nothing for it", () => {
    expect(swept.plans).toEqual([]);
    expect(swept.report.crossProject).toBe(2);
  });

  it("is reported as a real blocker, and the finished one is not", () => {
    expect(swept.report).toMatchObject({
      realBlockers: 1,
      itemsWithRealBlockers: 1,
    });
    expect(summarizeVerifiedSweep(swept.report, [])).toContain(
      "1 real blocker remains on 1 item"
    );
  });

  it("still holds an item after a removal beside it is verified", () => {
    const before = jiraIssue("ABC-1", [
      jiraLink("11", "ABC-9", DONE),
      jiraLink("12", "OTHER-7", IN_PROGRESS),
    ]);
    const report = planStaleLinkSweep({ ...SWEEP, items: [before] });
    const [planned] = report.plans;
    if (!planned) throw new Error("expected a plan entry");
    const result = verifyStaleLinkRemoval({
      ...SWEEP,
      plan: planned,
      after: jiraIssue("ABC-1", [jiraLink("12", "OTHER-7", IN_PROGRESS)]),
      blockersNow: jiraNow(["ABC-9"]),
    });
    expect(result.becameReady).toBe(false);
    expect(result.blockersAfter.real).toBe(1);
    expect(summarizeVerifiedSweep(report.report, [result])).toContain(
      "1 real blocker remains on 1 item"
    );
  });
});

describe("an item closed since it was listed", () => {
  it("is never planned, so it takes no cap slot", () => {
    const closed = {
      ...jiraIssue("ABC-4", [jiraLink("41", "ABC-9", DONE)]),
      fields: {
        status: { name: "Done", statusCategory: { key: "done" } },
        issuelinks: [jiraLink("41", "ABC-9", DONE)],
      },
    };
    const open = jiraIssue("ABC-5", [jiraLink("51", "ABC-9", DONE)]);
    const swept = planStaleLinkSweep({
      ...SWEEP,
      items: [closed, open],
      max: 1,
    });
    expect(swept.plans.map(plan => plan.ref)).toEqual(["ABC-5"]);
    expect(swept.deferred).toEqual([]);
  });
});
