/**
 * @file npm-publish-verification-workflows.test.ts
 * @description Structural contract binding a release to the registry it claims
 *
 * A working checker nobody calls proves nothing, and the incident this pair
 * exists for (CodySwannGT/lisa#3684) was a whole pipeline reporting success
 * about a version that was never published. Two properties have to hold in the
 * workflows themselves, and neither is visible from the checker's own tests:
 *
 * 1. `publish-to-npm.yml` runs the check AFTER `npm publish`, so a publish that
 *    exits zero without landing cannot reach "Notify on success".
 * 2. `deploy.yml` reconciles afterwards when the publish did not succeed —
 *    including when it was CANCELLED, which is how the real incident's re-run
 *    ended and why the run's conclusion read neither success nor failure.
 *
 * @module tests/unit/config/npm-publish-verification-workflows.test
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { DEFAULT_MAX_RUNTIME_MS } from "../../../all/copy-overwrite/scripts/check-npm-publish-landed.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * Wall time a job needs for everything that is NOT the registry wait.
 *
 * Checkout, Node setup, and — in the reconcile job — the retract and
 * file-an-issue steps that run after the verdict. A cap that clears the
 * checker's runtime by less than this is arithmetically "bigger" and still
 * kills the job before it can act on what it learned.
 */
const JOB_OVERHEAD_MS = 5 * 60_000;

/**
 * GitHub's implicit job timeout when a workflow declares none.
 *
 * A job with no `timeout-minutes` is not uncapped, and treating it as absent
 * would make the assertions below vacuous for exactly the job that carries no
 * declaration today.
 */
const GITHUB_DEFAULT_TIMEOUT_MINUTES = 360;
const CHECKER = "scripts/check-npm-publish-landed.mjs";
const PUBLISH_WORKFLOW = "publish-to-npm.yml";
const DEPLOY_WORKFLOW = "deploy.yml";
const PUBLISH_STEP = "Publish to npm with OIDC";
const VERIFY_STEP = "Verify the publish reached the registry";
const SUCCESS_STEP = "Notify on success";

/** Minimal workflow step fields exercised by this contract. */
interface WorkflowStep {
  /** Condition gating the step. */
  if?: string;
  /** Stable output identifier. */
  id?: string;
  /** Human-readable step name. */
  name?: string;
  /** Shell body. */
  run?: string;
  /** Referenced action. */
  uses?: string;
  /** Action arguments. */
  with?: Record<string, unknown>;
}

/** Minimal workflow job fields exercised by this contract. */
interface WorkflowJob {
  /** Condition gating the job. */
  if?: string;
  /** Wall-clock ceiling GitHub kills the job at. */
  "timeout-minutes"?: number;
  /** Job-level environment, where release identity now enters (#3717). */
  env?: Record<string, string>;
  /** Jobs this one waits for. */
  needs?: string[];
  /** Ordered workflow steps. */
  steps?: WorkflowStep[];
}

/** Parsed subset of a GitHub Actions workflow. */
interface WorkflowDocument {
  /** Jobs keyed by identifier. */
  jobs: Record<string, WorkflowJob>;
}

/**
 * Read one checked-in workflow as text.
 * @param fileName - Workflow file name
 * @returns The workflow source
 */
async function readWorkflowText(fileName: string): Promise<string> {
  return await readFile(
    path.join(REPOSITORY_ROOT, ".github", "workflows", fileName),
    "utf8"
  );
}

/**
 * Parse one checked-in workflow through the same YAML boundary GitHub consumes.
 * @param fileName - Workflow file name
 * @returns Parsed workflow document
 */
async function readWorkflow(fileName: string): Promise<WorkflowDocument> {
  return yaml.load(await readWorkflowText(fileName)) as WorkflowDocument;
}

/**
 * Index of a named step within a job.
 * @param steps - The job's steps
 * @param name - Step name to find
 * @returns Zero-based index, or -1
 */
const indexOfStep = (steps: WorkflowStep[], name: string): number =>
  steps.findIndex(step => step.name === name);

