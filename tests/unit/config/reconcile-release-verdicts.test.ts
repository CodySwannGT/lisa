/**
 * What the release reconcile job does for each registry verdict
 * (CodySwannGT/lisa#5106).
 *
 * Run 44743107550 published v8.2.4, but npm took about 55 minutes to serve
 * it, and the publish job's check gave up first. The reconcile job then asked
 * the registry again and got `published`, yet its "File the skipped version"
 * step still filed #5105 ("did not reach npm") and "Refuse to end green" still
 * failed, because neither read the verdict. These cases evaluate every step's
 * `if:` in `reconcile_release` the way Actions would, for each verdict the
 * check can print, and require the steps a verdict should and should not run.
 * @module tests/unit/config/reconcile-release-verdicts
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runBoundedBash } from "../../helpers/bounded-bash.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import { evaluateIf } from "../../helpers/workflow-job-graph.js";

const DEPLOY = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  ".github",
  "workflows",
  "deploy.yml"
);

const PUBLISH_WORKFLOW = path.join(path.dirname(DEPLOY), "publish-to-npm.yml");

/** One step of the reconcile job, as far as these cases read it. */
interface Step {
  readonly name?: string;
  readonly if?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly env?: Record<string, string>;
}

/** One job of a workflow, as far as these cases read it. */
interface Job {
  readonly name?: string;
  readonly permissions?: Record<string, string>;
  readonly steps?: Step[];
}

/**
 * The jobs of one workflow file.
 * @param file - Absolute path to the workflow
 * @returns The workflow's jobs, keyed by job id
 */
function jobsOf(file: string): Record<string, Job> {
  return (
    yaml.load(readFileSync(file, "utf8")) as { jobs: Record<string, Job> }
  ).jobs;
}

const DEPLOY_JOBS = jobsOf(DEPLOY);

const STEPS: readonly Step[] = DEPLOY_JOBS.reconcile_release?.steps ?? [];

/** The step that converts the GitHub Release to a draft. */
const RETRACT = "Retract the GitHub Release that asserts a shipped version";

/** The step that files the "did not reach npm" issue. */
const FILE = "File the skipped version so it outlives this run";

/** The step that fails the job. */
const REFUSE = "Refuse to end green";

/** The step that reports a release that landed after the publish check. */
const LATE = "Report a release that landed after the publish check gave up";

/** The late-landing report's `run:` body. */
const LATE_BODY = STEPS.find(step => step.name === LATE)?.run ?? "exit 99";

/** The words that tell the operator the release needs nothing. */
const NO_ACTION = "Nothing needs doing";

/** The publish job as this run's job record names it. */
const PUBLISH_JOB = "Publish to npm / Publish to npm";

/** The publish job's `npm publish` step. */
const PUBLISH_STEP = "Publish to npm with OIDC";

/** The steps after the registry is asked, which the verdict decides. */
const DECIDED = [RETRACT, LATE, FILE, REFUSE];

/**
 * The verdict-dependent steps that run for one verdict.
 * @param verdict - What the registry check printed
 * @returns The names of the steps that run, in order
 */
function stepsRunFor(verdict: string): readonly string[] {
  const context = { steps: { landed: { outputs: { verdict } } } };
  return STEPS.filter(step => DECIDED.includes(step.name ?? ""))
    .filter(step => evaluateIf(step.if, context))
    .map(step => step.name ?? "");
}

describe("the reconcile job acts on what the registry said (#5106)", () => {
  it("declares every step these cases decide on", () => {
    expect(STEPS.map(step => step.name)).toEqual(
      expect.arrayContaining(DECIDED)
    );
  });

  it("treats `published` as a landed release: no issue, no refusal, a plain report", () => {
    expect(stepsRunFor("published")).toEqual([LATE]);
  });

  it("still retracts, files and refuses on a proven `missing`", () => {
    expect(stepsRunFor("missing")).toEqual([RETRACT, FILE, REFUSE]);
  });

  it("still files and refuses on `unprovable`, and retracts nothing", () => {
    expect(stepsRunFor("unprovable")).toEqual([FILE, REFUSE]);
  });

  it("says the release is good and warns against re-running the publish", () => {
    const report = STEPS.find(step => step.name === LATE)?.run ?? "";

    expect(report).toContain("GITHUB_STEP_SUMMARY");
    expect(report).toContain(NO_ACTION);
    expect(report).toContain("Do not re-run the publish job");
    expect(report).not.toMatch(/exit 1/u);
  });
});

/**
 * What GitHub's "list jobs for a workflow run" endpoint returned for run
 * 44743107550, cut to the publish job and the two steps that matter: npm
 * accepted v8.2.4 when "Publish to npm with OIDC" succeeded at 13:33:04Z, and
 * the publish job's own registry check gave up at 14:12:40Z.
 * @param publishConclusion - The conclusion to give the `npm publish` step
 * @returns The endpoint's JSON body
 */
function runJobs(publishConclusion = "success"): string {
  return JSON.stringify({
    total_count: 1,
    jobs: [
      {
        name: PUBLISH_JOB,
        conclusion: "failure",
        steps: [
          {
            name: PUBLISH_STEP,
            conclusion: publishConclusion,
            started_at: "2026-11-20T13:32:45Z",
            completed_at: "2026-11-20T13:33:04Z",
          },
          {
            name: "Verify the publish reached the registry",
            conclusion: "failure",
            started_at: "2026-11-20T13:33:04Z",
            completed_at: "2026-11-20T14:12:40Z",
          },
        ],
      },
    ],
  });
}

