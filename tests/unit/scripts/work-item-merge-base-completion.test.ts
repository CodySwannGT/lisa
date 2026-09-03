/**
 * Which branch a merged pull request landed on decides which lifecycle role it
 * earned.
 *
 * ## The defect
 *
 * The GitHub completion writer's evidence test was "is there a merged pull
 * request in this repository referencing this item". It never read the pull
 * request's base branch. On a stacked-pull-request workflow — where every pull
 * request targets an integration branch and only the final one targets the
 * deploy branch — that stamped the PRODUCTION terminal role on every item in
 * the batch and closed it, at the moment its pull request landed on the
 * stacking branch. Nothing had reached the deploy branch and nothing had
 * deployed.
 *
 * Observed twice on one day in this repository. The second instance is the
 * sharper one: a falsely completed item is no longer an OPEN work item, so the
 * push gate that requires an open work item then REFUSED the next commit on
 * that same ticket. The false completion did not merely corrupt the record, it
 * blocked further work.
 *
 * ## Why these cases bite
 *
 * The first case below drives the writer with a merged pull request whose base
 * is an integration branch and asserts the terminal role is NOT written. Run
 * against the writer as it stood before this fix it fails, because that writer
 * writes the terminal role unconditionally.
 *
 * The second case is the negative control and is not optional: a writer that
 * simply stopped completing anything would satisfy the first case and be
 * strictly worse than the defect. A merge into the production branch must
 * still complete and close.
 * @module tests/unit/scripts/work-item-merge-base-completion
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  deployBranchEnvironments,
  mergedBaseDecision,
} from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  createFixture,
  issueJson,
  Fixture,
  REF,
} from "../../support/work-item-cli.js";

const REF_FLAG = "--ref";
const CLAIMED = "status:in-progress";
const TERMINAL = "status:done";
const ON_STG = "status:on-stg";
const ADD_TERMINAL = `--add-label ${TERMINAL}`;
const ISSUE_CLOSE = "issue close";
const STACK_BRANCH = "stack/queue-drain-20260903";
const STAGING_BRANCH = "release/staging";

/** A project that deploys `main` to production and one branch to staging. */
const DEPLOY_CONFIG = {
  deploy: {
    branches: {
      dev: "dev-branch",
      production: "main",
      staging: STAGING_BRANCH,
    },
  },
  github: { org: "acme", repo: "widgets" },
  tracker: "github",
  workItem: { verify: "trailer" },
};

/** The same project, viewed from the repository `sweep` runs inside. */
const SWEEP_CONFIG = {
  deploy: { branches: { production: "main" } },
  github: { org: "acme", repo: "code" },
  tracker: "github",
  workItem: { verify: "trailer" },
};

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * A timeline carrying merged pull requests in the named repository.
 * @param numbers - Pull-request numbers to report as merged.
 * @param repository - `owner/name` they belong to.
 * @returns The timeline as JSON text.
 */
function mergedTimeline(
  numbers: number[],
  repository = "acme/widgets"
): string {
  return JSON.stringify(
    numbers.map(number => ({
      event: "cross-referenced",
      source: {
        issue: {
          number,
          pull_request: { merged_at: "2026-09-03T10:00:00Z" },
          repository_url: `https://api.github.com/repos/${repository}`,
        },
      },
    }))
  );
}

/** The claimed, open item every case starts from. */
const CLAIMED_ISSUE = issueJson({ labels: [{ name: CLAIMED }] });

/** What a correct production completion reads back as. */
const COMPLETED_ISSUE = issueJson({
  labels: [{ name: TERMINAL }],
  state: "CLOSED",
  stateReason: "COMPLETED",
});

/**
 * Drive `complete` against a staged base branch.
 * @param fixture - The repository to run inside.
 * @param overrides - Environment entries staging the tracker's answers.
 * @returns The run outcome plus every fake `gh` invocation.
 */
