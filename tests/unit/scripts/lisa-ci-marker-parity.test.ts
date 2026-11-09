/**
 * The producer and the route helper reach the same answer on every route
 * fixture (CodySwannGT/lisa#4707).
 *
 * Each fixture whose marker names an open, bound PR is replayed twice: through
 * the route helper, and — reshaped as a failed required-check run with the
 * item still in the claimed lane — through the producer's real plan path,
 * whose lane repair goes through the shared supersession predicate. If either
 * script drifts from the shared rule, the pair stops matching.
 * @module tests/unit/scripts/lisa-ci-marker-parity
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { trackerContract } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  FAILURE_MARKER,
  planFromFixture,
  trustedAuthor,
} from "../../../scripts/lisa-ci-failure-redispatch.mjs";
import { routeFromFixture } from "../../../scripts/lisa-ci-rework-route.mjs";

const FIXTURES = "tests/fixtures/ci-rework-route";
const REPO = "CodySwannGT/lisa";
const TRUSTED = "trusted-marker";
const UNTRUSTED = "untrusted-later-marker";
const NOT_NEWEST = "not-newest";
const CI_REWORK = "ci-rework";
const COMMENTS = `api repos/${REPO}/issues/1/comments --paginate --slurp`;
const ISSUE = `api repos/${REPO}/issues/1`;
const ROUTE_PR_VIEW = (pr: string) =>
  `pr view ${pr} --repo ${REPO} --json state,isCrossRepository,body,headRefName`;

const contract = {
  ...trackerContract({
    tracker: "github",
    github: { org: "CodySwannGT", repo: "lisa" },
  }),
  trustedAuthorIds: [],
};

type Comment = { id: number; user?: { login?: string }; body?: string };

/**
 * Load one route fixture.
 * @param name - Fixture file name without extension.
 * @returns The parsed fixture.
 */
function fixture(name: string) {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));
}

/**
 * Route item 1 of a fixture through the helper.
 * @param name - Fixture file name without extension.
 * @returns The route decision.
 */
function routeWith(name: string) {
  return routeFromFixture(fixture(name), "1", contract);
}

/**
 * The route fixture replayed as the producer would see it: a failed required
 * check on the marker's head, the item still in the claimed lane (so the
 * marker's lane move did not land), and no label history. The producer then
 * decides whether repairing the lane is still safe, through the same
 * supersession predicate the helper routes on.
 * @param data - Route fixture.
 * @param marker - The bot's failure marker in it.
 * @returns A producer fixture.
 */
function asProducerFixture(
  data: { gh: Record<string, unknown> },
  marker: Comment
) {
  const [, pr = "", sha = ""] = FAILURE_MARKER.exec(marker.body ?? "") ?? [];
  // A fixture whose route never reads the PR (not-newest) records no PR or
  // author answer; the producer always reads both, so borrow the trusted
  // fixture's open, bound PR and the item's recorded author.
  const recorded = {
    ...fixture(TRUSTED).gh,
    ...fixture(NOT_NEWEST).gh,
  };
  const view = (
    (data.gh[ROUTE_PR_VIEW(pr)] ?? recorded[ROUTE_PR_VIEW(pr)]) as {
      stdout: object;
    }
  ).stdout;
  return {
    event: {
      workflow_run: {
        id: 1,
        head_sha: sha,
        pull_requests: [{ number: Number(pr) }],
        repository: { full_name: REPO },
      },
    },
    gh: {
      [ISSUE]: recorded[ISSUE],
      ...data.gh,
      [`pr view ${pr} --repo ${REPO} --json number,state,body,headRefOid,isCrossRepository,baseRefName`]:
        {
          stdout: {
            ...view,
            number: Number(pr),
            headRefOid: sha,
            baseRefName: "main",
          },
        },
      [`issue view 1 --repo ${REPO} --json state,labels`]: {
        stdout: {
          state: "OPEN",
          labels: [{ name: contract.lifecycle.claimed }],
        },
      },
      [`pr checks ${pr} --repo ${REPO} --required --json name,state,bucket`]: {
        stdout: [{ name: "unit", state: "FAILURE", bucket: "fail" }],
      },
      [`api repos/${REPO}/issues/1/events --paginate --slurp`]: {
        stdout: [[]],
      },
    },
  };
}

describe("the producer and the route helper agree on every route fixture", () => {
  // Fixtures where the marker's PR is open and bound, so both scripts reach
  // the supersession question. The helper routes ci-rework exactly when the
  // marker still describes the item; the producer repairs the lane exactly
  // then too, except after a trusted claim, which moved the lane without
  // making the marker stale (the deliberate difference, untouchedSince).
  const LANE_MOVED = new Set(["claim-after-marker", "reclaim-twice"]);
  const names = readdirSync(FIXTURES)
    .filter(file => file.endsWith(".json"))
    .map(file => file.replace(/\.json$/u, ""))
    .filter(name => {
      const decision = routeWith(name);
      return decision.route === CI_REWORK || decision.reason === NOT_NEWEST;
    });

  it("covers the fixtures that reach the supersession question", () => {
    expect(names).toEqual(
      expect.arrayContaining([TRUSTED, UNTRUSTED, NOT_NEWEST, ...LANE_MOVED])
    );
  });

  it.each(names)("%s", name => {
    const data = fixture(name);
    const marker = (data.gh[COMMENTS].stdout.flat() as Comment[])
      .filter(c => FAILURE_MARKER.test(c.body ?? "") && trustedAuthor(c))
      .at(-1) as Comment;
    const helper = routeWith(name).route;
    const producer = planFromFixture(asProducerFixture(data, marker), contract);
    const repair = helper === CI_REWORK && !LANE_MOVED.has(name);
    expect(producer.outcome).toBe(
      repair ? "relabel-repair" : "already-reported"
    );
  });
});
