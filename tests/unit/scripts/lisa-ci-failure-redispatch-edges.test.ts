/**
 * Edge decisions of the CI-failure re-dispatch planner.
 *
 * Every case starts from a recorded fixture and changes one recorded answer, so
 * what is asserted is the one decision that answer drives. The common thread is
 * that a write needs positive evidence: a superseded head, a fork, a foreign
 * work item, a closed item, or checks still running are all "do nothing", and
 * none of them may move a label.
 * @module tests/unit/scripts/lisa-ci-failure-redispatch-edges
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { trackerContract } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  classifyRequiredChecks,
  planFromFixture,
} from "../../../scripts/lisa-ci-failure-redispatch.mjs";

const REPO = "CodySwannGT/lisa";
const PR_KEY = `pr view 4673 --repo ${REPO} --json number,state,body,headRefOid,isCrossRepository,baseRefName`;
const ISSUE_KEY = `issue view 4672 --repo ${REPO} --json state,labels`;
const COMMENTS_KEY = `api repos/${REPO}/issues/4672/comments --paginate --slurp`;
const CHECKS_KEY = `pr checks 4673 --repo ${REPO} --required --json name,state,bucket`;
const FAILED = "agent-pr-failed.json";
const PASSED = "agent-pr-passed-rerun.json";
const REPLAYED = "agent-pr-failed-replayed.json";
const CLAIMED = "status:in-progress";

const contract = trackerContract({
  tracker: "github",
  github: { org: "CodySwannGT", repo: "lisa" },
});

/**
 * Load a fixture by name for mutation.
 * @param name - Fixture file name.
 * @returns A fresh, mutable copy.
 */
function load(name: string) {
  return JSON.parse(
    readFileSync(`tests/fixtures/ci-failure-redispatch/${name}`, "utf8")
  );
}

/**
 * Replace one recorded gh answer's stdout.
 * @param data - Fixture.
 * @param key - Recorded argv key.
 * @param change - Mutation applied to the recorded stdout.
 * @returns The fixture.
 */
function edit(data: any, key: string, change: (value: any) => void) {
  change(data.gh[key].stdout);
  return data;
}

describe("runs that never reach the work item", () => {
  it("ignores a run whose head was superseded by a newer push", () => {
    const data = edit(load(FAILED), PR_KEY, pr => {
      pr.headRefOid = "a".repeat(40);
    });
    expect(planFromFixture(data, contract)).toMatchObject({
      outcome: "superseded-head",
      actions: [],
    });
  });

  it("treats a fork PR as non-agent even when its body names a work item", () => {
    const data = edit(load(FAILED), PR_KEY, pr => {
      pr.isCrossRepository = true;
    });
    expect(planFromFixture(data, contract).outcome).toBe("non-agent-pr");
  });

  it("ignores a PR that is no longer open", () => {
    const data = edit(load(FAILED), PR_KEY, pr => {
      pr.state = "MERGED";
    });
    expect(planFromFixture(data, contract).outcome).toBe(
      "pull-request-not-open"
    );
  });

  it("treats a work item in another repository as non-agent", () => {
    const data = edit(load(FAILED), PR_KEY, pr => {
      pr.body = "Work-Item: someone/else#12\n";
    });
    expect(planFromFixture(data, contract).outcome).toBe("non-agent-pr");
  });

  it("refuses a run that belongs to another repository", () => {
    const data = load(FAILED);
    data.event.workflow_run.repository.full_name = "someone/else";
    expect(planFromFixture(data, contract).outcome).toBe("foreign-repository");
  });

  it("falls back to a head-SHA search and exits when no open PR carries that head", () => {
    const data = load(FAILED);
    data.event.workflow_run.pull_requests = [];
    data.gh[
      `pr list --repo ${REPO} --state open --search ${data.event.workflow_run.head_sha} --json number,headRefOid`
    ] = { stdout: [] };
    expect(planFromFixture(data, contract)).toMatchObject({
      outcome: "no-pull-request",
      actions: [],
    });
  });

  it("refuses a payload without a concrete head SHA", () => {
    const data = load(FAILED);
    data.event.workflow_run.head_sha = "main";
    expect(() => planFromFixture(data, contract)).toThrow(/head SHA/u);
  });
});

describe("work item and check states that write nothing", () => {
  it("ignores a closed work item", () => {
    const data = edit(load(FAILED), ISSUE_KEY, item => {
      item.state = "CLOSED";
    });
    expect(planFromFixture(data, contract).outcome).toBe("work-item-closed");
  });

  it("waits while a required check is still pending and none has failed", () => {
    const data = edit(load(FAILED), CHECKS_KEY, checks => {
      checks[0].bucket = "pending";
    });
    expect(planFromFixture(data, contract)).toMatchObject({
      outcome: "checks-pending",
      actions: [],
    });
  });

  it("treats a PR with no required checks as nothing to judge", () => {
    const data = load(FAILED);
    data.gh[CHECKS_KEY] = {
      ok: false,
      stdout: "",
      stderr: "no required checks reported on the 'x' branch",
    };
    // The base branch's rulesets require nothing, so nothing can be absent.
    data.gh[`api repos/${REPO}/rules/branches/main --paginate --slurp`] = {
      stdout: [[]],
    };
    expect(planFromFixture(data, contract).outcome).toBe("no-required-checks");
  });
});

