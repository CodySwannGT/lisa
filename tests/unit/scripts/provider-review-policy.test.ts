/** Provider selection, native objections, and workflow publication. */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { postAgentReview } from "../../../all/copy-overwrite/scripts/post-agent-review.mjs";
import { reviewApi } from "../../../all/copy-overwrite/scripts/lib/review-policy-reader.mjs";
import { agentMarker } from "../../../all/copy-overwrite/scripts/lib/review-providers/agent.mjs";
import { runReviewPolicyEvent } from "../../../all/copy-overwrite/scripts/review-policy-event.mjs";
import { verifyReviewPolicyRun } from "../../../all/copy-overwrite/scripts/check-review-policy-run.mjs";
import { useOwnedTempDirs } from "../../helpers/owned-temp-dirs.js";

const ownedDir = useOwnedTempDirs();
const HEAD = "a".repeat(40);
const SOURCE = "b".repeat(40);
const REPO = "test/example";
const TIME = "2026-11-03T12:00:00Z";
const REVIEWER = { id: 53, login: "reviewer", type: "User" };
const AUTHOR = { id: 31, login: "author", type: "User" };
const PULL = {
  number: 19,
  state: "open",
  draft: false,
  user: AUTHOR,
  head: { sha: HEAD },
  base: { ref: "main", repo: { id: 500 } },
  labels: [],
};
const REPORT_TEXT =
  "Reviewed the error path and checked that the caller cannot advance while the required evidence is absent.";
const PACKET = {
  schema_version: 1,
  provider: "agent",
  head_sha: HEAD,
  status: "completed",
  source_session: "implementation-session",
  reviewer_session: "review-session",
  scope: ["src/verification.ts"],
  review: REPORT_TEXT,
  findings: [],
  review_sha256: createHash("sha256").update(REPORT_TEXT).digest("hex"),
};
const REVIEW = {
  id: 61,
  commit_id: HEAD,
  submitted_at: TIME,
  state: "COMMENTED",
  user: REVIEWER,
  body: `${agentMarker(HEAD)}\n${JSON.stringify(PACKET)}`,
};
const PRIOR_OBJECTION = {
  id: 62,
  commit_id: "c".repeat(40),
  submitted_at: TIME,
  state: "CHANGES_REQUESTED",
  user: { id: 54, login: "second-reviewer", type: "User" },
  body: "An earlier review asked for a fix that still needs confirmation.",
};
const EVENT_ENV = {
  GITHUB_REPOSITORY: REPO,
  GITHUB_RUN_ID: "1001",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_SHA: SOURCE,
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "workflow_dispatch",
};
const EVENT = { inputs: { pr: "19", sha: HEAD } };
const ROOT = `repos/${REPO}`;
const PULL_ROUTE = `${ROOT}/pulls/19`;
const REVIEW_PAGE = `${PULL_ROUTE}/reviews?per_page=100`;
const STATUS_ROUTE = `${ROOT}/commits/${HEAD}/statuses?per_page=100`;
const RUN_ENDPOINT = `${ROOT}/check-runs`;
const HEAD_PULLS = `${ROOT}/commits/${HEAD}/pulls?per_page=100`;

/** Set up the evaluator with complete native-shaped reads and a captured check write.
 * @param review - Governing policy.
 * @param reviews - Submitted reviews across all PR heads.
 * @param pull - Native pull request metadata.
 * @returns Isolated source and API function.
 */
