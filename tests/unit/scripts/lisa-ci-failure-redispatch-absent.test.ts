/**
 * Required checks that never ran are pending, not passed
 * (CodySwannGT/lisa#4711).
 *
 * `gh pr checks --required` lists only checks that have REPORTED. A required
 * check that never ran — CI not dispatched because the PR conflicts, or not
 * started yet — is simply missing from those rows. Judged on the rows alone,
 * a late third-party pass looked like "every required check passed" and
 * cleared an uncleared `[lisa-ci-failed]` marker while CI never ran. These
 * cases hold the clear path to the base branch's ruleset: a required context
 * with no row is pending, in every entry mode, while a reported failure still
 * re-dispatches.
 * @module tests/unit/scripts/lisa-ci-failure-redispatch-absent
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import { trackerContract } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
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
const RULES_MAIN = `api repos/${REPO}/rules/branches/main --paginate --slurp`;
const PR_KEY = `pr view 4673 --repo ${REPO} --json number,state,body,headRefOid,isCrossRepository,baseRefName`;
const CHECKS_KEY = `pr checks 4673 --repo ${REPO} --required --json name,state,bucket`;
const PASSED_ABSENT = "check-run-passed-absent-required-contexts.json";
const FAILED_ABSENT = "check-run-failed-absent-required-contexts.json";
const PASSED_CLEARS = "check-run-coderabbit-passed-clears.json";
const RERUN_PASSED = "agent-pr-passed-rerun.json";
const PENDING = "checks-pending";
const CLEAR_AND_RESTORE = "clear-and-restore";
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
 * Load one recorded fixture as a fresh, mutable copy.
 * @param name - Fixture file name.
 * @returns The parsed fixture.
 */
