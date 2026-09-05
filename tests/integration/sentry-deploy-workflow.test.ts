/**
 * The release workflow publishes an artifact; deployment is a later fact.
 * These contracts prevent publication from claiming deployment and require a
 * caller to provide positive deploy evidence before Lisa records one (#4004).
 */
import fs from "node:fs";
import path from "node:path";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

/** Workflow step fields this contract reads. */
interface Step {
  readonly name?: string;
  readonly if?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, unknown>>;
}

/** Workflow job fields this contract reads. */
interface Job {
  readonly if?: string;
  readonly steps: readonly Step[];
}

/** Reusable-workflow fields this contract reads. */
interface Workflow {
  readonly on: {
    readonly workflow_call: {
      readonly inputs: Readonly<
        Record<string, { readonly required?: boolean; readonly type?: string }>
      >;
    };
  };
  readonly jobs: Readonly<Record<string, Job>>;
}

const workflow = (name: string): Workflow =>
  load(
    fs.readFileSync(path.join(process.cwd(), ".github/workflows", name), "utf8")
  ) as Workflow;

const namedStep = (job: Job, name: string): Step => {
  const step = job.steps.find(candidate => candidate.name === name);
  if (!step) throw new Error(`missing workflow step: ${name}`);
  return step;
};

const namedJob = (source: Workflow, name: string): Job => {
  const job = source.jobs[name];
  if (!job) throw new Error(`missing workflow job: ${name}`);
  return job;
};

describe("Sentry release and deployment separation", () => {
  it("creates the Sentry release without asserting an environment deploy", () => {
    const release = workflow("release.yml");
    const step = namedStep(
      namedJob(release, "sentry_release"),
      "Create Sentry Release"
    );

    expect(step.with).not.toHaveProperty("environment");
    expect(step.with).toHaveProperty("version");
  });

  it("requires explicit positive deploy evidence before the recorder runs", () => {
    const deploy = workflow("sentry-deploy.yml");
    const evidence = deploy.on.workflow_call.inputs.deployed;
    const job = namedJob(deploy, "sentry_deploy");

    expect(evidence).toMatchObject({ required: true, type: "boolean" });
    expect(job.if).toBe("inputs.deployed == true");
  });

  it("records the deploy separately and skips honestly without credentials", () => {
    const deploy = workflow("sentry-deploy.yml");
    const job = namedJob(deploy, "sentry_deploy");
    const config = namedStep(job, "Check Sentry configuration");
    const record = namedStep(job, "Record deployment");

    expect(config.run).toContain("configured=false");
    expect(record.if).toBe("steps.config.outputs.configured == 'true'");
    expect(record.run).toContain("/deploys/");
    expect(record.run).toContain("--request POST");
  });
});
