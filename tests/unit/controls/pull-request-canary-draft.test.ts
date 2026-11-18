/**
 * A canary is only ever a draft pull request, and one that was merged all
 * the same is never passed over (CodySwannGT/lisa#4993).
 *
 * The hosting platform does not merge a draft, for a person or for
 * automation that merges pull requests whose checks are green — and the
 * clean half of a proof is exactly such a pull request. So where a draft
 * cannot be opened nothing is opened in its place, and before any canary is
 * closed the platform is asked whether it was merged. Every case runs
 * against the platform that lives in memory, which will merge a pull
 * request by itself when a case asks it to.
 * @module tests/unit/controls/pull-request-canary-draft
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  canaryPlatform,
  expectNoMerge,
  expectNothingLeft,
  line,
  settleWithCanaries,
} from "./support/canary-run.js";
import { removeCopies } from "./support/proof-run.js";
import { REPO } from "./support/protect-fixture.js";
import {
  PULL_ONLY_ENTRY,
  PULL_ONLY_GATES,
  entryOf,
} from "./support/pull-request-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const BASE = `repos/${REPO}`;

/** The reason of a half whose canary was never opened. */
const NOT_STARTED = "not-started";

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("a repository that is not offered draft pull requests", () => {
  it("gets no pull request at all, and the half says why", async () => {
    const platform = canaryPlatform({ drafts: false });

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform);

    // An ordinary pull request could be merged, so none is opened instead.
    expect(platform.pulls()).toEqual([]);
    expect(
      platform.log
        .filter(request => line(request) === `POST ${BASE}/pulls`)
        .map(request => (request.body as { draft?: unknown }).draft)
    ).toEqual([true, true]);
    expect(
      settled.pullRequest?.canaries.map(canary => [
        canary.pull_request,
        canary.draft,
      ])
    ).toEqual([
      [null, null],
      [null, null],
    ]);
    const entry = entryOf(settled, PULL_ONLY_ENTRY);
    expect(entry).toMatchObject({ outcome: "unknown", reason: NOT_STARTED });
    expect(entry.halves.map(half => half.reason)).toEqual([
      NOT_STARTED,
      NOT_STARTED,
    ]);
    expect(entry.halves[0]?.detail).toContain(
      "Draft pull requests are not supported in this repository."
    );
    expect(entry.halves[0]?.detail).toMatch(/only ever opened as a draft/u);
    expectNoMerge(platform.log);
    expectNothingLeft(platform);
  });
});

describe("a platform that opens an ordinary pull request when asked for a draft", () => {
  it("has that pull request closed without its checks being read", async () => {
    const platform = canaryPlatform({ draftsBecomeOrdinary: true });

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform);

    expect(platform.pulls().map(pull => [pull.draft, pull.state])).toEqual([
      [false, "closed"],
      [false, "closed"],
    ]);
    expect(
      platform.log.filter(request => request.path.includes("/check-runs"))
    ).toEqual([]);
    expect(
      settled.pullRequest?.canaries.map(canary => [
        canary.pull_request,
        canary.draft,
      ])
    ).toEqual([
      [1, false],
      [2, false],
    ]);
    expect(entryOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      outcome: "unknown",
      reason: NOT_STARTED,
    });
    expectNoMerge(platform.log);
    expectNothingLeft(platform);
  });
});

describe("a canary that something on the platform merged", () => {
  it("is on the record as merged, with its number, and no further canary is opened", async () => {
    // Somebody else merges every pull request as soon as it is looked at,
    // the way automation that merges green pull requests would.
    const platform = canaryPlatform({ mergedByTheHost: true });
    const before = platform.head("main");

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform);

    const canaries = settled.pullRequest?.canaries ?? [];
    expect(
      canaries.map(canary => [canary.pull_request, canary.merged])
    ).toEqual([
      [1, true],
      [null, null],
    ]);
    // The second half was never opened: whatever merged the first would
    // have taken it too.
    expect(platform.pulls()).toHaveLength(1);
    expect(entryOf(settled, PULL_ONLY_ENTRY).halves[1]?.detail).toMatch(
      /#1, a canary pull request of this run, was merged into main/u
    );
    expect(settled.pullRequest?.base_head).toMatchObject({
      before,
      unchanged: false,
    });
    // The command itself asked for no merge: it was the platform's doing.
    expectNoMerge(platform.log);
  });

  it("is not closed over: the pull request is left as the platform has it", async () => {
    const platform = canaryPlatform({ mergedByTheHost: true });

    await settleWithCanaries(PULL_ONLY_GATES, platform);

    expect(platform.log.filter(request => request.method === "PATCH")).toEqual(
      []
    );
    expect(platform.branches()).toEqual(["main"]);
  });

  it("is told apart from one that was not: an ordinary run records every canary as not merged", async () => {
    const platform = canaryPlatform();

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform);

    expect(settled.pullRequest?.canaries.map(canary => canary.merged)).toEqual([
      false,
      false,
    ]);
  });
});
