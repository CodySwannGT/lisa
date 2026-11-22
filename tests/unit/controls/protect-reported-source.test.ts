/**
 * Where a check has to have been reported, and by whom, before
 * `lisa controls protect` requires it (CodySwannGT/lisa#4993).
 *
 * **Where.** On the head of the protected branch, or on the head of a pull
 * request that was merged into it. An open pull request, and one closed
 * without being merged, show what somebody proposed. Counting them would
 * make a check required on a branch that does not run it, and every other
 * pull request would wait for ever.
 *
 * **By whom.** By the source the change would require it from. A check a
 * pipeline job runs is pinned to GitHub Actions, and an awaited check to the
 * app its declaration names, so a result under the right name from anything
 * else would not satisfy the requirement once it is written. A commit status
 * names no app, so it never counts for a pinned check. Only an awaited check
 * whose declaration names no app is satisfied by whoever reported it.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { ControlAuditFixture } from "../../helpers/control-audit-fixtures.js";
import { F_PAVED_GATES } from "../../helpers/control-register.js";
import { ACTIONS_APP_ID, fakeGithub } from "./support/fake-github.js";
import {
  AWAITED_FROM_ANYONE,
  LINT_CHECK,
  REPO,
  REVIEW_CHECK as REVIEW,
  handover,
  protect,
  protectFixture,
  sentAsRequired,
  sentChecks,
  type ProtectFixtureOptions,
} from "./support/protect-fixture.js";

const APPLY = { apply: true } as const;
const COMMITS = `repos/${REPO}/commits`;
const NOT_READY = "not-ready";

/** An app that is neither GitHub Actions nor the one a declaration names. */
const ANOTHER_APP = 999;

/** How a sentence names that app. */
const ANOTHER = `app ${String(ANOTHER_APP)}`;

const fixtures: ControlAuditFixture[] = [];

/**
 * Build a fixture that is removed after the case. It has a workflow folder.
 * @param options - How it differs from F-mixed with its declaration
 * @returns The repository root
 */
function repository(options: ProtectFixtureOptions = {}): string {
  const built = protectFixture(options);
  fixtures.push(built);
  return built.repoPath;
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("a check that only ran where the branch does not", () => {
  it.each([
    ["an open pull request", { state: "open" }],
    ["a pull request closed without being merged", { merged: false }],
  ] as const)("is not written when it only ran on %s", async (_where, pull) => {
    const repoPath = repository();
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      reported: [],
      pulls: [{ checks: [LINT_CHECK], ...pull }],
    });

    const result = await protect(repoPath, github, APPLY);

    expect(github.writes()).toEqual([]);
    expect(result.outcome).toBe("blocked");
    expect(result.required_checks).toEqual([
      expect.objectContaining({ context: LINT_CHECK, state: NOT_READY }),
    ]);
    expect(result.required_checks[0]?.detail).toMatch(
      /on `main` or on the pull requests most recently merged into it/u
    );
  });

  it("is never read from the head of a pull request that was not merged", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      reported: [],
      pulls: [
        { checks: [LINT_CHECK], state: "open" },
        { checks: [LINT_CHECK], merged: false },
        ["Unrelated"],
      ],
    });

    await protect(repository(), github, APPLY);

    expect(
      github.log
        .map(request => request.path)
        .filter(path => path.includes("c0ffee"))
    ).toEqual([
      `${COMMITS}/03c0ffee${"0".repeat(32)}/check-runs?per_page=100`,
      `${COMMITS}/03c0ffee${"0".repeat(32)}/status?per_page=100`,
    ]);
  });
});

