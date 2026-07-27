/**
 * Regression coverage for B2 resolving local reusable-workflow callers.
 * @module tests/unit/cli/doctor-readiness-delivery-reusable-callers
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { assessDeliveryAuthorityDimension } from "../../../src/cli/doctor-readiness-delivery.js";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";
import {
  asFindings,
  CI_YML,
  CONTENTS_READ,
  FAIL,
  JOBS,
  makeScratchRepo,
  ON,
  ON_PUSH,
  PERMISSIONS,
  PUBLISH_JOB,
  RUN_PUBLISH,
  RUNS_ON,
  STEPS,
  TEST_JOB,
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

const REUSABLE_WORKFLOW = "publish-to-npm.yml";
const REUSABLE_PATH = "./.github/workflows/publish-to-npm.yml";
const WORKFLOW_NAME = "name: Publish to npm";
const WORKFLOW_CALL = "  workflow_call:";
const VALIDATING_STEP = "      - run: npm test";
const INSTALL_STEP = "      - run: npm ci";
const BUILD_STEP = "      - run: bun run build:dist";
const CALLER_JOB = "  publish:";
const CALLER_USES = `    uses: ${REUSABLE_PATH}`;

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("reusable-callers");
  return tempDir;
}

/**
 * Write a reusable workflow that publishes through one setup step.
 * @param root - Repository root
 * @param publishSetupStep - Step before the publish command
 */
async function writeReusablePublisher(
  root: string,
  publishSetupStep: string
): Promise<void> {
  await writeWorkflow(root, REUSABLE_WORKFLOW, [
    WORKFLOW_NAME,
    ON,
    WORKFLOW_CALL,
    JOBS,
    PUBLISH_JOB,
    RUNS_ON,
    PERMISSIONS,
    CONTENTS_READ,
    STEPS,
    publishSetupStep,
    RUN_PUBLISH,
  ]);
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("assessDeliveryAuthorityDimension — B2 reusable workflow callers", () => {
  it("PASSes when every local caller validates before a non-building publisher", async () => {
    const cwd = await getTempDir();
    await writeReusablePublisher(cwd, INSTALL_STEP);
    await writeWorkflow(cwd, CI_YML, [
      "name: CI",
      ON_PUSH,
      JOBS,
      TEST_JOB,
      RUNS_ON,
      STEPS,
      VALIDATING_STEP,
      CALLER_JOB,
      "    needs: [test]",
      CALLER_USES,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe("PASS");
    expect(assessReadiness([record]).blockers).toEqual([]);
    expect(JSON.stringify(record.findings)).toContain(
      "Inspected 1 publishing step"
    );
  });

  it("PASSes when a dual-trigger reusable publisher has a validated local caller", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, REUSABLE_WORKFLOW, [
      WORKFLOW_NAME,
      ON,
      WORKFLOW_CALL,
      "  workflow_dispatch:",
      JOBS,
      PUBLISH_JOB,
      RUNS_ON,
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      INSTALL_STEP,
      RUN_PUBLISH,
    ]);
    await writeWorkflow(cwd, CI_YML, [
      "name: CI",
      ON_PUSH,
      JOBS,
      TEST_JOB,
      RUNS_ON,
      STEPS,
      VALIDATING_STEP,
      CALLER_JOB,
      "    needs: [test]",
      CALLER_USES,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe("PASS");
    expect(assessReadiness([record]).blockers).toEqual([]);
    expect(JSON.stringify(record.findings)).toContain(
      "Inspected 1 publishing step"
    );
  });

  it("FAILs when a known local caller invokes a self-building publisher without validation", async () => {
    const cwd = await getTempDir();
    await writeReusablePublisher(cwd, BUILD_STEP);
    await writeWorkflow(cwd, CI_YML, [
      "name: CI",
      ON_PUSH,
      JOBS,
      CALLER_JOB,
      CALLER_USES,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === "B2"
    );
    expect(finding?.evidence).toContain(REUSABLE_WORKFLOW);
    expect(finding?.evidence).toContain("no validating job");
    expect(assessReadiness([record]).blockers[0].id).toBe("B2");
  });
});
