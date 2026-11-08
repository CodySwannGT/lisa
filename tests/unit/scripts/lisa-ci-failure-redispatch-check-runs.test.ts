/**
 * The third-party required contexts on the real traffic path
 * (CodySwannGT/lisa#4678).
 *
 * In this repository both CodeRabbit (app `coderabbitai`) and GitGuardian
 * Security Checks (app `gitguardian`) report as CHECK RUNS, never as commit
 * statuses, so a `check_run` event is how a late result actually arrives.
 * These cases pin that path end to end: a late GitGuardian failure
 * re-dispatches the agent, and a late CodeRabbit pass clears the earlier
 * marker and restores the claimed lane — through the planner and through the
 * `--dry-run` CLI under plain node.
 * @module tests/unit/scripts/lisa-ci-failure-redispatch-check-runs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import { trackerContract } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  failureMarker,
  planFromFixture,
} from "../../../scripts/lisa-ci-failure-redispatch.mjs";

const FIXTURES = "tests/fixtures/ci-failure-redispatch";
const SCRIPT = "scripts/lisa-ci-failure-redispatch.mjs";
const SHA = "3db71f89a186d5dbeb78015aa5735fa9d8efda48";
const ITEM = "CodySwannGT/lisa#4672";
const CLAIMED = "status:in-progress";
const READY = "status:ready";
const GITGUARDIAN_FAILED = "check-run-gitguardian-failed.json";
const CODERABBIT_CLEARS = "check-run-coderabbit-passed-clears.json";

const contract = trackerContract({
  tracker: "github",
  github: {
    org: "CodySwannGT",
    repo: "lisa",
    labels: { build: { ready: READY, claimed: CLAIMED } },
  },
});

/**
 * Plan one recorded fixture with no acting run id in the environment.
 * @param name - Fixture file name.
 * @returns The planned outcome.
 */
function plan(name: string) {
  const data = JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
  return planFromFixture(data, contract, {});
}

describe("a late GitGuardian check run failure", () => {
  it("plans one marker naming the PR, head and context, then one claimed-to-ready move", () => {
    const result = plan(GITGUARDIAN_FAILED);
    expect(result.outcome).toBe("redispatch");
    expect(result.runId).toBe(51200000004);
    expect(result.actions.map((a: { kind: string }) => a.kind)).toEqual([
      "comment",
      "relabel",
    ]);
    const body: string = result.actions[0]?.body ?? "";
    expect(body).toContain(
      `pull request #4673 at commit ${SHA}: GitGuardian Security Checks.`
    );
    expect(body).toContain(failureMarker(4673, SHA));
    expect(result.actions[1]).toEqual({
      kind: "relabel",
      item: ITEM,
      remove: CLAIMED,
      add: READY,
    });
  });
});

describe("a late CodeRabbit check run pass", () => {
  it("clears the earlier marker with a numeric run id and restores the claimed lane", () => {
    const result = plan(CODERABBIT_CLEARS);
    expect(result.outcome).toBe("clear-and-restore");
    expect(result.actions[0]?.kind).toBe("edit-comment");
    expect(result.actions[0]?.commentId).toBe(6700000002);
    expect(result.actions[0]?.body).toMatch(
      /<!-- \[lisa-ci-cleared\] run=51200000005 -->/u
    );
    expect(result.actions[1]).toEqual({
      kind: "relabel",
      item: ITEM,
      remove: READY,
      add: CLAIMED,
    });
  });
});

describe("the CLI under plain node", () => {
  it.each([
    [GITGUARDIAN_FAILED, "redispatch"],
    [CODERABBIT_CLEARS, "clear-and-restore"],
  ])("replays %s as %s with two planned writes", (name, outcome) => {
    const result = boundedSpawnSync({
      label: `ci-failure-redispatch dry-run ${name}`,
      command: process.execPath,
      args: [SCRIPT, "--payload", join(FIXTURES, name), "--dry-run"],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dry run");
    const json = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    expect(json.outcome).toBe(outcome);
    expect(json.actions).toHaveLength(2);
  });
});
