/**
 * CodySwannGT/lisa#4859: the reusable npm updater accepts optional Jira and
 * Linear credentials and hands them only to the steps that call the tracker
 * adapter: allocate and checkpoint, and (CodySwannGT/lisa#4873) publish. The
 * gate step, where updated dependency code runs, never receives them. GitHub
 * callers pass nothing, so the contract major stays 1.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const SECRETS = ["JIRA_API_TOKEN", "JIRA_LOGIN", "LINEAR_API_KEY"];
const ADAPTER_STEPS = [
  "allocate:Authenticate the explicit stale cancellation intent",
  "allocate:Persist the authenticated cancellation before fresh allocation",
  "allocate:Allocate or recover the exact canonical leaf",
  "allocate:Transport the actual distinct bundle and persist the checkpoint",
  "publish:Publish the exact gated object and canonical PR declaration",
];
const text = readFileSync(".github/workflows/npm-updater.yml", "utf8");
const workflow = parse(text);

interface Step {
  name?: string;
  env?: Record<string, string>;
}

describe("optional tracker credentials in the npm updater workflow", () => {
  it("declares each tracker secret as optional", () => {
    const secrets = workflow.on.workflow_call.secrets;
    const byName = (left: string, right: string) => left.localeCompare(right);
    expect(Object.keys(secrets).sort(byName)).toEqual(
      [...SECRETS].sort(byName)
    );
    for (const name of SECRETS)
      expect(secrets[name]).toMatchObject({ required: false });
  });

  it("passes the secrets only to the cancel, allocate, checkpoint and publish steps", () => {
    const holders: string[] = [];
    for (const [job, definition] of Object.entries<{
      steps?: Step[];
      env?: object;
    }>(workflow.jobs)) {
      expect(JSON.stringify(definition.env ?? {})).not.toContain("secrets.");
      for (const step of definition.steps ?? [])
        if (JSON.stringify(step).includes("secrets."))
          holders.push(`${job}:${step.name}`);
    }
    expect(holders).toEqual(ADAPTER_STEPS);
    for (const job of ["allocate", "publish"])
      for (const step of workflow.jobs[job].steps as Step[])
        if (ADAPTER_STEPS.includes(`${job}:${step.name ?? ""}`))
          for (const name of SECRETS)
            expect(step.env?.[name]).toBe(`\${{ secrets.${name} }}`);
    expect(JSON.stringify(workflow.env ?? {})).not.toContain("secrets.");
  });

  it("keeps every tracker secret out of the gate job", () => {
    expect(JSON.stringify(workflow.jobs.gate)).not.toMatch(
      /JIRA_|LINEAR_API_KEY|ATLASSIAN_/
    );
  });

  it("keeps the declared workflow contract major at 1", () => {
    expect(text).toContain("DECLARED_MAJOR: '1'");
  });
});
