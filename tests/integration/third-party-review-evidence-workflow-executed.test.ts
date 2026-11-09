/**
 * The evidence workflow's own steps, executed: the prover step, then the step
 * that publishes its verdict on the head it judged.
 *
 * A `status` or `check_run` run belongs to the default branch's latest commit,
 * so the job's own check run lands there and no pull request ever showed the
 * verdict (CodySwannGT/lisa#4630). The shipped step scripts run here in order,
 * against a host-shaped folder and a controlled GitHub, so "the run's head SHA
 * as --sha and its name as --context", the check run published on that head,
 * and the job's own conclusion are all observed rather than read off the YAML.
 * @module tests/integration/third-party-review-evidence-workflow-executed
 */
import { describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  HEAD,
  type Observations,
  RATE_LIMITED_SUMMARY,
  rawCheckRun,
  REVIEWER,
  substituteComment,
} from "../helpers/third-party-review-cli-fixture.js";
import {
  contexts,
  COPIES,
  OTHER_APP_CHECK,
  reviewerCheckRun,
} from "../helpers/third-party-review-workflow.js";
import {
  executeSteps,
  publishedRuns,
} from "../helpers/third-party-review-workflow-steps.js";

useIoLatencyBudget();

/** The environment every executed step inherits. */
const ENV = process.env;

/**
 * Execute one copy's steps under this suite's environment.
 * @param copy - Repository-relative workflow path
 * @param event - The event's contexts
 * @param observations - What GitHub shows at the head
 * @param proverAt - Where the folder holds the prover
 * @returns The job's exit, log, summary and calls
 */
const execute = (
  copy: string,
  event: Record<string, unknown>,
  observations: Observations,
  proverAt: "host" | "in-repo-template" = "host"
) => executeSteps(copy, event, observations, ENV, proverAt);

/** The reviewer's rate-limited run, with nothing in its place. */
const RATE_LIMITED_ONLY: Observations = {
  checkRuns: [
    rawCheckRun({
      conclusion: "neutral",
      output: { title: "Review rate limited", summary: RATE_LIMITED_SUMMARY },
    }),
  ],
};

/** The check run name a reviewer-woken run publishes under. */
const PUBLISHED_NAME = `🕵️ Third-party review evidence (${REVIEWER})`;

describe.each(COPIES)("%s, executed", copy => {
  it("publishes the reviewer's completed review on the head it judged", () => {
    const result = execute(copy, reviewerCheckRun(), {
      checkRuns: [rawCheckRun()],
    });

    expect(result.status).toBe(0);
    expect(result.log).toContain(`SATISFIED at ${HEAD}`);
    expect(publishedRuns(result)).toEqual([
      {
        name: PUBLISHED_NAME,
        head_sha: HEAD,
        status: "completed",
        conclusion: "success",
        output: {
          title: `SATISFIED at ${HEAD}`,
          summary: expect.stringContaining(`reviewed     ${REVIEWER}`),
        },
      },
    ]);
  });

  it("publishes a failure on the head, and concludes success, for the reviewer's rate-limited run", () => {
    // The failure belongs to the pull request head. The job's own check run
    // lands on the default branch, which must stop carrying other heads'
    // verdicts — so the job concludes success once the verdict is published.
    const result = execute(copy, reviewerCheckRun(), RATE_LIMITED_ONLY);

    expect(result.status).toBe(0);
    expect(result.log).toContain(`UNSATISFIED at ${HEAD}`);
    const [published] = publishedRuns(result);
    expect(published).toMatchObject({
      name: PUBLISHED_NAME,
      head_sha: HEAD,
      status: "completed",
      conclusion: "failure",
      output: { title: `UNSATISFIED at ${HEAD}` },
    });
    expect(published?.output.summary).toContain("Review rate limited");
    expect(result.summary).toContain(`UNSATISFIED at ${HEAD}`);
  });

  it("publishes a writer's substitute as a success whose title says it was substituted", () => {
    const result = execute(copy, reviewerCheckRun(), {
      ...RATE_LIMITED_ONLY,
      comments: [substituteComment(REVIEWER, HEAD)],
    });

    expect(result.status).toBe(0);
    expect(publishedRuns(result)).toEqual([
      expect.objectContaining({
        conclusion: "success",
        output: expect.objectContaining({ title: `SUBSTITUTED at ${HEAD}` }),
      }),
    ]);
  });

  it("names the manual path's check run without a reviewer", () => {
    const result = execute(
      copy,
      contexts("workflow_dispatch", { inputs: { sha: HEAD } }, { sha: HEAD }),
      { checkRuns: [rawCheckRun()] }
    );

    expect(result.status).toBe(0);
    expect(publishedRuns(result).map(run => run.name)).toEqual([
      "🕵️ Third-party review evidence",
    ]);
  });

  it("stays an explicit no-op that publishes nothing for a check run from an app nobody declared", () => {
    const result = execute(copy, reviewerCheckRun(HEAD, OTHER_APP_CHECK), {
      checkRuns: [rawCheckRun()],
    });

    expect(result.status).toBe(0);
    expect(result.log).toContain("NO-OP");
    expect(result.log).toContain("Nothing published");
    expect(result.calls).toEqual([]);
  });

  it("publishes nothing, and says why, for a commit that heads no open pull request", () => {
    const result = execute(copy, reviewerCheckRun(), {
      checkRuns: [rawCheckRun()],
      pulls: [],
    });

    expect(result.status).toBe(0);
    expect(result.log).toContain("Nothing published");
    expect(result.log).toContain("not the head of any open pull request");
    expect(publishedRuns(result)).toEqual([]);
  });

  it("fails the job and shows the refusal when GitHub refuses the check run", () => {
    const refusal = "HTTP 403: Resource not accessible by integration";
    const result = execute(copy, reviewerCheckRun(), {
      checkRuns: [rawCheckRun()],
      publishResponse: { __refuse__: refusal },
    });

    expect(result.status).not.toBe(0);
    expect(result.log).toContain(refusal);
    expect(result.log).toContain("not published");
  });

  it("fails the job, publishing nothing, when the prover gives no verdict", () => {
    // A run that cannot name its repository is a usage error: the prover
    // exits 2 and writes no report, which is broken machinery, never a
    // verdict to publish.
    const event = reviewerCheckRun();
    const result = execute(
      copy,
      {
        ...event,
        github: { ...(event.github as object), repository: "" },
      },
      { checkRuns: [rawCheckRun()] }
    );

    expect(result.status).not.toBe(0);
    expect(result.log).toContain("exited 2");
    expect(publishedRuns(result)).toEqual([]);
  });
});

describe("this repository's own copy, executed as its checkout runs it", () => {
  it("falls back to the in-repo template when no installed prover exists", () => {
    // This repository installs no copy under scripts/, so its own job always
    // takes the template path; a broken fallback must fail here, not pass.
    const result = execute(
      COPIES[0],
      reviewerCheckRun(),
      { checkRuns: [rawCheckRun()] },
      "in-repo-template"
    );

    expect(result.status).toBe(0);
    expect(result.log).toContain("Using the in-repo template");
    expect(result.log).toContain(`SATISFIED at ${HEAD}`);
    expect(publishedRuns(result)).toHaveLength(1);
  });
});
