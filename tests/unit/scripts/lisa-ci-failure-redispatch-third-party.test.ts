/**
 * The CI-failure re-dispatch decision for third-party required checks
 * (CodySwannGT/lisa#4678).
 *
 * `CodeRabbit` and `GitGuardian Security Checks` are required contexts on
 * `main` that no workflow in this repository produces. They finish on their own
 * schedule, so a `workflow_run` trigger alone misses a late failure and never
 * clears a marker on a late pass. The workflow therefore also listens to
 * `check_run` and `status`; these cases drive the script over recorded payloads
 * of both shapes — a late failure of each, a late pass that clears, a
 * non-required context, a pending status, an Actions-owned check run, and a
 * replay — plus the `--head-sha` mode a manual dry run uses.
 * @module tests/unit/scripts/lisa-ci-failure-redispatch-third-party
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import { trackerContract } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  failureMarker,
  main,
  planFromFixture,
} from "../../../scripts/lisa-ci-failure-redispatch.mjs";

const FIXTURES = "tests/fixtures/ci-failure-redispatch";
const SCRIPT = "scripts/lisa-ci-failure-redispatch.mjs";
const SHA = "3db71f89a186d5dbeb78015aa5735fa9d8efda48";
const REPO = "CodySwannGT/lisa";
const ITEM = `${REPO}#4672`;
const CLAIMED = "status:in-progress";
const READY = "status:ready";
const CODERABBIT_FAILED = "check-run-coderabbit-failed.json";
const GITGUARDIAN_FAILED = "status-gitguardian-failed.json";
const NON_REQUIRED = "check-run-non-required.json";
const PENDING = "status-pending.json";
const ACTIONS_OWNED = "check-run-actions-owned.json";
const MIXED_PENDING = "status-coderabbit-passed-gitguardian-pending.json";
const MIXED_FAILED = "status-coderabbit-passed-gitguardian-failed.json";
const ALREADY_REPORTED = "already-reported";
const HEAD_SHA_FLAG = "--head-sha";
const DRY_RUN = "--dry-run";

const contract = trackerContract({
  tracker: "github",
  github: {
    org: "CodySwannGT",
    repo: "lisa",
    labels: { build: { ready: READY, claimed: CLAIMED } },
  },
});

/**
 * Load one recorded fixture.
 * @param name - Fixture file name.
 * @returns The parsed fixture.
 */
function fixture(name: string) {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

/**
 * Plan a fixture against the Lisa contract, optionally with an environment.
 * @param name - Fixture file name.
 * @param env - Environment the planner may read the acting run id from.
 * @returns The planned outcome.
 */
function plan(name: string, env: Record<string, string> = {}) {
  return planFromFixture(fixture(name), contract, env);
}

/**
 * The planned action at `index`, failing the test when it is absent.
 * @param list - Planned actions.
 * @param index - Position.
 * @returns The action.
 */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`no planned action at ${index}`);
  return value;
}

describe("a late third-party required check failure", () => {
  it.each([
    [CODERABBIT_FAILED, "CodeRabbit", 51200000001],
    [GITGUARDIAN_FAILED, "GitGuardian Security Checks", 38800000001],
  ])(
    "%s plans one marker naming the PR, head and %s, then one claimed-to-ready move",
    (name, context, eventId) => {
      const result = plan(name);
      expect(result.outcome).toBe("redispatch");
      expect(result).toMatchObject({ pr: 4673, sha: SHA, item: ITEM });
      expect(result.runId).toBe(eventId);
      expect(result.actions.map((a: { kind: string }) => a.kind)).toEqual([
        "comment",
        "relabel",
      ]);
      const comment = at(result.actions, 0);
      const relabel = at(result.actions, 1);
      expect(comment.body).toContain("#4673");
      expect(comment.body).toContain(SHA);
      expect(comment.body).toContain(`: ${context}.`);
      expect(comment.body).toContain(failureMarker(4673, SHA));
      expect(relabel).toEqual({
        kind: "relabel",
        item: ITEM,
        remove: CLAIMED,
        add: READY,
      });
    }
  );

  it("attributes the decision to the acting Actions run when GITHUB_RUN_ID is set", () => {
    const result = plan(CODERABBIT_FAILED, {
      GITHUB_RUN_ID: "19000000001",
    });
    expect(result.runId).toBe(19000000001);
  });

  it("falls back to the event id when GITHUB_RUN_ID is not a positive integer", () => {
    const result = plan(CODERABBIT_FAILED, {
      GITHUB_RUN_ID: "nope",
    });
    expect(result.runId).toBe(51200000001);
  });
});

describe("a late pass", () => {
  it("clears the earlier marker with a numeric run id and restores the claimed lane", () => {
    const result = plan("status-coderabbit-passed-clears.json");
    expect(result.outcome).toBe("clear-and-restore");
    expect(result.actions.map((a: { kind: string }) => a.kind)).toEqual([
      "edit-comment",
      "relabel",
    ]);
    const edit = at(result.actions, 0);
    const relabel = at(result.actions, 1);
    expect(edit.commentId).toBe(6700000002);
    expect(edit.body).toMatch(/<!-- \[lisa-ci-cleared\] run=38800000002 -->/u);
    expect(edit.body).not.toContain("undefined");
    expect(relabel).toEqual({
      kind: "relabel",
      item: ITEM,
      remove: READY,
      add: CLAIMED,
    });
  });
});