describe("the late-landing report says when npm accepted the version (#5106)", () => {
  let fixture: string;

  beforeEach(async () => {
    fixture = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(fixture);
  });

  /**
   * Run the report step the way Actions runs a `run:` step, with a stand-in
   * `gh` that answers the run's jobs endpoint from a file, or fails.
   * @param jobs - The jobs endpoint's body, or undefined for a failing `gh`
   * @returns The step summary, the step's output, and the args `gh` received
   */
  async function report(
    jobs: string | undefined
  ): Promise<{ summary: string; output: string; ghArgs: string }> {
    const bin = path.join(fixture, "bin");
    const summary = path.join(fixture, "summary.md");
    const ghArgs = path.join(fixture, "gh-args.txt");
    const step = path.join(fixture, "step.sh");
    const driver = path.join(fixture, "driver.sh");
    stage({ bin, summary, ghArgs, step, driver }, jobs);
    return runBoundedBash(driver, {
      cwd: fixture,
      timeoutMs: 15_000,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
        FIXTURE: fixture,
        GH_ARGS: ghArgs,
        STEP_FILE: step,
        RUNNER_TEMP: fixture,
        GITHUB_STEP_SUMMARY: summary,
        GH_TOKEN: "test-token-not-a-secret",
        REPO: "example-owner/example-repo",
        RUN_ID: "44743107550",
        PACKAGE: "@codyswann/lisa",
        VERSION: "8.2.4",
        TAG: "v8.2.4",
        PUBLISH_RESULT: "failure",
      },
    }).then(result => ({
      summary: readFileSync(summary, "utf8"),
      output: result.stdout + result.stderr,
      ghArgs: readFileSync(ghArgs, "utf8"),
    }));
  }

  /**
   * Write the step, its driver and the stand-in `gh` into the fixture.
   * @param files - Where each staged file goes
   * @param files.bin - Directory put first on PATH, holding the stand-in `gh`
   * @param files.summary - The step summary file
   * @param files.ghArgs - Where the stand-in `gh` records its arguments
   * @param files.step - The step's `run:` body
   * @param files.driver - The script that runs the step as Actions would
   * @param jobs - The jobs endpoint's body, or undefined for a failing `gh`
   */
  function stage(
    files: {
      readonly bin: string;
      readonly summary: string;
      readonly ghArgs: string;
      readonly step: string;
      readonly driver: string;
    },
    jobs: string | undefined
  ): void {
    const gh = path.join(files.bin, "gh");
    mkdirSync(files.bin);
    writeFileSync(path.join(fixture, "jobs.json"), jobs ?? "");
    writeFileSync(
      gh,
      jobs === undefined
        ? '#!/bin/sh\necho "$*" >> "$GH_ARGS"\necho "HTTP 403: Resource not accessible by integration" >&2\nexit 1\n'
        : '#!/bin/sh\necho "$*" >> "$GH_ARGS"\ncat "$FIXTURE/jobs.json"\n'
    );
    chmodSync(gh, 0o755);
    writeFileSync(files.summary, "");
    writeFileSync(files.ghArgs, "");
    writeFileSync(files.step, LATE_BODY);
    // Actions runs a bash `run:` step as `bash -e -o pipefail`.
    writeFileSync(files.driver, 'bash -e -o pipefail "$STEP_FILE"');
  }

  it("states the time the publish job's `npm publish` step succeeded", async () => {
    const { summary, output, ghArgs } = await report(runJobs());

    expect(ghArgs).toContain(
      "repos/example-owner/example-repo/actions/runs/44743107550/jobs"
    );
    expect(summary).toContain(
      "npm accepted `8.2.4` at **2026-11-20T13:33:04Z**"
    );
    expect(summary).toContain(NO_ACTION);
    expect(output).toMatch(
      /::notice title=[^:]*::.*npm accepted it at 2026-11-20T13:33:04Z\./u
    );
  });

  it("claims no time when the `npm publish` step did not succeed", async () => {
    const { summary, output } = await report(runJobs("failure"));

    expect(summary).not.toContain("13:33:04");
    expect(output).not.toContain("13:33:04");
    expect(summary).toContain(
      "is not stated here: this run's job record shows no successful `npm publish` step."
    );
  });

  it("says the time is unknown, and still reports, when the run record is unreadable", async () => {
    const { summary, output } = await report(undefined);

    expect(summary).toContain(
      "is not stated here: this run's job record could not be read."
    );
    expect(summary).toContain(NO_ACTION);
    expect(output).toContain("::notice title=");
  });

  it("reads the run record with a token allowed to read it", () => {
    const step = STEPS.find(candidate => candidate.name === LATE);

    expect(DEPLOY_JOBS.reconcile_release?.permissions?.actions).toBe("read");
    expect(step?.env?.GH_TOKEN).toBe("${{ github.token }}");
    expect(step?.env?.RUN_ID).toBe("${{ github.run_id }}");
    expect(step?.env?.REPO).toBe("${{ github.repository }}");
  });

  it("keeps the permissions the retract and file steps need", () => {
    const permissions = DEPLOY_JOBS.reconcile_release?.permissions ?? {};

    expect(permissions.contents).toBe("write");
    expect(permissions.issues).toBe("write");
  });

  it("names a publish job and step that exist, so a rename cannot silently blank the time", () => {
    const publishJobs = Object.values(jobsOf(PUBLISH_WORKFLOW));
    const publishJob = publishJobs.find(job =>
      (job.steps ?? []).some(step => step.name === PUBLISH_STEP)
    );

    expect(DEPLOY_JOBS.publish_npm?.name).toBe("Publish to npm");
    expect(publishJob?.name).toBe("Publish to npm");
    expect(LATE_BODY).toContain(`"${PUBLISH_JOB}"`);
    expect(LATE_BODY).toContain(`"${PUBLISH_STEP}"`);
  });
});
