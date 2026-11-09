/**
 * What may supersede an uncleared `[lisa-ci-failed]` marker.
 *
 * Both dispatch paths trust a failure marker only while it is the newest
 * counted Lisa marker on the item. Before CodySwannGT/lisa#4707 a
 * non-failure marker from ANY author counted as newer, so on a public
 * repository a drive-by `[lisa-x] hi` turned CI rework off and the agent
 * rebuilt the work in a second PR. A later non-failure marker now counts only
 * when its author is trusted — `github-actions[bot]`, the item's author, or a
 * configured `sessionManager.trustedAuthorIds` entry — and claim comments
 * never count. The producer and the route helper share one predicate;
 * `lisa-ci-marker-parity.test.ts` replays the route fixtures through both.
 * @module tests/unit/scripts/lisa-ci-marker-supersession
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { trackerContract } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  isNewestLisaMarker,
  markerTrust,
  planFromFixture,
  readItemAuthor,
  recordedGh,
} from "../../../scripts/lisa-ci-failure-redispatch.mjs";
import {
  decideRoute,
  routeFromFixture,
} from "../../../scripts/lisa-ci-rework-route.mjs";

const FIXTURES = "tests/fixtures/ci-rework-route";
const REPO = "CodySwannGT/lisa";
const TRUSTED = "trusted-marker";
const UNTRUSTED = "untrusted-later-marker";
const NOT_NEWEST = "not-newest";
const OUTSIDER = "drive-by-user";
const CI_REWORK = "ci-rework";
const DRIVE_BY = "[lisa-x] hi";
const COMMENTS = `api repos/${REPO}/issues/1/comments --paginate --slurp`;
const ISSUE = `api repos/${REPO}/issues/1`;

const contract = trackerContract({
  tracker: "github",
  github: { org: "CodySwannGT", repo: "lisa" },
});

type Comment = {
  id: number;
  user?: { login?: string; id?: number };
  body?: string;
};

/**
 * Load one route fixture.
 * @param name - Fixture file name without extension.
 * @returns The parsed fixture.
 */
function fixture(name: string) {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));
}

/**
 * Route item 1 of a fixture with the given configured trusted authors.
 * @param name - Fixture file name without extension.
 * @param trustedAuthorIds - Configured `sessionManager.trustedAuthorIds`.
 * @returns The route decision.
 */
function routeWith(name: string, trustedAuthorIds: unknown[] = []) {
  return routeFromFixture(fixture(name), "1", {
    ...contract,
    trustedAuthorIds,
  });
}

describe("an untrusted commenter cannot suppress CI rework (AC2)", () => {
  it("routes ci-rework when an outsider posts a Lisa marker after the bot marker", () => {
    const [comments] = fixture(UNTRUSTED).gh[COMMENTS].stdout;
    expect(comments.at(-1)).toMatchObject({
      user: { login: OUTSIDER },
      body: DRIVE_BY,
    });
    expect(routeWith(UNTRUSTED)).toMatchObject({
      route: CI_REWORK,
      pr: 101,
    });
  });

  it("is not suppressed by an outsider's claim-plus-other-marker comment either", () => {
    const data = fixture(UNTRUSTED);
    data.gh[COMMENTS].stdout[0].at(-1).body =
      "[lisa-tracker-claim] Claimed.\n<!-- [lisa-human-gate] reason=x -->";
    expect(
      decideRoute({ item: "1", contract, gh: recordedGh(data.gh) })
    ).toMatchObject({ route: CI_REWORK, pr: 101 });
  });
});

