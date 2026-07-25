/**
 * Terraform argument coverage for the feedback/guardrails readiness producer
 * (B4, PRD #1739, #1896).
 * @module tests/unit/cli/doctor-readiness-guardrails-terraform
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { assessFeedbackGuardrailsDimension } from "../../../src/cli/doctor-readiness-guardrails.js";
import {
  asFindings,
  DEPLOY_YML,
  JOBS,
  makeScratchRepo,
  ON_PUSH,
  RUNS_ON,
  STEPS,
  WARN,
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

/** The B4 ship blocker. */
const BLOCKER_ID = "B4";

/** Single-line interactive Terraform apply step. */
const TERRAFORM_APPLY_STEP = "      - run: terraform apply";

/** Shared deploy workflow fixture lines. */
const BASE_WORKFLOW = [
  "name: Deploy",
  ON_PUSH,
  JOBS,
  "  infra:",
  RUNS_ON,
] as const;

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("guardrails-terraform");
  return tempDir;
}

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

/**
 * Assert that B4 stands for the workflow just written.
 * @param root - Scratch repository path
 */
async function expectB4(root: string): Promise<void> {
  const record = await assessFeedbackGuardrailsDimension(root);
  expect(record.status).toBe(WARN);
  expect(
    asFindings(record.findings).some(finding => finding.blocker === BLOCKER_ID)
  ).toBe(true);
}

/**
 * Assert that B4 is absent for the workflow just written.
 * @param root - Scratch repository path
 */
async function expectNoB4(root: string): Promise<void> {
  const record = await assessFeedbackGuardrailsDimension(root);
  expect(
    asFindings(record.findings).some(finding => finding.blocker === BLOCKER_ID)
  ).toBe(false);
}

describe("assessFeedbackGuardrailsDimension — Terraform auto-approval", () => {
  it("stands B4 when auto-approval appears on a later shell line", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      ...BASE_WORKFLOW,
      STEPS,
      "      - run: |",
      "          terraform apply \\",
      "            -auto-approve",
    ]);

    await expectB4(root);
  });

  it("does not combine unrelated shell lines into Terraform auto-approval", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      ...BASE_WORKFLOW,
      STEPS,
      "      - run: |",
      "          terraform apply",
      "          echo -auto-approve",
    ]);

    await expectNoB4(root);
  });

  it("stands B4 when job env supplies Terraform auto-approval", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      ...BASE_WORKFLOW,
      "    env:",
      "      TF_CLI_ARGS: -auto-approve",
      STEPS,
      TERRAFORM_APPLY_STEP,
    ]);

    await expectB4(root);
  });

  it("stands B4 when apply-specific env supplies Terraform auto-approval", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      ...BASE_WORKFLOW,
      "    env:",
      "      TF_CLI_ARGS_apply: -auto-approve",
      STEPS,
      TERRAFORM_APPLY_STEP,
    ]);

    await expectB4(root);
  });

  it("stands B4 when step env supplies Terraform auto-approval", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      ...BASE_WORKFLOW,
      STEPS,
      TERRAFORM_APPLY_STEP,
      "        env:",
      "          TF_ARGS: -auto-approve",
    ]);

    await expectB4(root);
  });

  it("stands B4 when Terraform applies a saved plan file", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      ...BASE_WORKFLOW,
      STEPS,
      "      - run: terraform apply -input=false terraform.tfplan",
    ]);

    await expectB4(root);
  });

  it("does not stand B4 for an interactive Terraform apply", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      ...BASE_WORKFLOW,
      STEPS,
      TERRAFORM_APPLY_STEP,
    ]);

    await expectNoB4(root);
  });
});
