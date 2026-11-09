/**
 * A CDK host proves delivery from CodePipeline's own execution record, through
 * the real canonical `complete` route with a controlled read-only `aws`.
 */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
} from "../../support/work-item-cli.js";
import {
  attachRecord,
  proofCli,
  PROOF_REF,
} from "../../support/work-item-proof-fixture.js";
import {
  awsCalls,
  EXECUTION_ID,
  GET_EXECUTION,
  PIPELINE,
  pipelineFixture,
  REGION,
  setAws,
  setExecution,
  type PipelineFixture,
} from "../../support/work-item-proof-codepipeline.js";

const COMPLETE = ["complete", "--ref", PROOF_REF];
const INVALID = "[invalid-proof]";
const COMPLETED = "work-item completed:";
const PENDING = "[pending-proof]";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * Run lifecycle complete and capture what the providers observed.
 * @param fixture - Owned CodePipeline-delivered host with an attached record.
 * @returns CLI result, native issue state, attempted writes and AWS calls.
 */
function complete(fixture: PipelineFixture) {
  attachRecord(fixture);
  const result = proofCli(fixture, COMPLETE);
  const state = JSON.parse(
    readFileSync(fixture.env.FAKE_GH_STATE_FILE!, "utf8")
  );
  const writes = readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8");
  expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
  return { result, state, writes, aws: awsCalls(fixture) };
}

/**
 * A refusal closes nothing and writes nothing.
 * @param observed - What one completion attempt observed.
 * @param observed.state - Native issue state after the attempt.
 * @param observed.writes - Attempted native provider writes.
 */
function expectUntouched(observed: {
  state: { state: string };
  writes: string;
}) {
  expect(observed.writes).toBe("");
  expect(observed.state.state).toBe("OPEN");
}

describe("CodePipeline delivery proof through actual CLI", () => {
  it("accepts an execution that Succeeded at the delivered commit and reports the pinned execution", () => {
    const fixture = pipelineFixture();
    setExecution(fixture, "Succeeded", fixture.merge);
    const observed = complete(fixture);
    console.log(JSON.stringify({ case: "succeeded", ...observed.result }));
    expect(observed.result.stderr).toBe("");
    expect(observed.result.status).toBe(0);
    expect(observed.result.stdout).toContain(COMPLETED);
    expect(observed.result.stdout).toContain(EXECUTION_ID);
    expect(observed.result.stdout).toContain(fixture.merge);
    expect(observed.state.state).toBe("CLOSED");
    expect(fixture.record.obligations.delivery).toMatchObject({
      execution_id: EXECUTION_ID,
      source_revision: fixture.merge,
    });
    expect(observed.aws.unhandled).toBe("");
    expect(observed.aws.calls.length).toBeGreaterThan(0);
    expect(
      observed.aws.calls.every(call => call.join() === GET_EXECUTION.join())
    ).toBe(true);
  });

  it("refuses a Succeeded execution of an older commit and names both revisions", () => {
    const fixture = pipelineFixture();
    setExecution(fixture, "Succeeded", fixture.before);
    const observed = complete(fixture);
    console.log(JSON.stringify({ case: "older-commit", ...observed.result }));
    expect(observed.result.status).toBe(1);
    expect(observed.result.stdout).toContain(INVALID);
    expect(observed.result.stdout).toContain(fixture.merge);
    expect(observed.result.stdout).toContain(fixture.before);
    expect(observed.result.stdout).not.toContain(COMPLETED);
    expect(observed.aws.unhandled).toBe("");
    expectUntouched(observed);
  });

  it("reports an execution still InProgress at an approval as pending, naming the execution", () => {
    const fixture = pipelineFixture();
    setExecution(fixture, "InProgress", fixture.merge);
    const observed = complete(fixture);
    console.log(JSON.stringify({ case: "in-progress", ...observed.result }));
    expect(observed.result.status).toBe(0);
    expect(observed.result.stdout).toContain(PENDING);
    expect(observed.result.stdout).toContain(EXECUTION_ID);
    expect(observed.result.stdout).toMatch(/not (yet )?delivered/i);
    expect(observed.result.stdout).not.toContain(COMPLETED);
    expect(observed.aws.unhandled).toBe("");
    expectUntouched(observed);
  });

  it("refuses a Failed execution and names its status", () => {
    const fixture = pipelineFixture();
    setExecution(fixture, "Failed", fixture.merge);
    const observed = complete(fixture);
    console.log(JSON.stringify({ case: "failed", ...observed.result }));
    expect(observed.result.status).toBe(1);
    expect(observed.result.stdout).toContain(INVALID);
    expect(observed.result.stdout).toContain("Failed");
    expect(observed.result.stdout).toContain(EXECUTION_ID);
    expect(observed.aws.unhandled).toBe("");
    expectUntouched(observed);
  });

  it("asks for the pipeline name and region when the mechanism is declared without them", () => {
    const fixture = pipelineFixture({ mechanism: "aws-codepipeline" });
    const observed = complete(fixture);
    expect(observed.result.stdout).toContain(PENDING);
    expect(observed.result.stdout).toContain(
      "verification.completion.delivery.production.pipeline_name"
    );
    expect(observed.result.stdout).toContain("region");
    expect(observed.aws.calls).toEqual([]);
    expectUntouched(observed);
  });

  it("refuses a record that pins another pipeline than the configured one, without reading AWS", () => {
    const fixture = pipelineFixture({
      mechanism: "aws-codepipeline",
      pipeline_name: "another-pipeline",
      region: REGION,
    });
    const observed = complete(fixture);
    expect(observed.result.status).toBe(1);
    expect(observed.result.stdout).toContain(INVALID);
    expect(observed.result.stdout).toContain(PIPELINE);
    expect(observed.aws.calls).toEqual([]);
    expectUntouched(observed);
  });

  it("refuses a malformed execution id before any AWS call", () => {
    const fixture = pipelineFixture();
    Object.assign(fixture.record.obligations.delivery, {
      execution_id: "--profile=admin",
    });
    const observed = complete(fixture);
    expect(observed.result.status).toBe(1);
    expect(observed.result.stdout).toContain(INVALID);
    expect(observed.aws.calls).toEqual([]);
    expectUntouched(observed);
  });

  it("reports an AWS read it could not make as a read error naming the read-only access needed", () => {
    const fixture = pipelineFixture();
    setAws(fixture, GET_EXECUTION, {
      failure:
        "An error occurred (AccessDeniedException) when calling the GetPipelineExecution operation\n",
      status: 254,
    });
    const observed = complete(fixture);
    expect(observed.result.status).toBe(1);
    expect(observed.result.stdout).toContain("[read-error]");
    expect(observed.result.stdout).toContain(
      "codepipeline:GetPipelineExecution"
    );
    expect(observed.result.stdout).toContain(EXECUTION_ID);
    expectUntouched(observed);
  });
});
