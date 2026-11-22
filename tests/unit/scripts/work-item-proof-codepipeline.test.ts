/**
 * A CDK host proves delivery from CodePipeline's own execution record, through
 * the real canonical `complete` route with a controlled read-only `aws`.
 */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
} from "../../support/work-item-cli.js";
import {
  attachRecord,
  proofCli,
  proofCliSpawned,
  PROOF_REF,
} from "../../support/work-item-proof-fixture.js";
import {
  awsCalls,
  EXECUTION_ID,
  GET_CALLER_IDENTITY,
  GET_EXECUTION,
  PIPELINE,
  pipelineFixture,
  REGION,
  removeAws,
  setAws,
  setExecution,
  type PipelineFixture,
} from "../../support/work-item-proof-codepipeline.js";

// The controlled provider answers in-process (work-item-inprocess-gh.ts), so a
// case no longer starts a Node process per provider call. The cases on
// proofCliSpawned keep the guard and provider as real processes, which is this
// suite's real-boundary proof (CodySwannGT/lisa#4616, audit unit row 15).
vi.mock("node:child_process", async original =>
  (await import("../../support/work-item-inprocess-gh.js")).routeFakeGh(
    await original()
  )
);

const COMPLETE = ["complete", "--ref", PROOF_REF];
const INVALID = "[invalid-proof]";
const COMPLETED = "work-item completed:";
const MECHANISM = "aws-codepipeline";
const READ_ERROR = "[read-error]";
const PENDING = "[pending-proof]";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * Run lifecycle complete and capture what the providers observed.
 * @param fixture - Owned CodePipeline-delivered host with an attached record.
 * @param run - In-process by default; the real-boundary case spawns.
 * @returns CLI result, native issue state, attempted writes and AWS calls.
 */