describe("a check that something else reports under the same name", () => {
  it("is not written when only another app reported it, and says who did", async () => {
    const repoPath = repository();
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      reported: [{ name: LINT_CHECK, appId: ANOTHER_APP }],
    });

    const result = await protect(repoPath, github, APPLY);

    expect(github.writes()).toEqual([]);
    expect(result.outcome).toBe("blocked");
    expect(result.required_checks[0]?.state).toBe(NOT_READY);
    expect(result.required_checks[0]?.detail).toContain(ANOTHER);
    expect(result.required_checks[0]?.detail).toContain("GitHub Actions");
    expect(handover(repoPath)).toContain(ANOTHER);
  });

  it("is not written when it was only reported as a commit status, which names no app", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      reported: [],
      reportedStatuses: [LINT_CHECK],
    });

    const result = await protect(repository(), github, APPLY);

    expect(github.writes()).toEqual([]);
    expect(result.required_checks[0]?.state).toBe(NOT_READY);
    expect(result.required_checks[0]?.detail).toMatch(
      /from a commit status, not from GitHub Actions/u
    );
    // Nothing awaits a check a pipeline job reports, so there is no app to
    // declare for it: the step is to let the pipeline run.
    expect(result.required_checks[0]?.detail).not.toMatch(/posted_by/u);
    expect(result.required_checks[0]?.detail).toMatch(
      /Merge the workflow that reports it and let it run once/u
    );
  });

  it.each([
    ["on the gate that awaits it", { gates: F_PAVED_GATES }],
    [
      "under the required checks of a ruleset",
      {
        gates: AWAITED_FROM_ANYONE,
        config: {
          github: {
            rulesets: {
              requiredChecks: {
                "quality checks": [{ context: REVIEW, integration_id: 4242 }],
              },
            },
          },
        },
      },
    ],
  ] as const)(
    "does not say to name a commit status for a check whose app is declared %s",
    async (_where, options) => {
      const repoPath = repository(options);
      const github = fakeGithub({
        repo: REPO,
        admin: true,
        reported: [LINT_CHECK],
        reportedStatuses: [REVIEW],
      });

      const result = await protect(repoPath, github, APPLY);

      expect(sentAsRequired(github)).toEqual([LINT_CHECK]);
      const review = result.required_checks.find(
        check => check.context === REVIEW
      );
      expect(review?.state).toBe(NOT_READY);
      expect(review?.detail).toMatch(
        /from a commit status, not from app 4242/u
      );
      expect(review?.detail).not.toMatch(/name it/u);
      expect(review?.detail).toMatch(
        /declare the check without an app in \.lisa\.config\.json/u
      );
      expect(review?.detail).toMatch(/have app 4242 report it as a check run/u);
      expect(handover(repoPath)).toContain(
        "declare the check without an app in .lisa.config.json"
      );
    }
  );

  it("is written once the operator does what the sentence says and declares it without an app", async () => {
    const platform = {
      repo: REPO,
      admin: true,
      reported: [LINT_CHECK],
      reportedStatuses: [REVIEW],
    } as const;
    const pinned = fakeGithub(platform);
    const open = fakeGithub(platform);

    await protect(repository({ gates: F_PAVED_GATES }), pinned, APPLY);
    await protect(repository({ gates: AWAITED_FROM_ANYONE }), open, APPLY);

    expect(sentAsRequired(pinned)).not.toContain(REVIEW);
    expect(sentChecks(open)).toContainEqual({ context: REVIEW });
  });

  it("is left out when the app the declaration names never reported the awaited check", async () => {
    const repoPath = repository({ gates: F_PAVED_GATES });
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      reported: [LINT_CHECK, { name: REVIEW, appId: ANOTHER_APP }],
    });

    const result = await protect(repoPath, github, APPLY);

    expect(sentAsRequired(github)).toEqual([LINT_CHECK]);
    const review = result.required_checks.find(
      check => check.context === REVIEW
    );
    expect(review?.state).toBe(NOT_READY);
    expect(review?.detail).toContain(ANOTHER);
    expect(review?.detail).toContain("app 4242");
  });
});

describe("an awaited check whose declaration names no app", () => {
  it("is written for any source when it was reported as a commit status", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      reported: [LINT_CHECK],
      reportedStatuses: [REVIEW],
    });

    await protect(repository({ gates: AWAITED_FROM_ANYONE }), github, APPLY);

    expect(sentChecks(github)).toContainEqual({ context: REVIEW });
    expect(sentChecks(github)).toContainEqual({
      context: LINT_CHECK,
      integration_id: ACTIONS_APP_ID,
    });
  });

  it("is written for any source when some app reported it", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      reported: [LINT_CHECK, { name: REVIEW, appId: ANOTHER_APP }],
    });

    await protect(repository({ gates: AWAITED_FROM_ANYONE }), github, APPLY);

    expect(sentChecks(github)).toContainEqual({ context: REVIEW });
  });
});