describe("publish-to-npm.yml proves the publish landed", () => {
  it("runs the registry check as a step of the publish job", async () => {
    const workflow = await readWorkflow(PUBLISH_WORKFLOW);
    const steps = workflow.jobs.publish?.steps ?? [];

    const verify = steps[indexOfStep(steps, VERIFY_STEP)];
    expect(verify?.run).toContain(CHECKER);
  });

  it("verifies AFTER publishing and BEFORE reporting success", async () => {
    // Ordering is the assertion. A check placed before `npm publish` would
    // answer about the previous release, and one placed after the success
    // notice would let the pipeline announce a version it never proved.
    const workflow = await readWorkflow(PUBLISH_WORKFLOW);
    const steps = workflow.jobs.publish?.steps ?? [];

    const published = indexOfStep(steps, PUBLISH_STEP);
    const verified = indexOfStep(steps, VERIFY_STEP);
    const notified = indexOfStep(steps, SUCCESS_STEP);

    expect(published).toBeGreaterThan(-1);
    expect(verified).toBeGreaterThan(published);
    expect(notified).toBeGreaterThan(verified);
  });

  it("passes the released version, not whatever the registry calls latest", async () => {
    // The property is unchanged: the check must be told WHICH version to look
    // for, and that version must be the one this release published.
    //
    // The mechanism moved (#3717). The version used to be interpolated into
    // the step's shell source as `${{ inputs.version }}`, which is the
    // template-injection defect that change removes. It now arrives as the
    // job-level `RELEASE_VERSION` environment variable, so the step body no
    // longer contains an expression to grep for.
    //
    // Asserting the BINDING as well as the use is deliberately stronger than
    // the old single grep: `--version "$RELEASE_VERSION"` alone would also be
    // satisfied by a variable bound to something else entirely, which is
    // exactly the "whatever the registry calls latest" failure this names.
    const workflow = await readWorkflow(PUBLISH_WORKFLOW);
    const publish = workflow.jobs.publish;
    const steps = publish?.steps ?? [];

    const verify = steps[indexOfStep(steps, VERIFY_STEP)];
    expect(verify?.run).toContain("--version");
    expect(verify?.run).toContain("$RELEASE_VERSION");
    expect(publish?.env?.["RELEASE_VERSION"]).toContain("inputs.version");
  });

  it("gives the PUBLISH job time for the same wait, whatever it declares", async () => {
    // The binding that was missing. `reconcile_release` runs only AFTER a
    // publish job has already failed; the publish job runs the same checker,
    // with the same defaults, on EVERY release. So the cap that matters most
    // was the one nothing asserted.
    //
    // It declares no `timeout-minutes` today, which is fine — GitHub's implicit
    // 360 clears the runtime comfortably. What was missing is anything that
    // notices if someone later adds a tight one. Reading the declaration as
    // "absent, therefore unbounded" would make this case vacuous for precisely
    // the job it exists to cover, so the implicit default stands in.
    const workflow = await readWorkflow(PUBLISH_WORKFLOW);
    const cap =
      workflow.jobs.publish?.["timeout-minutes"] ??
      GITHUB_DEFAULT_TIMEOUT_MINUTES;

    expect(cap * 60_000 - DEFAULT_MAX_RUNTIME_MS).toBeGreaterThanOrEqual(
      JOB_OVERHEAD_MS
    );
  });

  it("gates the step on nothing, so no condition can quietly switch it off", async () => {
    // A check with an `if:` is a check that can be turned off by whatever the
    // condition reads, which is how a gate becomes decorative.
    const workflow = await readWorkflow(PUBLISH_WORKFLOW);
    const steps = workflow.jobs.publish?.steps ?? [];

    expect(steps[indexOfStep(steps, VERIFY_STEP)]?.if).toBeUndefined();
  });
});

