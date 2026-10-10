/** Supported caller diagnostics and aggregate native deadlines never stand in for hosted authority proof. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { auditReusable } from "../../../scripts/check-workflow-contract-assertions.mjs";
import {
  assertHostedGate,
  remainingGateTime,
  originalHookEnvironment,
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
  it("shortens only browser-selected original hooks while preserving private candidate paths", () => {
    const original = {
      HOME: "/owned/candidate",
      TMPDIR: "/owned/candidate/tmp",
      PATH: "/qualified/tools:/usr/bin",
      BUNDLE_PATH: "/owned/candidate/bundle",
    };
    expect(originalHookEnvironment(original, undefined)).toBe(original);
    expect(originalHookEnvironment(original, { browser: false })).toBe(
      original
    );
    expect(originalHookEnvironment(original, { browser: true })).toEqual({
      ...original,
      LISA_SCRATCH_BASE: "/tmp",
    });
    expect(original).not.toHaveProperty("LISA_SCRATCH_BASE");
  });
  it("fits the supported Linux socket pathname without shortening full authority tokens", () => {
    const temporary = `/tmp/lisa-rails-scratch/r.${"a".repeat(24)}/tmp`;
    const chrome = `${temporary}/${"b".repeat(8)}/com.google.Chrome.ABCDEF/SingletonSocket`;
    expect(Buffer.byteLength(chrome)).toBe(104);
    expect(Buffer.byteLength(chrome)).toBeLessThanOrEqual(107);
  });
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
    for (const phase of ["prepare", "allocate", "gate", "publish"]) {
      const job = workflow.jobs[phase];
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
  it("asserts the registered caller contract before preparation and refuses a stale major", () => {
    const workflow = parse(
      readFileSync(".github/workflows/npm-updater.yml", "utf8")
    );
    const registry = JSON.parse(
      readFileSync(".github/reusable-workflow-contracts.json", "utf8")
    );
    const subject = {
      file: "npm-updater.yml",
      major: registry.workflows["npm-updater.yml"].major,
      document: workflow,
      canonical: readFileSync("scripts/workflow-contract-assertion.sh", "utf8"),
    };
    expect(subject.major).toBe(1);
    expect(auditReusable(subject)).toEqual([]);
    expect(auditReusable({ ...subject, major: 2 })).toEqual([
      expect.stringContaining("declares major 1 but"),
    ]);
    expect(workflow.jobs.prepare.needs).toBe("workflow_contract");
    expect(workflow.jobs.workflow_contract.permissions).toEqual({});
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
