/**
 * The evidence workflow wakes on the reviewer's completed check run.
 *
 * Both copies — this repository's own and the create-only seed Lisa ships —
 * started only on `status` events. The reviewer this repository declares now
 * reports only as a check run, which fires no status event, so the workflow
 * had not run since 2026-10-27 (CodySwannGT/lisa#4553). A fix that only taught
 * the prover to read check runs would have left it dead.
 *
 * The cases evaluate the shipped `if:`, `env:`, checkout and concurrency
 * expressions with GitHub's own expression interpreter against each event's
 * payload, then execute the shipped step script itself against a host-shaped
 * folder, so "the run's head SHA as --sha and its name as --context" is
 * observed rather than read off the YAML.
 * @module tests/integration/third-party-review-evidence-workflow
 */
import * as fs from "fs-extra";
import * as os from "node:os";
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
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import {
  HEAD,
  installControlledGitHub,
  installProverAsHost,
  OTHER_HEAD,
  RATE_LIMITED_SUMMARY,
  rawCheckRun,
  REVIEWER,
  type Observations,
} from "../helpers/third-party-review-cli-fixture.js";
import { loadWorkflow } from "../helpers/workflow-test-utils.js";

useIoLatencyBudget();

const ROOT = path.resolve(import.meta.dirname, "../..");

/** Both copies of the workflow, which must answer every case identically. */
const COPIES = [
  ".github/workflows/third-party-review-evidence.yml",
  "typescript/create-only/.github/workflows/third-party-review-evidence.yml",
] as const;

/** A second app that posts check runs on the same heads. */
const OTHER_APP_CHECK = "GitGuardian Security Checks";

/** The parsed parts of the workflow these cases read. */
interface EvidenceWorkflow {
  readonly on: Record<string, unknown>;
  readonly permissions: Record<string, string>;
  readonly concurrency: { readonly group: string };
  readonly jobs: {
    readonly evidence: {
      readonly if: string;
      readonly steps: ReadonlyArray<{
        readonly uses?: string;
        readonly run?: string;
        readonly with?: Record<string, string>;
        readonly env?: Record<string, string>;
      }>;
    };
  };
}

/**
 * Parse one copy of the workflow.
 * @param copy - Repository-relative workflow path
 * @returns The parsed workflow
 */
function workflowOf(copy: string): EvidenceWorkflow {
  return loadWorkflow(path.join(ROOT, copy)) as unknown as EvidenceWorkflow;
}

/**
 * The step that runs the prover.
 * @param workflow - A parsed copy
 * @returns Its prover step
 */
function proverStep(workflow: EvidenceWorkflow) {
  const step = workflow.jobs.evidence.steps.find(candidate =>
    candidate.run?.includes("check-third-party-review-evidence.mjs")
  );
  if (!step?.run || !step.env) throw new Error("no prover step");
  return { run: step.run, env: step.env };
}

/**
 * Workflow contexts for one triggering event.
 * @param eventName - The event that woke the run
 * @param event - Its payload
 * @param inputs - Manual inputs, for `workflow_dispatch`
 * @returns The contexts the expressions read
 */
function contexts(
  eventName: string,
  event: Record<string, unknown>,
  inputs: Record<string, string> = {}
): Record<string, unknown> {
  return {
    github: {
      event_name: eventName,
      event,
      repository: "acme/code",
      token: "fixture-token",
    },
    inputs,
    vars: {},
  };
}

/**
 * A completed check run's event, as GitHub delivers it.
 * @param headSha - The commit the run reported on
 * @param name - The run's name, which is the reviewer's context
 * @returns The event's contexts
 */
const reviewerCheckRun = (headSha = HEAD, name = REVIEWER) =>
  contexts("check_run", {
    action: "completed",
    check_run: {
      name,
      head_sha: headSha,
      status: "completed",
      conclusion: "success",
    },
  });

/**
 * What the workflow does for one event: whether the job runs, and the commit,
 * reviewer and concurrency group it resolves.
 * @param workflow - A parsed copy
 * @param event - The event's contexts
 * @returns The resolved values
 */
function resolve(workflow: EvidenceWorkflow, event: Record<string, unknown>) {
  const { env } = proverStep(workflow);
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

  it("grants checks: read beside the reads it already had", () => {
    expect(workflow.permissions).toEqual({
      contents: "read",
      statuses: "read",
      checks: "read",
      "pull-requests": "read",
    });
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

/**
 * Execute one copy's real step script for one event against a host folder.
 * @param copy - Repository-relative workflow path
 * @param event - The event's contexts
 * @param observations - What GitHub shows at the head
 * @param proverAt - Where the folder holds the prover: a host's `scripts/`,
 *   or only this repository's in-repo template, as its own checkout does
 * @returns The step's exit, output, and the calls it made
 */
function executeStep(
  copy: string,
  event: Record<string, unknown>,
  observations: Observations,
  proverAt: "host" | "in-repo-template" = "host"
) {
  const workflow = workflowOf(copy);
  const { run, env } = proverStep(workflow);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-step-"));
  try {
    installProverAsHost(folder);
    if (proverAt === "in-repo-template") {
      fs.moveSync(
        path.join(folder, "scripts"),
        path.join(folder, "all/copy-overwrite/scripts")
      );
    }
    const github = installControlledGitHub(folder, observations);
    fs.writeFileSync(path.join(folder, "step.sh"), run);
    const stepEnv = Object.fromEntries(
      Object.entries(env).map(([key, value]) => [
        key,
        githubTemplate(String(value), event),
      ])
    );
    const result = boundedSpawnSync({
      label: "the shipped evidence workflow step",
      command: "/bin/bash",
      args: [path.join(folder, "step.sh")],
      cwd: folder,
      env: {
        ...process.env,
        ...stepEnv,
        PATH: [github.bindir, path.dirname(process.execPath), process.env.PATH]
          .filter(Boolean)
          .join(path.delimiter),
      },
      baseMs: 30000,
    });
    return {
      status: result.status,
      stdout: String(result.stdout),
      calls: github.calls(),
    };
  } finally {
    fs.removeSync(folder);
  }
}

describe.each(COPIES)("%s, executed", copy => {
  it("proves the reviewer's completed review when its check run wakes the step", () => {
    const result = executeStep(copy, reviewerCheckRun(), {
      checkRuns: [rawCheckRun()],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`SATISFIED at ${HEAD}`);
  });

  it("goes red on the reviewer's rate-limited check run with nothing in its place", () => {
    const result = executeStep(copy, reviewerCheckRun(), {
      checkRuns: [
        rawCheckRun({
          conclusion: "neutral",
          output: {
            title: "Review rate limited",
            summary: RATE_LIMITED_SUMMARY,
          },
        }),
      ],
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`UNSATISFIED at ${HEAD}`);
    expect(result.stdout).toContain("Review rate limited");
  });

  it("stays an explicit no-op for a check run from an app nobody declared", () => {
    const result = executeStep(copy, reviewerCheckRun(HEAD, OTHER_APP_CHECK), {
      checkRuns: [rawCheckRun()],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NO-OP");
    expect(result.calls).toEqual([]);
  });
});

describe("this repository's own copy, executed as its checkout runs it", () => {
  it("falls back to the in-repo template when no installed prover exists", () => {
    // This repository installs no copy under scripts/, so its own job always
    // takes the template path; a broken fallback must fail here, not pass.
    const result = executeStep(
      COPIES[0],
      reviewerCheckRun(),
      { checkRuns: [rawCheckRun()] },
      "in-repo-template"
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Using the in-repo template");
    expect(result.stdout).toContain(`SATISFIED at ${HEAD}`);
  });
});
