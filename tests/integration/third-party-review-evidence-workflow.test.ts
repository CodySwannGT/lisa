/**
 * The evidence workflow wakes on the reviewer's completed check run, and
 * publishes its verdict on the head it judged.
 *
 * Both copies — this repository's own and the create-only seed Lisa ships —
 * started only on `status` events. The reviewer this repository declares now
 * reports only as a check run, which fires no status event, so the workflow
 * had not run since 2026-10-27 (CodySwannGT/lisa#4553). A fix that only taught
 * the prover to read check runs would have left it dead.
 *
 * The cases evaluate the shipped `if:`, `env:`, checkout and concurrency
 * expressions with GitHub's own expression interpreter against each event's
 * payload. The shipped steps themselves are executed in
 * `third-party-review-evidence-workflow-executed.test.ts`.
 * @module tests/integration/third-party-review-evidence-workflow
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  isCurrentEvidenceSeed,
  readEvidenceSeed,
} from "../../src/core/third-party-evidence-seed.js";
import {
  githubCondition,
  githubTemplate,
} from "../helpers/github-expression.js";
import {
  HEAD,
  OTHER_HEAD,
  REVIEWER,
} from "../helpers/third-party-review-observations.js";
import {
  contexts,
  COPIES,
  type EvidenceWorkflow,
  OTHER_APP_CHECK,
  proverStep,
  publishStep,
  reviewerCheckRun,
  workflowOf,
} from "../helpers/third-party-review-workflow.js";

const ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * What the workflow does for one event: whether the job runs, and the commit,
 * reviewer and concurrency group it resolves.
 * @param workflow - A parsed copy
 * @param event - The event's contexts
 * @returns The resolved values
 */
function resolve(workflow: EvidenceWorkflow, event: Record<string, unknown>) {
  const { env } = workflow.jobs.evidence;
  return {
    runs: githubCondition(workflow.jobs.evidence.if, event),
    sha: githubTemplate(String(env.EVIDENCE_SHA), event),
    context: githubTemplate(String(env.EVIDENCE_CONTEXT), event),
    group: githubTemplate(workflow.concurrency.group, event),
  };
}