describe("repeated, partial and mixed results act at most once", () => {
  // A late pass of one context neither clears while another is pending nor
  // posts a second comment while another fails on the same marked head.
  it.each([
    ["check-run-coderabbit-failed-replayed.json", ALREADY_REPORTED],
    [MIXED_PENDING, "checks-pending"],
    [MIXED_FAILED, ALREADY_REPORTED],
  ])("%s plans nothing (%s)", (name, outcome) => {
    const result = plan(name);
    expect(result.outcome).toBe(outcome);
    expect(result.actions).toEqual([]);
  });
});

describe("irrelevant events do nothing", () => {
  it.each([
    [NON_REQUIRED, "not-required-context"],
    [PENDING, "ignored-pending-status"],
    [ACTIONS_OWNED, "ignored-actions-check"],
  ])("%s plans nothing (%s)", (name, outcome) => {
    const result = plan(name);
    expect(result.outcome).toBe(outcome);
    expect(result.actions).toEqual([]);
  });

  it("reads nothing at all for a pending status or an Actions-owned check run", () => {
    // Both fixtures record no gh answers: any read would throw.
    expect(() => plan(PENDING)).not.toThrow();
    expect(() => plan(ACTIONS_OWNED)).not.toThrow();
  });

  it("treats a required-context read that fails as a failed read, not as 'not required'", () => {
    const data = fixture(CODERABBIT_FAILED);
    const key = `api repos/${REPO}/rules/branches/main --paginate --slurp`;
    data.gh[key] = { ok: false, stderr: "HTTP 404" };
    expect(() => planFromFixture(data, contract, {})).toThrow(/HTTP 404/u);
  });
});

/**
 * A live-shaped gh runner answering by argv key.
 * @param answers - Recorded stdout per argv key.
 * @returns The runner and its call log.
 */
function fakeGh(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const gh = (args: string[]) => {
    const key = args.join(" ");
    calls.push(key);
    if (!Object.hasOwn(answers, key))
      return { ok: false, stdout: "", stderr: `unrecorded: ${key}` };
    return { ok: true, stdout: JSON.stringify(answers[key]), stderr: "" };
  };
  return { gh, calls };
}

/**
 * The JSON plan `main` prints after its plain-language lines.
 * @param out - Lines `main` wrote.
 * @returns The parsed plan.
 */
function planJson(out: readonly string[]) {
  return JSON.parse(
    out.slice(out.findIndex(l => l.startsWith("{"))).join("\n")
  );
}

describe("--head-sha mode", () => {
  const recorded = fixture(GITGUARDIAN_FAILED).gh;
  const answers = Object.fromEntries(
    Object.entries(recorded).map(([k, v]) => [k, (v as any).stdout])
  );

  it("resolves the PR from the SHA by search and runs the same pipeline", () => {
    const { gh, calls } = fakeGh(answers);
    const out: string[] = [];
    const code = main([HEAD_SHA_FLAG, SHA, DRY_RUN], {
      gh,
      contract,
      env: { GITHUB_RUN_ID: "19000000002" },
      write: (line: string) => out.push(line),
    });
    expect(code).toBe(0);
    expect(calls[0]).toBe(
      `pr list --repo ${REPO} --state open --search ${SHA} --json number,headRefOid`
    );
    expect(calls.some(c => c.includes("/rules/"))).toBe(false);
    const json = planJson(out);
    expect(json.outcome).toBe("redispatch");
    expect(json.runId).toBe(19000000002);
    expect(out[0]).toContain("run 19000000002");
  });

  it("uses run id 0 when no acting run id is available, never undefined", () => {
    const { gh } = fakeGh(answers);
    const out: string[] = [];
    main([HEAD_SHA_FLAG, SHA, DRY_RUN], {
      gh,
      contract,
      env: {},
      write: (line: string) => out.push(line),
    });
    expect(planJson(out).runId).toBe(0);
  });

  it.each([
    [[HEAD_SHA_FLAG, "abc", DRY_RUN]],
    [[HEAD_SHA_FLAG, SHA.toUpperCase(), DRY_RUN]],
    [[HEAD_SHA_FLAG, SHA, "--run-id", "42", DRY_RUN]],
    [[HEAD_SHA_FLAG, SHA, "--payload", "x.json"]],
    [[DRY_RUN]],
  ])("refuses %j as bad usage", argv => {
    const out: string[] = [];
    const code = main(argv, {
      gh: fakeGh({}).gh,
      contract,
      env: {},
      write: (line: string) => out.push(line),
    });
    expect(code).toBe(2);
    expect(out.join("\n")).toMatch(/--run-id|--head-sha/u);
  });
});

describe("the CLI under plain node", () => {
  it.each([
    [CODERABBIT_FAILED, "redispatch", 2],
    [GITGUARDIAN_FAILED, "redispatch", 2],
    ["status-coderabbit-passed-clears.json", "clear-and-restore", 2],
    ["check-run-coderabbit-failed-replayed.json", ALREADY_REPORTED, 0],
    [MIXED_PENDING, "checks-pending", 0],
    [MIXED_FAILED, ALREADY_REPORTED, 0],
    [NON_REQUIRED, "not-required-context", 0],
    [PENDING, "ignored-pending-status", 0],
    [ACTIONS_OWNED, "ignored-actions-check", 0],
  ])("replays %s as %s with %i planned writes", (name, outcome, writes) => {
    const result = boundedSpawnSync({
      label: `ci-failure-redispatch dry-run ${name}`,
      command: process.execPath,
      args: [SCRIPT, "--payload", join(FIXTURES, name), DRY_RUN],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dry run");
    const json = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    expect(json.outcome).toBe(outcome);
    expect(json.actions).toHaveLength(writes);
  });
});
