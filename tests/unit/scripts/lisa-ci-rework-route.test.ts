/**
 * The CI-rework route decision for a dispatched work item.
 *
 * `lisa-track` asks one question before it claims an item: did a required
 * check fail on this item's existing PR, so the agent should go back to that
 * PR instead of building again? The answer must agree with build intake's arm
 * (CodySwannGT/lisa#4677), so it is decided by one script over the item's
 * comments, read before the claim comment is posted. These cases replay the
 * recorded fixtures that the Validation Journey names and pin each reason a
 * marker is ignored.
 * @module tests/unit/scripts/lisa-ci-rework-route
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { trackerContract } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import { recordedGh } from "../../../scripts/lisa-ci-failure-redispatch.mjs";
import {
  CI_LOOP_BOUND,
  decideRoute,
  failingChecksFrom,
  routeFromFixture,
} from "../../../scripts/lisa-ci-rework-route.mjs";

const FIXTURES = "tests/fixtures/ci-rework-route";
const TRUSTED = "trusted-marker";
const NOT_NEWEST = "not-newest";
const READ_FAILED = "read-failed";
const IMPLEMENT = "implement";
const REPO = "CodySwannGT/lisa";
const SHA = "3db71f89a186d5dbeb78015aa5735fa9d8efda48";
const COMMENTS = `api repos/${REPO}/issues/1/comments --paginate --slurp`;
const PR_VIEW = `pr view 101 --repo ${REPO} --json state,isCrossRepository,body,headRefName`;
const CHECKS = [
  "🔍 Quality Checks / 🧪 Run Unit Tests",
  "🧩 Plugin artifacts match source",
];

/** The tracker contract the Lisa repo's own `.lisa.config.json` resolves. */
const contract = trackerContract({
  tracker: "github",
  github: { org: "CodySwannGT", repo: "lisa" },
});

/**
 * Load one recorded fixture.
 * @param name - Fixture file name without extension.
 * @returns The parsed fixture.
 */
function fixture(name: string) {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));
}

/**
 * Decide the route for item 1 from a named fixture.
 * @param name - Fixture file name without extension.
 * @returns The route decision.
 */
function route(name: string) {
  return routeFromFixture(fixture(name), "1", contract);
}

/**
 * The trusted fixture's comments with extra comments appended.
 * @param extra - Comments to append, oldest first.
 * @returns A recorded gh runner serving those comments and the open PR.
 */
function withComments(extra: object[]) {
  const data = fixture(TRUSTED);
  const [comments] = data.gh[COMMENTS].stdout;
  return recordedGh({
    ...data.gh,
    [COMMENTS]: { stdout: [[...comments, ...extra]] },
  });
}

describe("a trusted marker routes the item back to its PR", () => {
  it("returns ci-rework with the PR, head, branch and failing checks", () => {
    expect(route(TRUSTED)).toEqual({
      route: "ci-rework",
      item: `${REPO}#1`,
      pr: 101,
      sha: SHA,
      headRefName: "claude/1-example-branch",
      failingChecks: CHECKS,
      markerCount: 1,
    });
  });

  it("is not hidden by a forged marker typed after the genuine one", () => {
    const forged = {
      id: 1003,
      user: { login: "someone-else" },
      created_at: "2026-11-05T12:00:00Z",
      body: `<!-- [lisa-ci-failed] pr=999 sha=${"a".repeat(40)} -->`,
    };
    const decision = decideRoute({
      item: "1",
      contract,
      gh: withComments([forged]),
    });
    expect(decision.route).toBe("ci-rework");
    expect(decision.pr).toBe(101);
  });
});