function hostedFixture(review: object, reviews = [REVIEW], pull = PULL) {
  const root = ownedDir("lisa-review-policy-");
  writeFileSync(join(root, ".lisa.config.json"), JSON.stringify({ review }));
  const api = vi.fn<typeof reviewApi>(([route], payload): unknown => {
    if (route === ROOT)
      return { id: 500, full_name: REPO, default_branch: "main" };
    if (route === `${ROOT}/branches/main`)
      return { name: "main", commit: { sha: SOURCE } };
    if (route === PULL_ROUTE) return pull;
    if (route === HEAD_PULLS) return [[pull]];
    if (route === REVIEW_PAGE) return [reviews];
    if (route === "graphql")
      return {
        data: {
          repository: {
            pullRequest: {
              headRefOid: HEAD,
              reviewDecision: null,
              reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
            },
          },
        },
      };
    if (
      [REVIEWER, AUTHOR].some(
        user => route === `${ROOT}/collaborators/${user.login}/permission`
      )
    )
      return { permission: "write" };
    if (route === STATUS_ROUTE)
      return [
        [
          {
            id: 15,
            context: "CodeRabbit",
            created_at: TIME,
            creator: { id: 136622811, type: "Bot" },
            state: "success",
            description: "Review rate limited",
          },
        ],
      ];
    if (route?.startsWith(`${ROOT}/commits/${HEAD}/check-runs?`))
      return [{ total_count: 0, check_runs: [] }];
    if (route === RUN_ENDPOINT)
      return { ...(payload as object), id: 640, app: { id: 15368 } };
    throw new Error(`Unexpected native API read ${route}`);
  });
  return { root, api };
}

