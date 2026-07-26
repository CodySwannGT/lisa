/**
 * Local wrapper command coverage for the feedback/guardrails readiness producer
 * (B4, PRD #1739, #1896).
 * @module tests/unit/cli/doctor-readiness-guardrails-wrappers
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
  SKIP,
  STEPS,
  WARN,
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

/** The ship blocker this producer can stand up. */
const BLOCKER_ID = "B4";

/** Shared workflow name line for wrapper fixtures. */
const DEPLOY_NAME_LINE = "name: Deploy";

/** Shared infrastructure job header for wrapper fixtures. */
const INFRA_JOB = "  infra:";

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary repository path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("guardrails-wrappers");
  return tempDir;
}

/**
 * Assert that a command stands B4 and appears in evidence.
 * @param command - Shell command line to place in the workflow
 */
async function expectB4ForCommand(command: string): Promise<void> {
  const root = await getTempDir();
  await writeWorkflow(root, DEPLOY_YML, [
    DEPLOY_NAME_LINE,
    ON_PUSH,
    JOBS,
    INFRA_JOB,
    RUNS_ON,
    STEPS,
    `      - run: ${command}`,
  ]);

  const record = await assessFeedbackGuardrailsDimension(root);
  const blocking = asFindings(record.findings).find(
    finding => finding.blocker === BLOCKER_ID
  );

  expect(record.status).toBe(WARN);
  expect(blocking?.evidence).toContain(command);
}

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("assessFeedbackGuardrailsDimension — local wrapper commands", () => {
  it("stands B4 for an explicitly production local destroy wrapper", async () => {
    await expectB4ForCommand("./scripts/destroy-prod.sh");
  });

  it("stands B4 for an explicitly production package-script wrapper", async () => {
    await expectB4ForCommand("npm run db:reset:prod");
  });

  it("does not stand B4 for a wrapper that targets test state", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      "name: Test teardown",
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      "      - run: ./scripts/destroy-prod-test-fixture.sh",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(SKIP);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });
});