describe.each(COPIES)("%s", copy => {
  const workflow = workflowOf(copy);

  it("wakes on a completed check run, and still on statuses and by hand", () => {
    expect(workflow.on.check_run).toEqual({ types: ["completed"] });
    expect(Object.keys(workflow.on)).toEqual(
      expect.arrayContaining(["status", "workflow_dispatch"])
    );
  });

  it("grants checks: write, to publish the verdict, beside the reads it already had", () => {
    expect(workflow.permissions).toEqual({
      contents: "read",
      statuses: "read",
      checks: "write",
      "pull-requests": "read",
    });
  });

  it("captures the prover's verdict as JSON and hands it to a publish step on the same head", () => {
    const prover = proverStep(workflow);
    const publish = publishStep(workflow);

    expect(prover.id).toBe("prove");
    expect(prover.run).toContain("--json");
    // One commit and one reviewer for both steps: set on the job, so no
    // step can drift from the other.
    expect(Object.keys(workflow.jobs.evidence.env)).toEqual([
      "EVIDENCE_SHA",
      "EVIDENCE_CONTEXT",
    ]);
    for (const step of [prover, publish]) {
      expect(step.env).not.toHaveProperty("EVIDENCE_SHA");
      expect(step.env).not.toHaveProperty("EVIDENCE_CONTEXT");
    }
    // The verdict file travels as an output, and no expression is spliced
    // into a script.
    expect(publish.env).toMatchObject({
      VERDICT: "${{ steps.prove.outputs.verdict }}",
      PROVER_EXIT: "${{ steps.prove.outputs.exit_code }}",
    });
    expect(publish.run).not.toContain("RUNNER_TEMP");
    expect(`${prover.run}${publish.run}`).not.toContain("${{");
  });

  it("reads as current to the check lisa doctor runs on a seeded copy", () => {
    const reading = readEvidenceSeed(
      fs.readFileSync(path.join(ROOT, copy), "utf8")
    );

    expect(reading).toEqual({
      wakesOnCheckRun: true,
      readsChecks: true,
      readsStatusesAndPullRequests: true,
      readsRunIdentity: true,
      keysConcurrencyPerRun: true,
      checksOutEventHead: false,
      declaresPermissions: true,
      writesChecks: true,
      publishesVerdict: true,
      acceptsDispatchContext: true,
    });
    expect(isCurrentEvidenceSeed(reading)).toBe(true);
  });

  it("checks out the default branch, never the head of the event that woke it", () => {
    // Every `status` and `check_run` run starts in this repository's context
    // for any pull request, a fork's included. With no `ref:` the checkout is
    // the default branch, so the code and configuration that judge the head
    // are this repository's own; the head arrives only as --sha.
    const checkout = workflow.jobs.evidence.steps.find(step =>
      step.uses?.startsWith("actions/checkout@")
    );

    expect(checkout).toBeDefined();
    expect(checkout?.with).not.toHaveProperty("ref");
  });

  it("runs on the reviewer's check run with its head SHA and its name", () => {
    expect(resolve(workflow, reviewerCheckRun())).toEqual({
      runs: true,
      sha: HEAD,
      context: REVIEWER,
      group: `third-party-review-evidence-check_run-${HEAD}-${REVIEWER}`,
    });
  });

  it("keeps a status event's commit and context, and its pending deferral", () => {
    const settled = contexts("status", {
      sha: HEAD,
      context: REVIEWER,
      state: "success",
    });
    const pending = contexts("status", {
      sha: HEAD,
      context: REVIEWER,
      state: "pending",
    });

    expect(resolve(workflow, settled)).toMatchObject({
      runs: true,
      sha: HEAD,
      context: REVIEWER,
    });
    expect(resolve(workflow, pending).runs).toBe(false);
  });

  it("keeps the manual path judging every reviewer at the given commit", () => {
    expect(
      resolve(
        workflow,
        contexts("workflow_dispatch", { inputs: { sha: HEAD } }, { sha: HEAD })
      )
    ).toMatchObject({ runs: true, sha: HEAD, context: "" });
  });

  it("takes an optional reviewer on the manual path, beside the commit", () => {
    // A stale `(<context>)` check run can only be overwritten by a run that
    // publishes under the same name (CodySwannGT/lisa#4738).
    const dispatch = workflow.on.workflow_dispatch as {
      inputs: Record<string, Record<string, unknown>>;
    };

    expect(dispatch.inputs.sha).toMatchObject({ required: true });
    expect(dispatch.inputs.context).toEqual({
      description: expect.any(String),
      required: false,
      type: "string",
    });
  });

  it("hands a manual run's reviewer to the prover and keys its concurrency on it", () => {
    const named = contexts(
      "workflow_dispatch",
      { inputs: { sha: HEAD, context: REVIEWER } },
      { sha: HEAD, context: REVIEWER }
    );
    const bare = contexts(
      "workflow_dispatch",
      { inputs: { sha: HEAD } },
      { sha: HEAD }
    );

    expect(resolve(workflow, named)).toEqual({
      runs: true,
      sha: HEAD,
      context: REVIEWER,
      group: `third-party-review-evidence-workflow_dispatch-${HEAD}-${REVIEWER}`,
    });
    expect(resolve(workflow, bare).group).not.toBe(
      resolve(workflow, named).group
    );
  });

  it("keys concurrency per event, head and reviewer, so nothing else cancels the reviewer's run", () => {
    const reviewer = resolve(workflow, reviewerCheckRun()).group;
    const pendingStatus = contexts("status", {
      sha: HEAD,
      context: REVIEWER,
      state: "pending",
    });

    expect(
      resolve(workflow, reviewerCheckRun(HEAD, OTHER_APP_CHECK)).group
    ).not.toBe(reviewer);
    expect(resolve(workflow, reviewerCheckRun(OTHER_HEAD)).group).not.toBe(
      reviewer
    );
    expect(resolve(workflow, pendingStatus).group).not.toBe(reviewer);
  });
});