describe("provider-neutral hosted review policy", () => {
  it("enforces an explicitly pinned reviewer and refuses an unknown policy setting", () => {
    const pinned = hostedFixture({
      providers: ["agent"],
      adapters: { agent: { actorId: 22 } },
    });
    const verdict = runReviewPolicyEvent({
      ...pinned,
      env: EVENT_ENV,
      event: EVENT,
    });
    expect(verdict.checks[0]?.conclusion).toBe("failure");

    const invalid = hostedFixture({
      providers: ["agent"],
      minimumApprovals: 2,
    });
    expect(() =>
      runReviewPolicyEvent({ ...invalid, env: EVENT_ENV, event: EVENT })
    ).toThrow("unknown setting");
  });
  it.each([["agent"], ["agent", "coderabbit"]])(
    "credits independent agent evidence under %j",
    (...providers) => {
      const fixture = hostedFixture({ providers });
      const result = runReviewPolicyEvent({
        ...fixture,
        env: EVENT_ENV,
        event: EVENT,
      });

      expect(result.checks).toEqual([
        {
          pr: 19,
          head: HEAD,
          check: 640,
          conclusion: "success",
          providers: ["agent"],
        },
      ]);
      expect(fixture.api).toHaveBeenCalledWith(
        [RUN_ENDPOINT, "--method", "POST", "--input", "-"],
        expect.objectContaining({
          head_sha: HEAD,
          external_id: `lisa-review-policy:1001:2:19:${HEAD}:${SOURCE}`,
        })
      );
      expect(
        fixture.api.mock.calls.some(([args]) => args[0] === STATUS_ROUTE)
      ).toBe(false);
    }
  );

  it("credits a separate agent session posted through the pull request author's account", () => {
    const fixture = hostedFixture({ providers: ["agent"] }, [
      { ...REVIEW, user: AUTHOR },
    ]);
    const result = runReviewPolicyEvent({
      ...fixture,
      env: EVENT_ENV,
      event: EVENT,
    });

    expect(result.checks[0]).toMatchObject({
      conclusion: "success",
      providers: ["agent"],
      head: HEAD,
    });
  });

  it("withholds credit when the explicitly required provider has no review", () => {
    const fixture = hostedFixture({
      providers: ["agent", "coderabbit"],
      requiredProviders: ["coderabbit"],
    });
    const result = runReviewPolicyEvent({
      ...fixture,
      env: EVENT_ENV,
      event: EVENT,
    });

    expect(result.checks[0]?.conclusion).toBe("failure");
    expect(
      fixture.api.mock.calls.some(([args]) => args[0] === STATUS_ROUTE)
    ).toBe(true);
  });

  it("carries a standing objection across pushes", () => {
    const fixture = hostedFixture({ providers: ["agent"] }, [
      PRIOR_OBJECTION,
      REVIEW,
    ]);
    const result = runReviewPolicyEvent({
      ...fixture,
      env: EVENT_ENV,
      event: EVENT,
    });

    expect(result.checks[0]?.conclusion).toBe("failure");
    expect(fixture.api).toHaveBeenCalledWith(
      [RUN_ENDPOINT, "--method", "POST", "--input", "-"],
      expect.objectContaining({
        output: expect.objectContaining({
          summary: expect.stringContaining("a review still asks for changes"),
        }),
      })
    );
  });

  it("refuses a review set that changes while reading the verdict", () => {
    const fixture = hostedFixture({ providers: ["agent"] });
    const original = fixture.api.getMockImplementation()!;
    const reviews = vi
      .fn(() => [[REVIEW, PRIOR_OBJECTION]])
      .mockReturnValueOnce([[REVIEW]]);
    fixture.api.mockImplementation((args, payload) =>
      args[0] === REVIEW_PAGE ? reviews() : original(args, payload)
    );
    const result = runReviewPolicyEvent({
      ...fixture,
      env: EVENT_ENV,
      event: EVENT,
    });
    expect(result.checks[0]?.conclusion).toBe("failure");
    expect(reviews).toHaveBeenCalledTimes(2);
  });

  it.each([{ draft: true }, { labels: [{ name: "lisa:hold" }] }])(
    "honors a late hold in the final pull request read (%j)",
    change => {
      const fixture = hostedFixture({ providers: ["agent"] });
      const original = fixture.api.getMockImplementation()!;
      const pulls = vi.fn(() => ({ ...PULL, ...change }));
      for (const _ of [1, 2, 3]) pulls.mockReturnValueOnce(PULL);
      fixture.api.mockImplementation((args, payload) =>
        args[0] === PULL_ROUTE ? pulls() : original(args, payload)
      );
      const result = runReviewPolicyEvent({
        ...fixture,
        env: EVENT_ENV,
        event: EVENT,
      });
      expect(result.checks[0]?.conclusion).toBe("failure");
    }
  );

  it("matches a Greptile phrase with surrounding spaces in the policy", () => {
    const fixture = hostedFixture(
      {
        providers: ["greptile"],
        adapters: { greptile: { actorId: 81, proof: [" Review complete "] } },
      },
      [
        {
          ...REVIEW,
          user: { id: 81, login: "greptile[bot]", type: "Bot" },
          body: "Review complete\n",
        },
      ]
    );
    const result = runReviewPolicyEvent({
      ...fixture,
      env: EVENT_ENV,
      event: EVENT,
    });
    expect(result.checks[0]).toMatchObject({
      conclusion: "success",
      providers: ["greptile"],
    });
  });

  it("rereads a fork's current head after a native review activity signal", () => {
    const fork = { id: 901, owner: { login: "review-fork" } };
    const pull = { ...PULL, head: { sha: HEAD, ref: "fix/topic", repo: fork } };
    const fixture = hostedFixture({ providers: ["agent"] }, [REVIEW], pull);
    const original = fixture.api.getMockImplementation()!;
    const source = `${ROOT}/pulls?state=open&head=review-fork%3Afix%2Ftopic&per_page=100`;
    fixture.api.mockImplementation((args, payload) =>
      args[0] === source ? [[pull]] : original(args, payload)
    );
    const result = runReviewPolicyEvent({
      ...fixture,
      env: { ...EVENT_ENV, GITHUB_EVENT_NAME: "workflow_run" },
      event: {
        action: "requested",
        workflow_run: {
          event: "pull_request_review",
          repository: { id: 500 },
          path: ".github/workflows/review-policy-activity.yml",
          head_repository: fork,
          head_branch: "fix/topic",
          head_sha: SOURCE,
          pull_requests: [],
        },
      },
    });
    expect(result.checks[0]).toMatchObject({
      head: HEAD,
      conclusion: "success",
    });
  });

  it("publishes nothing from a branch other than the governing default branch", () => {
    const fixture = hostedFixture({ providers: ["agent"] });

    expect(() =>
      runReviewPolicyEvent({
        ...fixture,
        env: { ...EVENT_ENV, GITHUB_REF: "refs/heads/topic" },
        event: EVENT,
      })
    ).toThrow("default branch");
    expect(
      fixture.api.mock.calls.some(([args]) => args[0] === RUN_ENDPOINT)
    ).toBe(false);
  });

  it("publishes nothing for a replaced pull request head", () => {
    const fixture = hostedFixture({ providers: ["agent"] }, [REVIEW], {
      ...PULL,
      head: { sha: SOURCE },
    });
    const result = runReviewPolicyEvent({
      ...fixture,
      env: EVENT_ENV,
      event: EVENT,
    });

    expect(result.checks).toEqual([]);
    expect(
      fixture.api.mock.calls.some(([args]) => args[0] === RUN_ENDPOINT)
    ).toBe(false);
  });
});