function complete(
  fixture: PipelineFixture,
  run: typeof proofCli | typeof proofCliSpawned = proofCli
) {
  attachRecord(fixture);
  const result = run(fixture, COMPLETE);
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
    const observed = complete(fixture, proofCliSpawned);
    console.log(JSON.stringify({ case: "succeeded", ...observed.result }));
    expect(observed.result.stderr).toBe("");
    expect(observed.result.status).toBe(0);
    expect(observed.result.stdout).toContain(COMPLETED);
    expect(observed.result.stdout).toContain(EXECUTION_ID);
    expect(observed.result.stdout).toContain(fixture.merge);
    expect(observed.state.state).toBe("CLOSED");
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
    const fixture = pipelineFixture({ mechanism: MECHANISM });
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
      mechanism: MECHANISM,
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
    expect(observed.result.stdout).toContain(READ_ERROR);
    expect(observed.result.stdout).toContain(
      "codepipeline:GetPipelineExecution"
    );
    expect(observed.result.stdout).toContain(EXECUTION_ID);
    expectUntouched(observed);
  });

  it("refuses a record whose pinned revision and execution both name an older commit", () => {
    const fixture = pipelineFixture();
    Object.assign(fixture.record.obligations.delivery, {
      source_revision: fixture.before,
    });
    setExecution(fixture, "Succeeded", fixture.before);
    const observed = complete(fixture);
    expect(observed.result.status).toBe(1);
    expect(observed.result.stdout).toContain(INVALID);
    expect(observed.result.stdout).not.toContain(COMPLETED);
    expectUntouched(observed);
  });

  it("refuses a record that pins no execution id", () => {
    const fixture = pipelineFixture();
    delete (fixture.record.obligations.delivery as { execution_id?: string })
      .execution_id;
    const observed = complete(fixture);
    expect(observed.result.status).toBe(1);
    expect(observed.result.stdout).toContain(INVALID);
    expect(observed.aws.calls).toEqual([]);
    expectUntouched(observed);
  });

  it("refuses a record that pins another region than the configured one, without reading AWS", () => {
    const fixture = pipelineFixture({
      mechanism: MECHANISM,
      pipeline_name: PIPELINE,
      region: "eu-west-1",
    });
    const observed = complete(fixture);
    expect(observed.result.status).toBe(1);
    expect(observed.result.stdout).toContain(INVALID);
    expect(observed.result.stdout).toContain("eu-west-1");
    expect(observed.aws.calls).toEqual([]);
    expectUntouched(observed);
  });

  it.each(["Stopped", "Superseded"])(
    "refuses a %s execution and names its status",
    status => {
      const fixture = pipelineFixture();
      setExecution(fixture, status, fixture.merge);
      const observed = complete(fixture);
      expect(observed.result.status).toBe(1);
      expect(observed.result.stdout).toContain(INVALID);
      expect(observed.result.stdout).toContain(`ended ${status}`);
      expectUntouched(observed);
    }
  );

  it("refuses an execution that is still Stopping, saying so", () => {
    const fixture = pipelineFixture();
    setExecution(fixture, "Stopping", fixture.merge);
    const observed = complete(fixture);
    expect(observed.result.status).toBe(1);
    expect(observed.result.stdout).toContain(INVALID);
    expect(observed.result.stdout).toContain("is Stopping");
    expectUntouched(observed);
  });

  it("accepts an execution whose second source revision is the delivered commit", () => {
    const fixture = pipelineFixture();
    setExecution(fixture, "Succeeded", [fixture.before, fixture.merge]);
    const observed = complete(fixture);
    expect(observed.result.stderr).toBe("");
    expect(observed.result.status).toBe(0);
    expect(observed.result.stdout).toContain(COMPLETED);
    expect(observed.state.state).toBe("CLOSED");
  });

  it("reports a missing AWS CLI as a read error", () => {
    const fixture = pipelineFixture();
    removeAws(fixture);
    const observed = complete(fixture);
    expect(observed.result.status).toBe(1);
    expect(observed.result.stdout).toContain(READ_ERROR);
    expect(observed.result.stdout).toContain("AWS CLI is not installed");
    expectUntouched(observed);
  });

  it("reports a reply with no pipeline execution as a read error", () => {
    const fixture = pipelineFixture();
    setAws(fixture, GET_EXECUTION, { json: {} });
    const observed = complete(fixture);
    expect(observed.result.status).toBe(1);
    expect(observed.result.stdout).toContain(READ_ERROR);
    expect(observed.result.stdout).toContain(EXECUTION_ID);
    expectUntouched(observed);
  });

  describe("bound to an AWS account", () => {
    const ACCOUNT = "111111111111";
    const OTHER_ACCOUNT = "222222222222";

    /**
     * A host whose delivery and record both name the production account.
     * @param accountId - The configured account id.
     * @returns Fixture with a matching account pinned in the record.
     */
    function accountFixture(accountId: string = ACCOUNT) {
      const fixture = pipelineFixture({
        mechanism: MECHANISM,
        pipeline_name: PIPELINE,
        region: REGION,
        account_id: accountId,
      });
      Object.assign(fixture.record.obligations.delivery, {
        account_id: accountId,
      });
      return fixture;
    }

    it("accepts the execution when the credentials belong to the configured account", () => {
      const fixture = accountFixture();
      setAws(fixture, GET_CALLER_IDENTITY, { json: { Account: ACCOUNT } });
      setExecution(fixture, "Succeeded", fixture.merge);
      const observed = complete(fixture);
      expect(observed.result.stderr).toBe("");
      expect(observed.result.status).toBe(0);
      expect(observed.result.stdout).toContain(COMPLETED);
      expect(observed.aws.calls.map(call => call.join(" "))).toContain(
        GET_CALLER_IDENTITY.join(" ")
      );
      expect(observed.aws.unhandled).toBe("");
    });

    it("refuses credentials from another account without reading the execution", () => {
      const fixture = accountFixture();
      setAws(fixture, GET_CALLER_IDENTITY, {
        json: { Account: OTHER_ACCOUNT },
      });
      setExecution(fixture, "Succeeded", fixture.merge);
      const observed = complete(fixture);
      expect(observed.result.status).toBe(1);
      expect(observed.result.stdout).toContain(INVALID);
      expect(observed.result.stdout).toContain(ACCOUNT);
      expect(observed.result.stdout).toContain(OTHER_ACCOUNT);
      expect(
        observed.aws.calls.some(call => call.join() === GET_EXECUTION.join())
      ).toBe(false);
      expectUntouched(observed);
    });

    it("refuses a malformed configured account before any AWS call", () => {
      const fixture = accountFixture("12345");
      const observed = complete(fixture);
      expect(observed.result.status).toBe(1);
      expect(observed.result.stdout).toContain(INVALID);
      expect(observed.result.stdout).toContain("account_id");
      expect(observed.aws.calls).toEqual([]);
      expectUntouched(observed);
    });

    it("refuses a record that does not pin the configured account, before any AWS call", () => {
      const fixture = accountFixture();
      delete (fixture.record.obligations.delivery as { account_id?: string })
        .account_id;
      const observed = complete(fixture);
      expect(observed.result.status).toBe(1);
      expect(observed.result.stdout).toContain(INVALID);
      expect(observed.aws.calls).toEqual([]);
      expectUntouched(observed);
    });
  });
});
