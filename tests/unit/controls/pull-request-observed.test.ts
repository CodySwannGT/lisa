/**
 * The pull-request moment without canaries (CodySwannGT/lisa#4997).
 *
 * By default `lisa controls attest` creates nothing on the hosting platform.
 * It reads the merge-protection settings and records, for each entry enforced
 * on pull requests, whether the platform requires the entry's check before a
 * merge. That is a reading, not a proof, so it is recorded at the `observed`
 * rung and never as passing.
 * @module tests/unit/controls/pull-request-observed
 */
import { afterEach, describe, expect, it } from "vitest";

import { rungOf } from "../../../src/controls/pull-request-types.js";
import { provedGates } from "../../helpers/control-proofs.js";
import {
  fakeGithub,
  statusCheckRuleset,
  type FakeGithub,
} from "./support/fake-github.js";
import { removeCopies } from "./support/proof-run.js";
import { REPO } from "./support/protect-fixture.js";
import {
  BOTH_CHECK,
  BOTH_ENTRY,
  BOTH_GATES,
  PULL_ONLY_CHECK,
  PULL_ONLY_ENTRY,
  PULL_ONLY_GATE,
  PULL_ONLY_GATES,
  WORKING,
  entryOf,
  pointOf,
  settle,
} from "./support/pull-request-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const BASE = `repos/${REPO}`;

/**
 * A platform whose default branch requires some checks.
 * @param contexts - The check names it requires
 * @returns The platform
 */
function requiring(...contexts: readonly string[]): FakeGithub {
  return fakeGithub({
    repo: REPO,
    admin: false,
    rulesets: [statusCheckRuleset(1, "main-checks", contexts)],
  });
}

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("an entry enforced only on pull requests, without canaries", () => {
  it("is recorded at the observed rung when the platform requires its check", async () => {
    const github = requiring(PULL_ONLY_CHECK);

    const settled = await settle(PULL_ONLY_GATES, github.gh);

    expect(entryOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      moment: "pull-request",
      outcome: "unproved",
      reason: "observed-required",
      rung: "observed",
      failed_halves: [],
      halves: [],
    });
    expect(entryOf(settled, PULL_ONLY_ENTRY).detail).toBe(
      `Observed, not exercised. The hosting platform requires "${PULL_ONLY_CHECK}" on main before a pull request can be merged. No pull request was opened to show that the check turns a violating change away; run again with --pull-request-canaries to exercise it.`
    );
    expect(pointOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      rung: "observed",
      settles_entry: true,
      observed: "required",
      checks: [{ context: PULL_ONLY_CHECK, state: "required" }],
      completed_at: "2026-02-01T00:00:00.000Z",
    });
    // Reading a setting never counts as passing.
    expect(settled.passed).toBe(false);
  });

  it("sends reads only, and creates no branch and no pull request", async () => {
    const github = requiring(PULL_ONLY_CHECK);
    const before = github.rulesets();

    const settled = await settle(PULL_ONLY_GATES, github.gh);

    expect(github.log).toEqual([
      { method: "GET", path: `${BASE}/rulesets` },
      { method: "GET", path: `${BASE}/rulesets/1` },
      { method: "GET", path: BASE },
    ]);
    expect(github.writes()).toEqual([]);
    expect(github.rulesets()).toEqual(before);
    expect(settled.pullRequest).toMatchObject({
      mode: "observed",
      branch: "main",
      run_id: null,
      permission: null,
      sweep: null,
      base_head: null,
      canaries: [],
      requests: github.log.map(request => ({ ...request, sent: true })),
    });
  });

  it("fails when the platform does not require its check", async () => {
    const github = requiring("some other check");

    const settled = await settle(PULL_ONLY_GATES, github.gh);

    expect(entryOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      outcome: "failed",
      reason: "observed-not-required",
      rung: "observed",
      failed_halves: [],
    });
    expect(entryOf(settled, PULL_ONLY_ENTRY).detail).toContain(
      `does not require "${PULL_ONLY_CHECK}" on main`
    );
    expect(pointOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      observed: "not-required",
      checks: [{ context: PULL_ONLY_CHECK, state: "not-required" }],
    });
  });

  it("is unknown, quoting the platform, when the settings cannot be read", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: false,
      readFailure: "Bad credentials",
    });

    const settled = await settle(PULL_ONLY_GATES, github.gh);

    expect(entryOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      outcome: "unknown",
      reason: "merge-protection-unread",
      rung: "observed",
    });
    expect(entryOf(settled, PULL_ONLY_ENTRY).detail).toContain(
      "Bad credentials"
    );
    expect(pointOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      observed: "unknown",
      checks: [{ context: PULL_ONLY_CHECK, state: "unknown" }],
    });
    expect(github.writes()).toEqual([]);
  });

  it.each([
    [
      "on another platform",
      "https://gitlab.com/example-owner/example-repo.git",
    ],
    ["with no remote at all", null],
  ])("is unknown and asks nothing %s", async (_, remote) => {
    const github = requiring(PULL_ONLY_CHECK);

    const settled = await settle(PULL_ONLY_GATES, github.gh, { remote });

    expect(github.log).toEqual([]);
    expect(entryOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      outcome: "unknown",
      reason: "platform-not-reached",
      rung: "observed",
    });
    expect(settled.pullRequest?.requests).toEqual([]);
  });
});

describe("an entry the platform is not asked to enforce", () => {
  it("stays unproved, and nothing is read for it", async () => {
    const [advisory] = Object.values(PULL_ONLY_GATES);
    const github = requiring(PULL_ONLY_CHECK);

    const settled = await settle(
      { [PULL_ONLY_GATE]: { ...(advisory as object), tier: "advisory" } },
      github.gh
    );

    expect(github.log).toEqual([]);
    expect(entryOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      outcome: "unproved",
      reason: "not-asked-of-platform",
      rung: "observed",
    });
    expect(pointOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      observed: "not-asked",
      checks: [],
    });
  });
});

describe("an entry enforced at push and on pull requests", () => {
  it("keeps its one result from the push proof and gains an observed point", async () => {
    const github = requiring(BOTH_CHECK);

    const settled = await settle(BOTH_GATES, github.gh);

    const entry = entryOf(settled, BOTH_ENTRY);
    expect(entry).toMatchObject({ moment: "push", outcome: "passed" });
    expect(entry).not.toHaveProperty("rung");
    expect(rungOf(entry)).toBe("exercised");
    expect(settled.entries).toHaveLength(1);
    expect(settled.passed).toBe(true);
    expect(pointOf(settled, BOTH_ENTRY)).toMatchObject({
      moment: "pull-request",
      rung: "observed",
      settles_entry: false,
      outcome: "unproved",
      reason: "observed-required",
      observed: "required",
    });
  });

  it("reports a check the platform does not require without changing the entry's result", async () => {
    const github = requiring("some other check");

    const settled = await settle(BOTH_GATES, github.gh);

    expect(entryOf(settled, BOTH_ENTRY).outcome).toBe("passed");
    expect(pointOf(settled, BOTH_ENTRY)).toMatchObject({
      outcome: "failed",
      reason: "observed-not-required",
      settles_entry: false,
    });
  });
});

describe("a register with no pull-request entry", () => {
  it("is returned as it was, and the platform is asked nothing", async () => {
    const github = requiring(PULL_ONLY_CHECK);

    const settled = await settle(
      provedGates([{ command: WORKING }]),
      github.gh
    );

    expect(github.log).toEqual([]);
    expect(settled.pullRequest).toBeNull();
    expect(settled.entries.map(entry => rungOf(entry))).toEqual(["exercised"]);
  });
});