describe("native agent review publication", () => {
  it("submits and verifies a review comment through the pull request author's account", () => {
    const review = { ...REVIEW, user: AUTHOR };
    const api = vi.fn<typeof reviewApi>(([route]): unknown => {
      if (route === PULL_ROUTE) return PULL;
      if (route === "user") return AUTHOR;
      if (route === `${ROOT}/collaborators/${AUTHOR.login}/permission`)
        return { permission: "write" };
      if (route === REVIEW_PAGE) return [[]];
      if (
        [
          `${PULL_ROUTE}/reviews`,
          `${PULL_ROUTE}/reviews/${review.id}`,
        ].includes(route!)
      )
        return review;
      throw new Error(`Unexpected native API read ${route}`);
    });

    expect(
      postAgentReview({ repo: REPO, pr: 19, packet: PACKET, api })
    ).toEqual({
      reviewId: review.id,
      head: HEAD,
      reviewerId: AUTHOR.id,
    });
    expect(api).toHaveBeenCalledWith(
      [`${PULL_ROUTE}/reviews`, "--method", "POST", "--input", "-"],
      {
        commit_id: HEAD,
        event: "COMMENT",
        body: review.body,
      }
    );
  });

  it("reuses a verified identical submitted review on retry", () => {
    const api = vi.fn<typeof reviewApi>(([route]): unknown => {
      if (route === PULL_ROUTE) return PULL;
      if (route === "user") return REVIEWER;
      if (route === `${ROOT}/collaborators/reviewer/permission`)
        return { permission: "write" };
      if (route === REVIEW_PAGE) return [[REVIEW]];
      if (route === `${PULL_ROUTE}/reviews/61`) return REVIEW;
      throw new Error(`Unexpected native API read ${route}`);
    });

    expect(
      postAgentReview({ repo: REPO, pr: 19, packet: PACKET, api })
    ).toEqual({ reviewId: 61, head: HEAD, reviewerId: REVIEWER.id });
    expect(api.mock.calls.every(([args]) => !args.includes("POST"))).toBe(true);
  });
});

