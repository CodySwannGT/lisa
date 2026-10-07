/** Structural caller contracts do not claim an authentic provider or signed cancellation. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { cancellationRequest } from "../../../all/copy-overwrite/scripts/lisa-npm-updater.mjs";

const workflow = parse(
  readFileSync(".github/workflows/npm-updater.yml", "utf8")
);
const inputs = ["cancel_issue", "cancel_proposal_key", "cancel_expected_main"];

describe("optional manual cancellation transport", () => {
  it("preserves exact literal intent and refuses partial, prefixed and unsafe numeric identities", () => {
    const env = {
      CANCEL_ISSUE: "42",
      CANCEL_PROPOSAL_KEY: "a".repeat(64),
      CANCEL_EXPECTED_MAIN: "b".repeat(40),
    };
    expect(cancellationRequest(env)).toEqual({
      number: 42,
      proposalKey: env.CANCEL_PROPOSAL_KEY,
      parent: env.CANCEL_EXPECTED_MAIN,
    });
    for (const changed of [
      { CANCEL_ISSUE: "042" },
      { CANCEL_ISSUE: "9007199254740993" },
      { CANCEL_ISSUE: "#42" },
      { CANCEL_PROPOSAL_KEY: "" },
      { CANCEL_EXPECTED_MAIN: "HEAD" },
    ]) {
      expect(() => cancellationRequest({ ...env, ...changed })).toThrow();
    }
  });
  it("leaves existing callers on their normal path with three empty optional data inputs", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_call"]);
    for (const name of inputs)
      expect(workflow.on.workflow_call.inputs[name]).toMatchObject({
        type: "string",
        default: "",
        required: false,
      });
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  });

  it("signs a separate fixed cancellation subject before closing or ordinary fresh allocation", () => {
    const steps = workflow.jobs.allocate.steps;
    const prepare = steps.findIndex(
      (step: any) => step.id === "cancel_prepare"
    );
    const attest = steps.findIndex((step: any) => step.id === "cancel_attest");
    const finish = steps.findIndex(
      (step: any) =>
        step.name ===
        "Persist the authenticated cancellation before fresh allocation"
    );
    const normal = steps.findIndex(
      (step: any) =>
        step.name === "Allocate or recover the exact canonical leaf"
    );
    expect(prepare).toBeGreaterThan(-1);
    expect(attest).toBeGreaterThan(prepare);
    expect(finish).toBeGreaterThan(attest);
    expect(normal).toBeGreaterThan(finish);
    expect(steps[attest].with["subject-name"]).toBe("cancellation.json");
    expect(steps[attest].with["predicate-type"]).toBe(
      "https://lisa.dev/attestations/npm-cancellation/v1"
    );
    expect(steps[attest].if).toBe(
      "steps.cancel_prepare.outputs.mode == 'fresh'"
    );
    expect(steps[finish].run).toContain("cancel-checkpoint");
    for (const name of inputs)
      expect(steps[prepare].if).toContain(`inputs.${name}`);
  });

  it("keeps cancellation on the existing pinned default-token issuer job, away from candidate execution and npm writes", () => {
    expect(workflow.jobs.allocate.permissions).toEqual({
      contents: "read",
      actions: "read",
      issues: "write",
      "id-token": "write",
      attestations: "write",
    });
    expect(workflow.jobs.gate.permissions.contents).toBe("read");
    expect(workflow.jobs.publish.permissions["id-token"]).toBeUndefined();
    const prepare = workflow.jobs.allocate.steps.find(
      (step: any) => step.id === "cancel_prepare"
    );
    expect(prepare.env.GH_TOKEN).toBe("${{ github.token }}");
    expect(prepare.run).toContain("cancel-prepare");
    expect(
      workflow.jobs.allocate.steps.some((step: any) =>
        step.name?.startsWith("Install the official Linux GH")
      )
    ).toBe(true);
  });
});