describe("a later trusted non-claim Lisa marker still supersedes (AC3)", () => {
  it("counts the item's author", () => {
    const [, , hold] = fixture(NOT_NEWEST).gh[COMMENTS].stdout[0];
    expect(hold.user.login).toBe(
      fixture(NOT_NEWEST).gh[ISSUE].stdout.user.login
    );
    expect(routeWith(NOT_NEWEST)).toMatchObject({
      route: "implement",
      reason: NOT_NEWEST,
    });
  });

  it.each<[string | number, string]>([
    [`login:${OUTSIDER}`, "a login: entry"],
    ["id:777", "an id: entry"],
    ["777", "a plain all-digit entry (an account id)"],
    [777, "a hand-written numeric entry"],
  ])("counts a configured trustedAuthorIds entry %j (%s)", entry => {
    const data = fixture(UNTRUSTED);
    data.gh[COMMENTS].stdout[0].at(-1).user.id = 777;
    expect(
      decideRoute({
        item: "1",
        contract: { ...contract, trustedAuthorIds: [entry] },
        gh: recordedGh(data.gh),
      })
    ).toMatchObject({ route: "implement", reason: NOT_NEWEST });
  });

  it.each([
    ["login:777", "a login: entry never matches an account id"],
    ["id:drive-by-user", "an id: entry never matches a login"],
    ["unknown:drive-by-user", "an unknown prefix matches nobody"],
    // A plain entry is an account id only, as in ready-queue-order: a freed
    // login can be re-registered by someone else (#4623).
    [OUTSIDER, "a plain login string is not trusted"],
  ])("does not count %j (%s)", entry => {
    const data = fixture(UNTRUSTED);
    data.gh[COMMENTS].stdout[0].at(-1).user.id = 777;
    expect(
      decideRoute({
        item: "1",
        contract: { ...contract, trustedAuthorIds: [entry] },
        gh: recordedGh(data.gh),
      })
    ).toMatchObject({ route: CI_REWORK, pr: 101 });
  });

  it("routes implement read-failed when the item author cannot be read", () => {
    const data = fixture(UNTRUSTED);
    data.gh[ISSUE] = { ok: false, stderr: "HTTP 502" };
    expect(
      decideRoute({ item: "1", contract, gh: recordedGh(data.gh) })
    ).toMatchObject({ route: "implement", reason: "read-failed" });
  });

  it("does not read the item author when no later marker needs it", () => {
    const data = fixture(TRUSTED);
    expect(Object.hasOwn(data.gh, ISSUE)).toBe(false);
    expect(
      decideRoute({ item: "1", contract, gh: recordedGh(data.gh) })
    ).toMatchObject({ route: CI_REWORK });
  });
});

describe("the producer predicate", () => {
  const bot = { login: "github-actions[bot]" };
  const marker: Comment = {
    id: 2,
    user: bot,
    body: `<!-- [lisa-ci-failed] pr=1 sha=${"a".repeat(40)} -->`,
  };
  const later = (login: string, body: string): Comment => ({
    id: 3,
    user: { login },
    body,
  });
  const itemAuthor = () => ({ login: "owner" });
  const trust = markerTrust({ trustedAuthorIds: [], itemAuthor });

  it("ignores an untrusted later non-failure marker", () => {
    const comments = [marker, later(OUTSIDER, DRIVE_BY)];
    expect(isNewestLisaMarker(comments, marker, trust)).toBe(true);
  });

  it("counts the item author's later non-claim marker", () => {
    const comments = [marker, later("owner", "[lisa-human-gate]")];
    expect(isNewestLisaMarker(comments, marker, trust)).toBe(false);
  });

  it("never counts a claim-only comment, whoever posted it", () => {
    const comments = [marker, later("owner", "[lisa-tracker-claim] Claimed.")];
    expect(isNewestLisaMarker(comments, marker, trust)).toBe(true);
  });

  it("counts a failure marker only from github-actions[bot]", () => {
    const forged = later("owner", marker.body ?? "");
    expect(isNewestLisaMarker([marker, forged], marker, trust)).toBe(true);
    const genuine = { ...forged, user: bot };
    expect(isNewestLisaMarker([marker, genuine], marker, trust)).toBe(false);
  });

  it("trusts only github-actions[bot] when no trust is given", () => {
    const comments = [marker, later("owner", "[lisa-human-gate]")];
    expect(isNewestLisaMarker(comments, marker)).toBe(true);
  });

  it("reads the item author from the issue's REST user", () => {
    const gh = recordedGh({ [ISSUE]: fixture(NOT_NEWEST).gh[ISSUE] });
    expect(readItemAuthor("1", REPO, gh)).toMatchObject({
      login: "CodySwannGT",
    });
  });

  it.each([
    ["a non-failure marker", DRIVE_BY],
    ["a claim comment", "[lisa-tracker-claim] Claimed by Lisa."],
  ])(
    "still repairs the lane when only an outsider posted %s since",
    (_case, body) => {
      const data = JSON.parse(
        readFileSync(
          "tests/fixtures/ci-failure-redispatch/agent-pr-failed-replayed.json",
          "utf8"
        )
      );
      const key = (suffix: string) => `api repos/${REPO}/issues/4672${suffix}`;
      data.gh[
        `issue view 4672 --repo ${REPO} --json state,labels`
      ].stdout.labels = [{ name: "status:in-progress" }];
      data.gh[key("/events --paginate --slurp")].stdout = [[]];
      data.gh[key("/comments --paginate --slurp")].stdout[0].push({
        id: 6700000099,
        user: { login: OUTSIDER, type: "User" },
        created_at: "2026-11-05T12:00:00Z",
        body,
      });
      data.gh[key("")] = { stdout: { user: { login: "CodySwannGT" } } };
      expect(planFromFixture(data, contract).outcome).toBe("relabel-repair");
    }
  );
});