function complete(
  fixture: Fixture,
  overrides: Record<string, string>
): { invocations: string; stdout: string; exitCode: number | undefined } {
  const log = path.join(fixture.root, "gh.log");
  const result = cli(fixture, ["complete", REF_FLAG, REF], {
    FAKE_GH_ISSUE_COUNT_FILE: path.join(fixture.root, "gh-issue.count"),
    FAKE_GH_ISSUE_JSON_1: CLAIMED_ISSUE,
    FAKE_GH_ISSUE_JSON_2: COMPLETED_ISSUE,
    FAKE_GH_LOG: log,
    FAKE_GH_TIMELINE_JSON: mergedTimeline([7]),
    ...overrides,
  });
  return {
    exitCode: result.exitCode,
    invocations: readFileSync(log, "utf8"),
    stdout: result.stdout,
  };
}

describe("GitHub completion weighs the merged pull request's base branch", () => {
  it("does NOT write the production terminal role for a merge into an integration branch", () => {
    // The bite. Before this fix the writer reached the same line for this
    // input as for a merge into `main`, so it added `status:done` and closed
    // the item on a change that had reached no deploy branch at all.
    const run = complete(createFixture(DEPLOY_CONFIG), {
      FAKE_GH_PR_BASE: STACK_BRANCH,
    });

    expect(run.invocations).not.toContain(ADD_TERMINAL);
    expect(run.invocations).not.toContain(ISSUE_CLOSE);
    expect(run.exitCode).toBeUndefined();
  });

  it("names the base branch it observed and why that base earned nothing", () => {
    // An operator reading a run that completed nothing has to be able to tell
    // WHY without opening the code.
    const run = complete(createFixture(DEPLOY_CONFIG), {
      FAKE_GH_PR_BASE: STACK_BRANCH,
    });

    expect(run.stdout).toContain("work-item NOT completed");
    expect(run.stdout).toContain(STACK_BRANCH);
    expect(run.stdout).toContain("not a deploy branch");
    // The ASSUMPTION has to be visible: an operator whose real production
    // branch is not this one can see the wrong premise in the refusal itself.
    expect(run.stdout).toContain('production is taken to be "main"');
    expect(run.stdout).toContain("main [production]");
  });

  it("still completes and closes a merge into the production deploy branch", () => {
    // The negative control. A fix that stops completing anything satisfies the
    // case above and is strictly worse than the defect it replaced.
    const run = complete(createFixture(DEPLOY_CONFIG), {
      FAKE_GH_PR_BASE: "main",
    });

    expect(run.invocations).toContain(ADD_TERMINAL);
    expect(run.invocations).toContain(`--remove-label ${CLAIMED}`);
    expect(run.invocations).toContain(ISSUE_CLOSE);
    expect(run.stdout).toContain(`work-item completed: ${REF} -> ${TERMINAL}`);
    expect(run.stdout).toContain("#7 -> main [production]");
  });

  it("writes the environment's own role, not the terminal one, for a staging merge", () => {
    const run = complete(createFixture(DEPLOY_CONFIG), {
      FAKE_GH_PR_BASE: STAGING_BRANCH,
    });

    expect(run.invocations).toContain(`--add-label ${ON_STG}`);
    expect(run.invocations).not.toContain(ADD_TERMINAL);
    // Still in flight: the production terminal is what closes an item, so a
    // staging merge must leave it open and still claimed.
    expect(run.invocations).not.toContain(ISSUE_CLOSE);
    expect(run.invocations).not.toContain(`--remove-label ${CLAIMED}`);
    expect(run.stdout).toContain(`work-item advanced: ${REF} -> ${ON_STG}`);
  });

  it("recognises the production base among several merged pull requests", () => {
    const run = complete(createFixture(DEPLOY_CONFIG), {
      FAKE_GH_PR_BASE: STACK_BRANCH,
      FAKE_GH_PR_BASE_8: "main",
      FAKE_GH_TIMELINE_JSON: mergedTimeline([7, 8]),
    });

    expect(run.invocations).toContain(ADD_TERMINAL);
    expect(run.stdout).toContain(`#7 -> ${STACK_BRANCH} [not a deploy branch]`);
    expect(run.stdout).toContain("#8 -> main [production]");
  });

  it("reports, rather than ranks, two different non-production environments", () => {
    const run = complete(createFixture(DEPLOY_CONFIG), {
      FAKE_GH_PR_BASE: "dev-branch",
      FAKE_GH_PR_BASE_8: STAGING_BRANCH,
      FAKE_GH_TIMELINE_JSON: mergedTimeline([7, 8]),
    });

    expect(run.invocations).not.toContain(ADD_TERMINAL);
    expect(run.invocations).not.toContain(`--add-label ${ON_STG}`);
    expect(run.stdout).toContain("states\nno ordering between them");
  });

  it("treats a base it cannot read as earning nothing", () => {
    // Step 3c of the driving skill sets the precedent for an unresolvable
    // base: do not mutate, report. A blank answer must not fall through to a
    // completion.
    const run = complete(createFixture(DEPLOY_CONFIG), {
      FAKE_GH_PR_BASE: "",
    });

    expect(run.invocations).not.toContain(ADD_TERMINAL);
    expect(run.stdout).toContain("(unknown base)");
  });
});

