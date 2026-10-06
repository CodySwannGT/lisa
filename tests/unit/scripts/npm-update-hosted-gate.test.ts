/** Supported caller diagnostics and aggregate native deadlines never stand in for hosted authority proof. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import {
  assertHostedGate,
  remainingGateTime,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-hosted-gate.mjs";

const context = {
  policy: { repository: "acme/widgets" },
  proposal: { parent: "b".repeat(40) },
  config: { automationProvenance: { allowedTriggers: ["workflow_dispatch"] } },
};
const env = {
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  GITHUB_REPOSITORY: "acme/widgets",
  GITHUB_SHA: "b".repeat(40),
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "workflow_dispatch",
};

describe("original hosted gate prerequisites", () => {
  it("keeps original application gates on their own read-only runner and privileged jobs on the trusted parent", () => {
    const workflow = parse(
      readFileSync(".github/workflows/npm-updater.yml", "utf8")
    );
    expect(Object.keys(workflow.on)).toEqual(["workflow_call"]);
    expect(workflow.permissions).toEqual({});
    expect(workflow.jobs.gate.permissions).toEqual({
      contents: "read",
      actions: "read",
      issues: "read",
      attestations: "read",
    });
    expect(workflow.jobs.prepare.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.publish.permissions["id-token"]).toBeUndefined();
    for (const job of Object.values(workflow.jobs) as any[]) {
      expect(job["runs-on"]).toBe("ubuntu-24.04");
      const checkout = job.steps.find((step: any) =>
        step.uses?.startsWith("actions/checkout@")
      );
      expect(checkout.with).toEqual({
        ref: "${{ github.sha }}",
        "persist-credentials": false,
        "fetch-depth": 0,
      });
      expect(job.steps[0].run).toContain('"PHASE=$RUNNER_TEMP/lisa-npm-phase"');
    }
    const install = (job: any) =>
      job.steps.find((step: any) =>
        step.name?.startsWith("Install the official Linux GH")
      );
    expect(install(workflow.jobs.gate)).toEqual(
      install(workflow.jobs.allocate)
    );
    expect(install(workflow.jobs.publish)).toEqual(
      install(workflow.jobs.allocate)
    );
  });
  it("accepts only the selected hosted Linux AMD64 parent/caller and refuses mismatches", () => {
    expect(() => assertHostedGate(context, env, "linux", "x64")).not.toThrow();
    for (const change of [
      { RUNNER_ENVIRONMENT: "self-hosted" },
      { GITHUB_REPOSITORY: "foreign/repo" },
      { GITHUB_SHA: "c".repeat(40) },
      { GITHUB_REF: "refs/heads/other" },
      { GITHUB_EVENT_NAME: "pull_request" },
    ])
      expect(() =>
        assertHostedGate(context, { ...env, ...change }, "linux", "x64")
      ).toThrow(/hosted/);
    expect(() => assertHostedGate(context, env, "darwin", "x64")).toThrow(
      /hosted/
    );
    expect(() => assertHostedGate(context, env, "linux", "arm64")).toThrow(
      /hosted/
    );
  });
  it("caps every later step by the unchanged original phase rather than renewing its budget", () => {
    expect(remainingGateTime(1_801_000, 1_000)).toBe(1_800_000);
    expect(remainingGateTime(1_801_000, 1_800_999)).toBe(1);
    expect(() => remainingGateTime(1_801_000, 1_801_000)).toThrow(/expired/);
    expect(() => remainingGateTime(1_801_001, 1_000)).toThrow(/deadline/);
  });
});