describe("proof of native workflow authorization", () => {
  const repository = { id: 500, full_name: REPO, default_branch: "main" };
  const workflowPath = ".github/workflows/review-policy.yml";
  const run = {
    id: 1001,
    run_attempt: 2,
    status: "completed",
    conclusion: "success",
    repository,
    head_repository: repository,
    path: workflowPath,
    workflow_id: 51,
    head_branch: "main",
    display_title: "Lisa review policy PR 19",
    head_sha: SOURCE,
    event: "workflow_dispatch",
    created_at: TIME,
  };
  const job = {
    name: "Evaluate review policy",
    run_id: run.id,
    head_sha: SOURCE,
    status: "completed",
    conclusion: "success",
    steps: [
      {
        name: `Review policy result PR 19 head ${HEAD} check 640 success`,
        status: "completed",
        conclusion: "success",
      },
    ],
  };
  const check = {
    id: 640,
    name: "🕵️ Review policy verdict",
    status: "completed",
    conclusion: "success",
    app: { id: 15368 },
    head_sha: HEAD,
    external_id: `lisa-review-policy:1001:2:19:${HEAD}:${SOURCE}`,
    details_url: `https://github.com/${REPO}/actions/runs/1001/attempts/2`,
  };
  const runPath = `${ROOT}/actions/runs/1001`;
  const jobPath = `${runPath}/attempts/2/jobs?per_page=100`;
  const checkPath = `${RUN_ENDPOINT}/640`;
  const latestPath = `${ROOT}/commits/${HEAD}/check-runs?check_name=${encodeURIComponent(check.name)}&filter=latest&per_page=100`;
  const runsPath = `${ROOT}/actions/workflows/51/runs?branch=main&created=${encodeURIComponent(`>=${TIME}`)}&per_page=100`;
  const verify = { repo: REPO, pr: 19, head: HEAD, runId: run.id };

  /** Native workflow, job and head reads for one owned decision.
   * @param changes - Responses to vary for a control.
   * @returns An isolated GitHub API stand-in.
   */
  function nativeFixture(changes: Readonly<Record<string, unknown>> = {}) {
    const responses: Readonly<Record<string, unknown>> = {
      [ROOT]: repository,
      [`${ROOT}/actions/workflows/review-policy.yml`]: {
        id: 51,
        state: "active",
        path: workflowPath,
      },
      [runPath]: run,
      [jobPath]: [{ total_count: 1, jobs: [{ ...job, id: 710 }] }],
      [checkPath]: check,
      [latestPath]: [{ total_count: 1, check_runs: [check] }],
      [runsPath]: [{ total_count: 1, workflow_runs: [run] }],
      [PULL_ROUTE]: PULL,
      [HEAD_PULLS]: [[PULL]],
      [`${ROOT}/branches/main`]: { name: "main", commit: { sha: SOURCE } },
      ...changes,
    };
    return vi.fn<typeof reviewApi>(([route]) => {
      if (route === undefined || !Object.hasOwn(responses, route))
        throw new Error(`Unexpected native API read ${route}`);
      return responses[route];
    });
  }

  it("accepts the receipt from the exact default-branch run and attempt", () => {
    expect(verifyReviewPolicyRun(verify, nativeFixture())).toEqual({
      verified: true,
      ...verify,
      attempt: 2,
      checkId: 640,
      source: SOURCE,
    });
  });

  it("requires the native receipt even when the posted check looks genuine", () => {
    const api = nativeFixture({
      [jobPath]: [{ total_count: 1, jobs: [{ ...job, id: 710, steps: [] }] }],
    });

    expect(() => verifyReviewPolicyRun(verify, api)).toThrow(
      "no successful verdict"
    );
    expect(api.mock.calls.some(([args]) => args[0] === checkPath)).toBe(false);
  });

  it("refuses a result copied from a newer or different attempt", () => {
    const api = nativeFixture({
      [checkPath]: {
        ...check,
        external_id: `lisa-review-policy:1001:3:19:${HEAD}:${SOURCE}`,
      },
    });

    expect(() => verifyReviewPolicyRun(verify, api)).toThrow("does not match");
  });

  it("requires re-evaluation after the default branch advances", () => {
    const api = nativeFixture({
      [`${ROOT}/branches/main`]: { name: "main", commit: { sha: HEAD } },
    });

    expect(() => verifyReviewPolicyRun(verify, api)).toThrow(
      "default branch advanced"
    );
  });

  it("refuses an older green receipt after a review change posts red", () => {
    const api = nativeFixture({
      [latestPath]: [
        {
          total_count: 1,
          check_runs: [{ ...check, id: 641, conclusion: "failure" }],
        },
      ],
    });
    expect(() => verifyReviewPolicyRun(verify, api)).toThrow(
      "newer or unreadable policy verdict"
    );
  });
});