describe("the sweep backstop inherits the same weighing", () => {
  it("does not stamp an item whose only merge targeted a non-deploy base", () => {
    const fixture = createFixture(SWEEP_CONFIG);
    const log = path.join(fixture.root, "gh.log");
    const result = cli(fixture, ["sweep", "--apply"], {
      FAKE_GH_LIST_JSON: JSON.stringify([{ number: 42, title: "stacked" }]),
      FAKE_GH_LOG: log,
      FAKE_GH_PR_BASE: STACK_BRANCH,
      FAKE_GH_TIMELINE_JSON: mergedTimeline([7], "acme/code"),
    });

    const invocations = readFileSync(log, "utf8");
    expect(invocations).not.toContain(ADD_TERMINAL);
    expect(invocations).not.toContain(ISSUE_CLOSE);
    // A clean exit is part of the assertion: a sweep that threw on the first
    // such item would also have stamped nothing, and would be useless over a
    // queue that contains one.
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("work-item NOT completed");
  });
});

describe("deployBranchEnvironments", () => {
  it("inverts the configured env-to-branch map", () => {
    expect([
      ...deployBranchEnvironments({
        deploy: { branches: { production: "main", staging: "stg" } },
      }),
    ]).toEqual([
      ["main", "production"],
      ["stg", "staging"],
    ]);
  });

  it("falls back to the configured default branch as production", () => {
    // A project that configured nothing is not saying "nothing deploys". A
    // fallback of "no branch deploys anything" would refuse every completion
    // in every project that never wrote the key.
    expect([
      ...deployBranchEnvironments({
        policy: { repository: { default_branch: "trunk" } },
      }),
    ]).toEqual([["trunk", "production"]]);
  });

  it("falls back to main when nothing at all is configured", () => {
    expect([...deployBranchEnvironments({})]).toEqual([["main", "production"]]);
  });

  it("ignores an environment whose branch is blank or not a string", () => {
    expect([
      ...deployBranchEnvironments({
        deploy: { branches: { dev: 7, production: "main", staging: "  " } },
      }),
    ]).toEqual([["main", "production"]]);
  });
});