describe("classifyRequiredChecks", () => {
  it("fails only on the fail bucket, and a cancelled check neither fails nor passes", () => {
    expect(
      classifyRequiredChecks([
        { name: "a", bucket: "pass" },
        { name: "b", bucket: "cancel" },
      ])
    ).toEqual({ verdict: "pending", failing: [] });
    expect(
      classifyRequiredChecks([
        { name: "a", bucket: "fail" },
        { name: "b", bucket: "pending" },
      ])
    ).toEqual({ verdict: "fail", failing: ["a"] });
    expect(
      classifyRequiredChecks([
        { name: "a", bucket: "pass" },
        { name: "b", bucket: "skipping" },
      ])
    ).toEqual({ verdict: "pass", failing: [] });
  });
});

describe("the clear path", () => {
  it("is idempotent: an already-cleared marker plans nothing", () => {
    const data = edit(load(PASSED), COMMENTS_KEY, pages => {
      pages[1][0].body +=
        "\n\ncleared by run 1\n<!-- [lisa-ci-cleared] run=1 -->";
    });
    expect(planFromFixture(data, contract)).toMatchObject({
      outcome: "already-cleared",
      actions: [],
    });
  });

  it("clears without relabelling when the item was already re-claimed", () => {
    const data = edit(load(PASSED), ISSUE_KEY, item => {
      item.labels = [{ name: CLAIMED }];
    });
    const result = planFromFixture(data, contract);
    expect(result.outcome).toBe("cleared");
    expect(result.actions.map((a: any) => a.kind)).toEqual(["edit-comment"]);
  });

  it("does not restore the claimed lane when a later Lisa marker shows something else moved the item", () => {
    // Posted by the item's author: only a trusted author's marker counts (#4707).
    const data = edit(load(PASSED), COMMENTS_KEY, pages => {
      pages[1].push({
        id: 6700000003,
        user: { login: "CodySwannGT", type: "User" },
        created_at: "2026-11-05T12:00:00Z",
        body: "Held. <!-- [lisa-build-attempt] n=1 outcome=blocked measures=work -->",
      });
    });
    const result = planFromFixture(data, contract);
    expect(result.outcome).toBe("cleared");
    expect(result.actions).toHaveLength(1);
  });

  it("clears a marker left on a superseded head once the PR's newer head passes", () => {
    const data = edit(load(PASSED), COMMENTS_KEY, pages => {
      pages[1][0].body = pages[1][0].body.replace(
        /sha=[0-9a-f]{40}/u,
        `sha=${"c".repeat(40)}`
      );
    });
    const result = planFromFixture(data, contract);
    expect(result.outcome).toBe("clear-and-restore");
    expect(result.actions[0]).toMatchObject({
      kind: "edit-comment",
      commentId: 6700000002,
    });
  });

  it("plans nothing on a passing run with no marker for that head", () => {
    const data = edit(load(PASSED), COMMENTS_KEY, pages => {
      pages.splice(1, 1);
    });
    expect(planFromFixture(data, contract).outcome).toBe("nothing-to-clear");
  });
});

describe("a replayed failure after a partial write", () => {
  it("repairs only the label when the marker is posted, newest, and the item is still claimed", () => {
    const data = edit(load(REPLAYED), ISSUE_KEY, item => {
      item.labels = [{ name: CLAIMED }];
    });
    const result = planFromFixture(data, contract);
    expect(result.outcome).toBe("relabel-repair");
    expect(result.actions).toEqual([
      {
        kind: "relabel",
        item: "CodySwannGT/lisa#4672",
        remove: CLAIMED,
        add: "status:ready",
      },
    ]);
  });

  it("leaves a re-claimed item alone once intake has claimed it after the marker", () => {
    const data = load(REPLAYED);
    data.gh[ISSUE_KEY].stdout.labels = [{ name: CLAIMED }];
    data.gh[COMMENTS_KEY].stdout[0].push({
      id: 6700000009,
      user: { login: "CodySwannGT", type: "User" },
      created_at: "2026-11-05T13:00:00Z",
      body: "[claude-build-intake] Claimed by Claude. Starting build.",
    });
    expect(planFromFixture(data, contract)).toMatchObject({
      outcome: "already-reported",
      actions: [],
    });
  });
});
