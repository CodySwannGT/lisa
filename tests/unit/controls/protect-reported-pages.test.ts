/**
 * `lisa controls protect` does not say a check "has not run yet" off a list
 * of pull requests that may go on (CodySwannGT/lisa#4993).
 *
 * A pipeline that runs only on pull requests never reports on the protected
 * branch, so the check is looked for on the five pull requests most recently
 * merged into it. Those are found in one page of the thirty most recently
 * updated closed pull requests, and closed ones that were never merged are in
 * the same page. When that page is full and holds fewer than five merged
 * ones, the merged pull requests that would have been looked at are further
 * down a list that was not read. That is an incomplete read, and the answer
 * to an incomplete read is `unknown`, never `not-ready`. Either way nothing
 * is written.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { ControlAuditFixture } from "../../helpers/control-audit-fixtures.js";
import { fakeGithub } from "./support/fake-github.js";
import type { ReportedPull } from "./support/fake-github-reports.js";
import {
  LINT_CHECK,
  REPO,
  protect,
  protectFixture,
} from "./support/protect-fixture.js";

const APPLY = { apply: true } as const;
const UNKNOWN = "unknown";
const NOT_READY = "not-ready";

/** A pull request that ran the check and was closed without being merged. */
const ABANDONED: ReportedPull = { checks: [LINT_CHECK], merged: false };

/** A pull request that was merged and did not run the check. */
const MERGED_WITHOUT: ReportedPull = { checks: ["Unrelated"] };

/** A pull request that was merged and ran the check. */
const MERGED_WITH: ReportedPull = { checks: [LINT_CHECK] };

const fixtures: ControlAuditFixture[] = [];

/**
 * Build a fixture with a workflow folder that is removed after the case.
 * @returns The repository root
 */
function repository(): string {
  const built = protectFixture();
  fixtures.push(built);
  return built.repoPath;
}

/**
 * Repeat one pull request.
 * @param count - How many
 * @param pull - The pull request
 * @returns That many of it
 */
function times(count: number, pull: ReportedPull): readonly ReportedPull[] {
  return Array.from({ length: count }, () => pull);
}

/**
 * Run the command against a platform whose branch head shows no result, so
 * the check can only be found on a pull request.
 * @param pulls - The pull requests, most recently updated first
 * @returns The result and the platform
 */
async function protectWith(pulls: readonly ReportedPull[]): Promise<{
  readonly state: string | undefined;
  readonly detail: string;
  readonly outcome: string;
  readonly writes: number;
}> {
  const github = fakeGithub({ repo: REPO, admin: true, reported: [], pulls });
  const result = await protect(repository(), github, APPLY);
  return {
    state: result.required_checks[0]?.state,
    detail: result.required_checks[0]?.detail ?? "",
    outcome: result.outcome,
    writes: github.writes().length,
  };
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("a full page of closed pull requests with too few merged ones", () => {
  it("is unknown, not not-ready, when none of the thirty was merged", async () => {
    const found = await protectWith(times(30, ABANDONED));

    expect(found.writes).toBe(0);
    expect(found.outcome).toBe("blocked");
    expect(found.state).toBe(UNKNOWN);
    expect(found.detail).toMatch(
      /^It could not be read whether this check has ever run/u
    );
    expect(found.detail).toContain(
      "none of the 30 most recently updated closed pull requests into that branch was merged"
    );
    expect(found.detail).toMatch(/further back were not read/u);
    expect(found.detail).not.toMatch(/It has not run yet/u);
  });

  it.each([1, 2, 3, 4])(
    "is unknown when only %i of the thirty were merged and none shows the check",
    async merged => {
      const found = await protectWith([
        ...times(30 - merged, ABANDONED),
        ...times(merged, MERGED_WITHOUT),
      ]);

      expect(found.writes).toBe(0);
      expect(found.state).toBe(UNKNOWN);
      expect(found.detail).toContain(
        `only ${String(merged)} of the 30 most recently updated closed pull requests into that branch`
      );
    }
  );

  it("is unknown when the merged ones are all further down than the page", async () => {
    const found = await protectWith([
      ...times(40, ABANDONED),
      ...times(5, MERGED_WITH),
    ]);

    expect(found.writes).toBe(0);
    expect(found.state).toBe(UNKNOWN);
  });

  it("says what the operator can do about it", async () => {
    const found = await protectWith(times(30, ABANDONED));

    expect(found.detail).toMatch(
      /once a pull request that runs this check has been merged, run this command again/u
    );
  });

  it("still requires a check that one of the few merged ones shows", async () => {
    const found = await protectWith([...times(29, ABANDONED), MERGED_WITH]);

    expect(found.state).toBe("required");
    expect(found.outcome).toBe("wired");
    expect(found.writes).toBe(1);
  });
});

describe("a list of closed pull requests that was read whole", () => {
  it("is not-ready when the page is not full and nothing in it was merged", async () => {
    const found = await protectWith(times(29, ABANDONED));

    expect(found.writes).toBe(0);
    expect(found.state).toBe(NOT_READY);
    expect(found.detail).toMatch(/^It has not run yet:/u);
  });

  it("is not-ready when a full page holds the five merged ones that are looked at", async () => {
    const found = await protectWith([
      ...times(25, ABANDONED),
      ...times(5, MERGED_WITHOUT),
    ]);

    expect(found.writes).toBe(0);
    expect(found.state).toBe(NOT_READY);
  });

  it("is not-ready when the repository has no closed pull request at all", async () => {
    const found = await protectWith([]);

    expect(found.state).toBe(NOT_READY);
  });
});

describe("a merged pull request the list names no commit for", () => {
  it.each([
    ["no commit id", null],
    ["something that is not a commit id", "../../branches"],
  ] as const)("is unknown when it carries %s", async (_what, head) => {
    const found = await protectWith([{ checks: [LINT_CHECK], head }]);

    expect(found.writes).toBe(0);
    expect(found.state).toBe(UNKNOWN);
    expect(found.detail).toMatch(/without a commit id/u);
  });

  it("is still required when another merged one shows the check", async () => {
    const found = await protectWith([
      { checks: [LINT_CHECK], head: null },
      MERGED_WITH,
    ]);

    expect(found.state).toBe("required");
    expect(found.writes).toBe(1);
  });

  it("does not matter when it is older than the five that are looked at", async () => {
    const found = await protectWith([
      ...times(5, MERGED_WITHOUT),
      { checks: [LINT_CHECK], head: null },
    ]);

    expect(found.state).toBe(NOT_READY);
  });
});