describe("mergedBaseDecision", () => {
  const LIFECYCLE = {
    done: [
      ["dev", "status:on-dev"],
      ["staging", ON_STG],
      ["production", TERMINAL],
    ] as [string, string][],
    productionEnvironment: "production",
  };
  const BRANCHES = new Map([
    ["dev", "dev"],
    ["main", "production"],
    [STAGING_BRANCH, "staging"],
  ]);

  it("returns no role for a base that maps to no environment", () => {
    const decision = mergedBaseDecision(
      [{ base: STACK_BRANCH, number: 7 }],
      BRANCHES,
      LIFECYCLE
    );
    expect(decision.role).toBeNull();
    expect(decision.terminal).toBe(false);
    expect(decision.evidence).toEqual([
      { base: STACK_BRANCH, environment: null, number: 7 },
    ]);
  });

  it("returns the terminal role for the production branch", () => {
    const decision = mergedBaseDecision(
      [{ base: "main", number: 7 }],
      BRANCHES,
      LIFECYCLE
    );
    expect(decision.role).toBe(TERMINAL);
    expect(decision.terminal).toBe(true);
  });

  it("returns the environment's role, not terminal, below production", () => {
    const decision = mergedBaseDecision(
      [{ base: STAGING_BRANCH, number: 7 }],
      BRANCHES,
      LIFECYCLE
    );
    expect(decision.role).toBe(ON_STG);
    expect(decision.terminal).toBe(false);
  });

  it("recognises production by NAME, whatever order the bases arrive in", () => {
    // Order must not decide the answer: a story fixed on `dev` first and then
    // on `main` has reached production either way round.
    for (const bases of [
      ["dev", "main"],
      ["main", "dev"],
    ]) {
      const decision = mergedBaseDecision(
        bases.map((base, index) => ({ base, number: index + 1 })),
        BRANCHES,
        LIFECYCLE
      );
      expect(decision.role).toBe(TERMINAL);
      expect(decision.terminal).toBe(true);
    }
  });

  it("recognises production even when it is listed FIRST in the done map", () => {
    // The defect an earlier draft of this function had: ranking environments
    // by their position in the configured map makes correctness depend on JSON
    // key order, which no schema constrains — and it fails in the direction of
    // writing the WRONG TERMINAL ROLE, not merely refusing.
    const decision = mergedBaseDecision(
      [
        { base: "main", number: 7 },
        { base: STAGING_BRANCH, number: 8 },
      ],
      BRANCHES,
      {
        done: [
          ["production", TERMINAL],
          ["staging", ON_STG],
          ["dev", "status:on-dev"],
        ] as [string, string][],
        productionEnvironment: "production",
      }
    );
    expect(decision.role).toBe(TERMINAL);
    expect(decision.terminal).toBe(true);
  });

  it("refuses to rank two DIFFERENT non-production environments", () => {
    // There is no ordering between them the configuration states, so the
    // honest answer is to report both rather than guess which is furthest.
    const decision = mergedBaseDecision(
      [
        { base: "dev", number: 7 },
        { base: STAGING_BRANCH, number: 8 },
      ],
      BRANCHES,
      LIFECYCLE
    );
    expect(decision.role).toBeNull();
    expect(decision.ambiguous).toBe(true);
    expect(decision.terminal).toBe(false);
  });

  it("writes nothing when the production environment has no configured role", () => {
    const decision = mergedBaseDecision(
      [{ base: "main", number: 7 }],
      BRANCHES,
      {
        done: [["staging", ON_STG]] as [string, string][],
        productionEnvironment: "production",
      }
    );
    expect(decision.role).toBeNull();
    expect(decision.terminal).toBe(false);
  });

  it("ignores a non-deploy base sitting alongside a deploy one", () => {
    const decision = mergedBaseDecision(
      [
        { base: STACK_BRANCH, number: 7 },
        { base: STAGING_BRANCH, number: 8 },
      ],
      BRANCHES,
      LIFECYCLE
    );
    expect(decision.role).toBe(ON_STG);
    expect(decision.evidence.map(entry => entry.environment)).toEqual([
      null,
      "staging",
    ]);
  });

  it("returns no role for an environment with no configured done role", () => {
    // A branch can be listed in deploy.branches for an environment the
    // lifecycle names no role for. There is nothing to write, so nothing is.
    const decision = mergedBaseDecision(
      [{ base: "qa-box", number: 7 }],
      new Map([["qa-box", "qa"]]),
      LIFECYCLE
    );
    expect(decision.role).toBeNull();
  });

  it("returns no role for no merged pull requests at all", () => {
    expect(mergedBaseDecision([], BRANCHES, LIFECYCLE).role).toBeNull();
  });
});