function fixture(name: string) {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

/**
 * A fixture whose recorded base-branch ruleset is the full 15-context one from
 * the absent-context fixture, so the rows it reports leave contexts unreported.
 * @param name - Fixture file name.
 * @returns The fixture.
 */
function withFullRuleset(name: string) {
  const data = fixture(name);
  data.gh[RULES_MAIN] = fixture(PASSED_ABSENT).gh[RULES_MAIN];
  return data;
}

/**
 * A live-shaped gh runner answering by argv key from a fixture's recordings.
 * @param recorded - The fixture's `gh` recordings.
 * @param extra - Further stdout answers keyed by argv.
 * @returns The runner and its call log.
 */
function fakeGh(recorded: Record<string, any>, extra: Record<string, unknown>) {
  const answers: Record<string, unknown> = {
    ...Object.fromEntries(
      Object.entries(recorded).map(([k, v]) => [k, v.stdout])
    ),
    ...extra,
  };
  const calls: string[] = [];
  const gh = (args: string[]) => {
    const key = args.join(" ");
    calls.push(key);
    if (!Object.hasOwn(answers, key))
      return { ok: false, stdout: "", stderr: `unrecorded: ${key}` };
    const stdout = answers[key];
    const text = typeof stdout === "string" ? stdout : JSON.stringify(stdout);
    return { ok: true, stdout: text, stderr: "" };
  };
  return { gh, calls };
}

/**
 * Run `main` in dry-run mode and return the JSON plan it printed.
 * @param argv - Arguments before `--dry-run`.
 * @param gh - Runner.
 * @returns The parsed plan.
 */
function runMain(argv: string[], gh: (args: string[]) => object) {
  const out: string[] = [];
  const code = main([...argv, DRY_RUN], {
    gh,
    contract,
    env: { GITHUB_RUN_ID: "19000000003" },
    write: (line: string) => out.push(line),
  });
  expect(code).toBe(0);
  return JSON.parse(
    out.slice(out.findIndex(l => l.startsWith("{"))).join("\n")
  );
}

describe("a late pass while required contexts never reported", () => {
  it("is checks-pending with no writes, naming how many contexts have not reported", () => {
    const result = planFromFixture(fixture(PASSED_ABSENT), contract, {});
    expect(result).toMatchObject({ outcome: PENDING, item: ITEM, actions: [] });
    expect(result.reason).toMatch(/13 of 15 required checks? .*not reported/u);
    expect(result.reason).toContain("🔍 Quality Checks / 🧹 Lint");
  });

  it("holds a workflow_run pass the same way", () => {
    const result = planFromFixture(withFullRuleset(RERUN_PASSED), contract, {});
    expect(result).toMatchObject({ outcome: PENDING, actions: [] });
  });

  it("holds a status pass the same way", () => {
    const data = withFullRuleset("status-coderabbit-passed-clears.json");
    const result = planFromFixture(data, contract, {});
    expect(result).toMatchObject({ outcome: PENDING, actions: [] });
  });

  it("reads the ruleset of the PR's base branch, not the default branch", () => {
    const data = fixture(RERUN_PASSED);
    data.gh[PR_KEY].stdout.baseRefName = "dev";
    data.gh[`api repos/${REPO}/rules/branches/dev --paginate --slurp`] =
      fixture(PASSED_ABSENT).gh[RULES_MAIN];
    expect(planFromFixture(data, contract, {}).outcome).toBe(PENDING);
  });
});

describe("a head where no required check has reported at all", () => {
  /**
   * A workflow_run pass fixture whose `gh pr checks --required` read answers
   * "no required checks reported" — gh's answer before anything has reported.
   * @param rules - Recorded base-branch ruleset answer.
   * @returns The fixture.
   */
  function nothingReported(rules: unknown) {
    const data = fixture(RERUN_PASSED);
    data.gh[CHECKS_KEY] = {
      ok: false,
      stdout: "",
      stderr: "no required checks reported on the 'codex/x' branch",
    };
    data.gh[RULES_MAIN] = rules;
    return data;
  }

  it("is checks-pending when the ruleset requires contexts", () => {
    const rules = fixture(PASSED_ABSENT).gh[RULES_MAIN];
    const result = planFromFixture(nothingReported(rules), contract, {});
    expect(result).toMatchObject({ outcome: PENDING, actions: [] });
    expect(result.reason).toMatch(/^15 of 15 required checks/u);
  });

  it("is no-required-checks only when the ruleset requires none", () => {
    const rules = { stdout: [[{ type: "deletion" }]] };
    const result = planFromFixture(nothingReported(rules), contract, {});
    expect(result).toMatchObject({
      outcome: "no-required-checks",
      actions: [],
    });
  });
});

describe("a PR read that carries no base branch", () => {
  it("refuses to judge a pass rather than read an unnamed ruleset", () => {
    const data = fixture(RERUN_PASSED);
    delete data.gh[PR_KEY].stdout.baseRefName;
    expect(() => planFromFixture(data, contract, {})).toThrow(
      /no base branch/u
    );
  });

  it("makes main exit 1, writing nothing", () => {
    const recorded = fixture(RERUN_PASSED).gh;
    delete recorded[PR_KEY].stdout.baseRefName;
    const { gh, calls } = fakeGh(recorded, {
      [`pr list --repo ${REPO} --state open --search ${SHA} --json number,headRefOid`]:
        [{ number: 4673, headRefOid: SHA }],
    });
    const out: string[] = [];
    const code = main(["--head-sha", SHA, DRY_RUN], {
      gh,
      contract,
      env: { GITHUB_RUN_ID: "19000000004" },
      write: (line: string) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/no base branch/u);
    expect(calls.some(c => c.startsWith("issue edit"))).toBe(false);
  });
});

describe("outcomes that stay as they were", () => {
  it("still clears and restores when every required context reported", () => {
    const result = planFromFixture(fixture(PASSED_CLEARS), contract, {});
    expect(result.outcome).toBe(CLEAR_AND_RESTORE);
    expect(result.actions.map((a: { kind: string }) => a.kind)).toEqual([
      "edit-comment",
      "relabel",
    ]);
  });

  it("keeps the clear path when the ruleset requires no contexts at all", () => {
    const data = fixture(RERUN_PASSED);
    data.gh[RULES_MAIN] = { stdout: [[{ type: "deletion" }]] };
    expect(planFromFixture(data, contract, {}).outcome).toBe(CLEAR_AND_RESTORE);
  });

  it("still re-dispatches a reported failure while other contexts are absent", () => {
    const result = planFromFixture(fixture(FAILED_ABSENT), contract, {});
    expect(result.outcome).toBe("redispatch");
    expect(result.actions).toHaveLength(2);
    const [comment, relabel] = result.actions;
    expect(comment).toMatchObject({ kind: "comment", item: ITEM });
    expect(comment?.body).toContain("GitGuardian Security Checks");
    expect(relabel).toEqual({
      kind: "relabel",
      item: ITEM,
      remove: CLAIMED,
      add: READY,
    });
  });
});

describe("manual entry modes", () => {
  const recorded = fixture(PASSED_ABSENT).gh;

  it("--head-sha holds an absent required context as pending", () => {
    const { gh, calls } = fakeGh(recorded, {
      [`pr list --repo ${REPO} --state open --search ${SHA} --json number,headRefOid`]:
        [{ number: 4673, headRefOid: SHA }],
    });
    expect(runMain(["--head-sha", SHA], gh).outcome).toBe(PENDING);
    expect(calls).toContain(RULES_MAIN);
  });

  it("--run-id holds an absent required context as pending", () => {
    const { gh } = fakeGh(recorded, {
      [`api repos/${REPO}/actions/runs/42`]: {
        id: 42,
        head_sha: SHA,
        pull_requests: [{ number: 4673 }],
        repository: { full_name: REPO },
      },
    });
    expect(runMain(["--run-id", "42"], gh).outcome).toBe(PENDING);
  });
});

describe("the CLI under plain node", () => {
  it.each([
    [PASSED_ABSENT, PENDING, 0],
    [PASSED_CLEARS, CLEAR_AND_RESTORE, 2],
    [FAILED_ABSENT, "redispatch", 2],
  ])("replays %s as %s with %i planned writes", (name, outcome, writes) => {
    const result = boundedSpawnSync({
      label: `ci-failure-redispatch dry-run ${name}`,
      command: process.execPath,
      args: [SCRIPT, "--payload", join(FIXTURES, name), DRY_RUN],
    });
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    expect(json.outcome).toBe(outcome);
    expect(json.actions).toHaveLength(writes);
  });
});