describe("deploy.yml reconciles a release the registry never received", () => {
  it("declares a reconcile job that waits on the publish", async () => {
    const workflow = await readWorkflow(DEPLOY_WORKFLOW);
    const job = workflow.jobs.reconcile_release;

    expect(job).toBeDefined();
    expect(job?.needs).toContain("publish_npm");
    expect(job?.needs).toContain("release");
  });

  it("runs when the publish FAILED and when it was CANCELLED", async () => {
    // `cancelled` is the half that is easy to leave out and was the whole
    // reason the incident stayed hidden: the re-run of the failed publish was
    // cancelled by the next release under the workflow's concurrency group, so
    // the run's conclusion read `cancelled` — neither success nor failure.
    const workflow = await readWorkflow(DEPLOY_WORKFLOW);
    const condition = workflow.jobs.reconcile_release?.if ?? "";

    expect(condition).toContain("always()");
    expect(condition).toContain("needs.publish_npm.result == 'failure'");
    expect(condition).toContain("needs.publish_npm.result == 'cancelled'");
  });

  it("does not run when the publish succeeded", async () => {
    const workflow = await readWorkflow(DEPLOY_WORKFLOW);
    const condition = workflow.jobs.reconcile_release?.if ?? "";

    expect(condition).not.toContain("needs.publish_npm.result == 'success'");
  });

  it("asks the registry itself rather than inferring from the job result", async () => {
    // A failed publish job does not prove the version is absent — the failure
    // may be the verification step, after a publish that landed.
    const workflow = await readWorkflow(DEPLOY_WORKFLOW);
    const steps = workflow.jobs.reconcile_release?.steps ?? [];

    expect(steps.some(step => step.run?.includes(CHECKER) === true)).toBe(true);
  });

  it("retracts the GitHub Release only on a PROVEN miss", async () => {
    // Guarded on `missing`, never on `unprovable`: retracting a release over a
    // registry blip is a false accusation about a version that may install
    // fine, and it is the one direction this job can do harm.
    const workflow = await readWorkflow(DEPLOY_WORKFLOW);
    const steps = workflow.jobs.reconcile_release?.steps ?? [];
    const retract = steps.find(
      step => step.run?.includes("gh release edit") === true
    );

    expect(retract).toBeDefined();
    expect(retract?.if).toBe("steps.landed.outputs.verdict == 'missing'");
  });

  it("files an issue on every non-success, so the record outlives the run", async () => {
    // Unconditional on purpose. The run's own conclusion is what the incident
    // lost — a cancelled re-run erased the failure — so the durable record has
    // to be written for `unprovable` as well as for `missing`.
    const workflow = await readWorkflow(DEPLOY_WORKFLOW);
    const steps = workflow.jobs.reconcile_release?.steps ?? [];
    const file = steps.find(
      step => step.uses?.startsWith("actions/github-script") === true
    );

    expect(file).toBeDefined();
    expect(file?.if).toBeUndefined();
    expect(String(file?.with?.script)).toContain("issues.create");
  });

  it("ends non-zero, so the reconciliation cannot report green", async () => {
    const workflow = await readWorkflow(DEPLOY_WORKFLOW);
    const steps = workflow.jobs.reconcile_release?.steps ?? [];

    expect(steps.at(-1)?.run).toContain("exit 1");
  });

  it("does not narrow the wait with its own --attempts override", async () => {
    // It used to pass `--attempts 3`, about 6 seconds — SHORTER than the
    // default it overrode, and far shorter than the 6m39s propagation measured
    // on 4.64.9. Two windows meant two chances to be too short, and the
    // narrower one was the override. There is one window now, sized beside the
    // measurement that justifies it, and this case is what stops a second one
    // reappearing here.
    const workflow = await readWorkflow(DEPLOY_WORKFLOW);
    const steps = workflow.jobs.reconcile_release?.steps ?? [];
    const ask = steps.find(step => step.run?.includes(CHECKER) === true);

    // Shell comments are stripped first. The comment beside the invocation
    // names the flag it removed, and matching that text would fail this case
    // for saying why — a guard defeated by its own explanation.
    const commands = (ask?.run ?? "")
      .split("\n")
      .filter(line => !line.trimStart().startsWith("#"))
      .join("\n");

    expect(ask).toBeDefined();
    expect(commands).toContain(CHECKER);
    expect(commands).not.toMatch(/--attempts\s/);
    expect(commands).not.toMatch(/--delay-ms\s/);
  });

  it("gives the job more wall time than the checker can possibly RUN", async () => {
    // The trap this closes. A widened wait under a job cap that expires first
    // makes the fix INERT, and worse than inert: the job is killed mid-wait, so
    // the run reads `cancelled` rather than `failure`, and a cancelled run is
    // exactly the state that hid the original incident.
    //
    // Bound to DEFAULT_MAX_RUNTIME_MS, not DEFAULT_WINDOW_MS. That distinction
    // is the whole case. An earlier version of this test asserted the sleeping
    // figure — 37m15s — while the checker can actually run 62m15s once each
    // attempt's own 10s request deadline is counted. The cap was set to 50
    // minutes and this test passed, because it measured the wrong quantity. A
    // hanging registry would have killed the job 12 minutes before the checker
    // could answer, and nothing here would have said so.
    const workflow = await readWorkflow(DEPLOY_WORKFLOW);
    const cap = workflow.jobs.reconcile_release?.["timeout-minutes"];

    expect(cap).toBeDefined();
    expect((cap ?? 0) * 60_000).toBeGreaterThan(
      DEFAULT_MAX_RUNTIME_MS + JOB_OVERHEAD_MS
    );
  });

  it("clears the runtime by enough to still DO something afterwards", async () => {
    // Bare `>` is the same shape of mistake one size down. A cap of 63 minutes
    // exceeds the 62m15s runtime and leaves 45 seconds for checkout, Node
    // setup, the retract step and the file-an-issue step — so the job would be
    // killed just after learning the answer and just before acting on it, and
    // a test asserting only `>` would call that correct.
    //
    // This is the margin clause the checker's own window already carries,
    // applied to the cap: a budget sized to the exact worst case fails on the
    // first thing that is slightly worse.
    const workflow = await readWorkflow(DEPLOY_WORKFLOW);
    const cap = workflow.jobs.reconcile_release?.["timeout-minutes"] ?? 0;

    expect(cap * 60_000 - DEFAULT_MAX_RUNTIME_MS).toBeGreaterThanOrEqual(
      JOB_OVERHEAD_MS
    );
  });
});