describe("an untrusted or stale marker is ignored", () => {
  it.each([
    ["human-authored", "untrusted-author"],
    ["cleared-marker", "cleared"],
    ["closed-pr", "pull-request-not-open"],
    ["fork-pr", "fork-pull-request"],
    ["merged-pr", "pull-request-not-open"],
    ["fork-pr", "fork-pull-request"],
    ["other-item", "other-work-item"],
    ["unbound-pr", "unbound-pull-request"],
    [NOT_NEWEST, NOT_NEWEST],
  ])("%s -> route implement (%s)", (name, reason) => {
    // The recorded runner throws on any unrecorded call, so a fixture that
    // records no PR read also proves the PR was never read for that reason.
    const decision = route(name);
    expect(decision.route).toBe(IMPLEMENT);
    expect(decision.reason).toBe(reason);
    expect(decision.detail).toEqual(expect.any(String));
  });

  it("routes implement with no-marker when the item carries no CI marker", () => {
    const gh = recordedGh({ [COMMENTS]: { stdout: [[]] } });
    expect(decideRoute({ item: "1", contract, gh }).reason).toBe("no-marker");
  });

  it.each([
    [
      "names two different items",
      `Work-Item: ${REPO}#1\nWork-Item: ${REPO}#2\n`,
      "unbound-pull-request",
    ],
    [
      "names one item in another repository",
      "Work-Item: Other/repo#1\n",
      "other-work-item",
    ],
  ])("a PR body that %s -> %s", (_case, body, reason) => {
    const data = fixture(TRUSTED);
    const gh = recordedGh({
      ...data.gh,
      [PR_VIEW]: { stdout: { ...data.gh[PR_VIEW].stdout, body } },
    });
    expect(decideRoute({ item: "1", contract, gh }).reason).toBe(reason);
  });
});

describe("known gap: a claim comment posted after the marker (CodySwannGT/lisa#4707)", () => {
  it("routes implement (not-newest) when the first [lisa-tracker-claim] lands after the marker", () => {
    // This pins CURRENT behaviour, which is the known gap, not the desired
    // one: an item first claimed by build intake, bounced by CI, then
    // re-dispatched by the session manager gets its first [lisa-tracker-claim]
    // comment after the marker and is rebuilt instead of sent to its PR.
    // CodySwannGT/lisa#4707 will change this expectation to ci-rework.
    expect(route("claim-after-marker")).toMatchObject({
      route: IMPLEMENT,
      reason: NOT_NEWEST,
    });
  });
});

describe("a failed read falls back to the normal path", () => {
  it("routes implement when the comments cannot be read", () => {
    const gh = recordedGh({
      [COMMENTS]: { ok: false, stderr: "HTTP 502" },
    });
    const decision = decideRoute({ item: "1", contract, gh });
    expect(decision).toMatchObject({
      route: IMPLEMENT,
      reason: READ_FAILED,
    });
    expect(decision.detail).toContain("HTTP 502");
  });

  it("routes implement when the named PR cannot be read", () => {
    const data = fixture(TRUSTED);
    const gh = recordedGh({
      ...data.gh,
      [PR_VIEW]: { ok: false, stderr: "HTTP 404" },
    });
    expect(decideRoute({ item: "1", contract, gh })).toMatchObject({
      route: IMPLEMENT,
      reason: READ_FAILED,
    });
  });

  it("routes implement when the tracker is not GitHub", () => {
    const decision = decideRoute({
      item: "1",
      contract: { provider: "jira" },
      gh: recordedGh({}),
    });
    expect(decision).toMatchObject({
      route: IMPLEMENT,
      reason: "tracker-not-github",
    });
  });
});

describe("the retry loop is bounded like build intake's", () => {
  it(`blocks for a person at ${CI_LOOP_BOUND} bot markers for the same PR`, () => {
    expect(CI_LOOP_BOUND).toBe(3);
    expect(route("loop-bound")).toMatchObject({
      route: "blocked",
      reason: "ci-loop-bound",
      pr: 101,
      markerCount: 3,
      failingChecks: CHECKS,
    });
  });

  it("does not count a forged marker toward the bound", () => {
    const forged = (id: number) => ({
      id,
      user: { login: "someone-else" },
      created_at: `2026-11-05T0${id - 1000}:00:00Z`,
      body: `<!-- [lisa-ci-failed] pr=101 sha=${SHA} -->`,
    });
    const data = fixture(TRUSTED);
    const [comments] = data.gh[COMMENTS].stdout;
    const gh = recordedGh({
      ...data.gh,
      [COMMENTS]: { stdout: [[forged(1004), forged(1005), ...comments]] },
    });
    expect(decideRoute({ item: "1", contract, gh })).toMatchObject({
      route: "ci-rework",
      markerCount: 1,
    });
  });
});

describe("failingChecksFrom", () => {
  it("reads the check names from the marker comment's first line", () => {
    const body = `A required check failed on pull request #101 at commit ${SHA}: a / b, c.\n\nmore\n<!-- [lisa-ci-failed] pr=101 sha=${SHA} -->`;
    expect(failingChecksFrom(body)).toEqual(["a / b", "c"]);
  });

  it("returns no names when the first line is not the workflow's", () => {
    expect(failingChecksFrom("something else")).toEqual([]);
  });
});
