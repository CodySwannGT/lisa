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

describe("assessFeedbackGuardrailsDimension — Terraform auto-approval", () => {
  it("stands B4 when auto-approval appears on a later shell line", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      ...BASE_WORKFLOW,
      STEPS,
      "      - run: |",
      "          terraform apply",
      "            -auto-approve",
    ]);

    await expectB4(root);
  });

  it("stands B4 when job env supplies Terraform auto-approval", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      ...BASE_WORKFLOW,
      "    env:",
      "      TF_CLI_ARGS: -auto-approve",
      STEPS,
      "      - run: terraform apply",
    ]);

    await expectB4(root);
  });

  it("stands B4 when step env supplies Terraform auto-approval", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      ...BASE_WORKFLOW,
      STEPS,
      "      - run: terraform apply",
      "        env:",
      "          TF_ARGS: -auto-approve",
    ]);

    await expectB4(root);
  });
});
