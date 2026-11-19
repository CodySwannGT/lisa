/**
 * A blocker in an intermediate done rung (CodySwannGT/lisa#5065): its code
 * has merged to a non-production environment (`status:on-dev`, `On Stg`), and
 * dependents are meant to proceed. So it holds nothing in any tracker's queue,
 * exactly as GitHub build intake treated `status:on-dev` before this change.
 * But it is not finished, so the stale-link sweep never deletes its link:
 * "holds the item" and "safe to delete" are separate answers.
 * @module tests/unit/strategies/stale-blocker-landed
 */
import { describe, expect, it } from "vitest";

import {
  normalizeGithubIssue,
  normalizeJiraIssue,
  normalizeLinearIssue,
} from "../../../plugins/src/base/scripts/ready-queue-order.mjs";
import {
  blockerResolution,
  landedDoneRoles,
  terminalDoneRoles,
} from "../../../plugins/src/base/scripts/stale-blocker-edges.mjs";
import { planStaleLinkSweep } from "../../../plugins/src/base/scripts/stale-blocker-sweep.mjs";
import {
  DONE,
  GH_DONE,
  GH_ROLES,
  JIRA_ROLES,
  REPO,
  githubItem,
  jiraIssue,
  jiraLink,
  linearRelation,
} from "./stale-blocker-fixtures.js";

const ON_DEV = "status:on-dev";
const JIRA_ON_DEV = { name: "On Dev", category: "indeterminate" };
const LINEAR_ON_DEV = { name: "On Dev", type: "started" };
const GH_LANDED = landedDoneRoles({ tracker: "github" });
const JIRA_DONE = terminalDoneRoles({ tracker: "jira" });
const JIRA_LANDED = landedDoneRoles({ tracker: "jira" });

/**
 * A native GitHub blocker in this repository.
 * @param id - Dependency id
 * @param number - Blocker number
 * @param label - Its status label
 * @returns Raw blocker
 */
const nativeBlocker = (id: number, number: number, label: string) => ({
  id,
  number,
  repository: { full_name: REPO },
  state: "open",
  labels: [{ name: label }],
});

describe("landedDoneRoles", () => {
  it("is every configured done rung except the terminal one", () => {
    expect(GH_LANDED).toEqual(["status:on-dev", "status:on-stg"]);
    expect(JIRA_LANDED).toEqual(["on dev", "on stg"]);
    expect(
      landedDoneRoles({
        tracker: "github",
        global: {
          github: {
            labels: {
              build: { done: { dev: "stage:dev", production: "stage:live" } },
            },
          },
        },
      })
    ).toEqual(["stage:dev", "status:on-stg"]);
    expect(
      landedDoneRoles({
        tracker: "jira",
        local: { jira: { workflow: { done: "Done" } } },
      })
    ).toEqual(["on dev", "on stg"]);
  });

  it("counts only in the project that declares it", () => {
    const edge = { names: ["on dev"], project: "XYZ" };
    expect(blockerResolution(edge, JIRA_DONE, "ABC", JIRA_LANDED)).toBe("open");
    expect(
      blockerResolution(
        { ...edge, project: "ABC" },
        JIRA_DONE,
        "ABC",
        JIRA_LANDED
      )
    ).toBe("landed");
  });
});

describe("an on-dev blocker does not hold the item", () => {
  it("in the GitHub queue", () => {
    const issue = {
      ...githubItem(1, { native: [nativeBlocker(801, 20, ON_DEV)] }),
      title: "t",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    expect(
      normalizeGithubIssue(issue, {
        repo: REPO,
        doneRoles: GH_DONE,
        landedRoles: GH_LANDED,
      })
    ).toMatchObject({ openBlockers: 0 });
  });

  it("in the Jira queue", () => {
    const issue = jiraIssue("ABC-1", [jiraLink("1", "ABC-9", JIRA_ON_DEV)]);
    expect(
      normalizeJiraIssue(issue, {
        doneRoles: JIRA_DONE,
        landedRoles: JIRA_LANDED,
      })
    ).toMatchObject({ openBlockers: 0 });
  });

  it("in the Linear queue", () => {
    const issue = {
      identifier: "ENG-1",
      team: { key: "ENG" },
      state: { name: "Ready" },
      inverseRelations: {
        nodes: [linearRelation("rel-1", "ENG-9", LINEAR_ON_DEV)],
      },
    };
    expect(
      normalizeLinearIssue(issue, {
        doneRoles: terminalDoneRoles({ tracker: "linear" }),
        landedRoles: landedDoneRoles({ tracker: "linear" }),
      })
    ).toMatchObject({ openBlockers: 0 });
  });

  it("while a blocker in the ready role still holds it", () => {
    const issue = jiraIssue("ABC-1", [
      jiraLink("1", "ABC-9", { name: "Ready", category: "new" }),
    ]);
    expect(
      normalizeJiraIssue(issue, {
        doneRoles: JIRA_DONE,
        landedRoles: JIRA_LANDED,
      })
    ).toMatchObject({ openBlockers: 1 });
  });
});

describe("the sweep keeps a link to an on-dev blocker", () => {
  it("removes only the finished blocker and calls the item ready", () => {
    const result = planStaleLinkSweep({
      tracker: "github",
      items: [
        githubItem(1, {
          native: [
            nativeBlocker(801, 20, "status:done"),
            nativeBlocker(802, 21, ON_DEV),
          ],
        }),
      ],
      doneRoles: GH_DONE,
      landedRoles: GH_LANDED,
      roles: GH_ROLES,
    });
    expect(result.plans[0]).toMatchObject({
      removed: [`${REPO}#20`],
      actions: [
        {
          op: "delete-dependency",
          endpoint: `repos/${REPO}/issues/1/dependencies/blocked_by/801`,
        },
      ],
      remainingBlockers: 0,
      becomesClaimable: true,
    });
    expect(result.plans[0]?.comment).not.toContain(`${REPO}#21`);
    expect(result.report).toMatchObject({ realBlockers: 0, landed: 1 });
  });

  it("plans nothing when the only link is to an on-dev blocker", () => {
    const result = planStaleLinkSweep({
      tracker: "jira",
      items: [jiraIssue("ABC-1", [jiraLink("1", "ABC-9", JIRA_ON_DEV)])],
      doneRoles: JIRA_DONE,
      landedRoles: JIRA_LANDED,
      roles: JIRA_ROLES,
    });
    expect(result.plans).toEqual([]);
    expect(result.report).toMatchObject({ realBlockers: 0, landed: 1 });
  });

  it("still removes a terminal-done link next to it", () => {
    const result = planStaleLinkSweep({
      tracker: "jira",
      items: [
        jiraIssue("ABC-1", [
          jiraLink("1", "ABC-9", JIRA_ON_DEV),
          jiraLink("2", "ABC-8", DONE),
        ]),
      ],
      doneRoles: JIRA_DONE,
      landedRoles: JIRA_LANDED,
      roles: JIRA_ROLES,
    });
    expect(result.plans[0]).toMatchObject({
      removed: ["ABC-8"],
      actions: [{ op: "unlink", linkId: "2" }],
      becomesClaimable: true,
    });
  });
});
