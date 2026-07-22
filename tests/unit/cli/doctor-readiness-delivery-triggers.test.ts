/**
 * Unit coverage for B2's trigger conservatism: the readiness producers must never
 * manufacture RED from absence (PRD #1739, #1896).
 *
 * Reading workflow files offline cannot see a calling workflow, an upstream
 * `workflow_run`, or a branch protection rule. When the file alone does not
 * PROVE that what ships bypassed what was validated, the honest answer is a
 * stated-reason SKIP — a FAIL there would report correct repositories as unsafe,
 * which is how a gate loses its authority. This suite pins every case where
 * silence must not be read as a bypass.
 * @module tests/unit/cli/doctor-readiness-delivery-triggers
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { assessDeliveryAuthorityDimension } from "../../../src/cli/doctor-readiness-delivery.js";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";
import {
  asFindings,
  makeScratchRepo,
  CI_YML,
  CONTENTS_READ,
  DEPLOY_NAME,
  DEPLOY_YML,
  FAIL,
  JOBS,
  ON,
  ON_PUSH,
  PERMISSIONS,
  PUBLISH_JOB,
  RUN_BUILD,
  RUN_PUBLISH,
  RUNS_ON,
  SHIP_JOB,
  SKIP,
  STEPS,
  writeRepoJson,
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

/** Deploy steps repeated across the trigger fixtures. */
const RUN_CDK_DEPLOY = "      - run: cdk deploy";
const WORKFLOW_RUN = "  workflow_run:";
const WORKFLOWS_CI = "    workflows: [CI]";

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("triggers");
  return tempDir;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("assessDeliveryAuthorityDimension — B2 never manufactures RED from absence", () => {
  it("SKIPs a workflow_call publish workflow instead of failing it", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, "publish-to-npm.yml", [
      "name: Publish to npm",
      ON,
      "  workflow_call:",
      "    inputs:",
      "      tag:",
      "        required: true",
      "        type: string",
      JOBS,
      PUBLISH_JOB,
      RUNS_ON,
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      "      - run: bun run build:dist",
      RUN_PUBLISH,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    // Validation is the caller's obligation, and callers are not resolved
    // offline — absence of an in-file validating job proves nothing here.
    expect(record.status).toBe(SKIP);
    expect(assessReadiness([record]).blockers).toEqual([]);
    const findings = asFindings(record.findings);
    expect(typeof findings[0].reason).toBe("string");
    expect(findings[0].reason).not.toBe("");
    expect(Object.hasOwn(findings[0], "blocker")).toBe(false);
  });

  it("SKIPs a workflow_run-triggered deploy instead of failing it", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, DEPLOY_YML, [
      DEPLOY_NAME,
      ON,
      WORKFLOW_RUN,
      WORKFLOWS_CI,
      "    types: [completed]",
      JOBS,
      SHIP_JOB,
      RUNS_ON,
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      RUN_BUILD,
      "      - run: aws s3 sync ./dist s3://bucket",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(SKIP);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("SKIPs a default-branch push deploy instead of failing it", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, DEPLOY_YML, [
      DEPLOY_NAME,
      ON,
      "  push:",
      "    branches: [main]",
      JOBS,
      SHIP_JOB,
      RUNS_ON,
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      RUN_BUILD,
      RUN_CDK_DEPLOY,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    // Branch protection may require the validating checks upstream; that is not
    // visible in the workflow file, so silence is not evidence of a bypass.
    expect(record.status).toBe(SKIP);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("uses Lisa's configured production branch when detecting default-branch pushes", async () => {
    const cwd = await getTempDir();
    await writeRepoJson(cwd, ".lisa.config.json", {
      deploy: { branches: { production: "develop" } },
    });
    await writeWorkflow(cwd, DEPLOY_YML, [
      DEPLOY_NAME,
      ON,
      "  push:",
      "    branches: [develop]",
      JOBS,
      SHIP_JOB,
      RUNS_ON,
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      RUN_BUILD,
      RUN_CDK_DEPLOY,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(SKIP);
    expect(assessReadiness([record]).blockers).toEqual([]);
    expect(JSON.stringify(record.findings)).toContain("default branch");
  });

  it("SKIPs with a stated reason when workflows exist but nothing publishes", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, CI_YML, [
      "name: CI",
      ON_PUSH,
      JOBS,
      "  test:",
      RUNS_ON,
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      "      - run: npm run test",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    // A repository that ships nothing has not proved that what ships equals what
    // was validated — it has proved nothing at all. PASS here is a false green.
    expect(record.status).toBe(SKIP);
    const findings = asFindings(record.findings);
    expect(typeof findings[0].reason).toBe("string");
    expect(findings[0].reason).not.toBe("");
    expect(JSON.stringify(record.findings)).not.toContain(
      "every publishing job is preceded by validation"
    );
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("SKIPs an unfiltered on: [push] deploy exactly as it does the branches: [main] spelling", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, DEPLOY_YML, [
      DEPLOY_NAME,
      ON_PUSH,
      JOBS,
      SHIP_JOB,
      RUNS_ON,
      STEPS,
      RUN_BUILD,
      RUN_CDK_DEPLOY,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    // An unfiltered push is a SUPERSET of a default-branch push, so it cannot be
    // stricter than the spelling that names the branch explicitly.
    expect(record.status).toBe(SKIP);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("SKIPs a deploy that neither builds nor promotes an artifact", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, DEPLOY_YML, [
      DEPLOY_NAME,
      ON,
      "  workflow_dispatch:",
      JOBS,
      SHIP_JOB,
      RUNS_ON,
      STEPS,
      "      - run: cdk deploy --all",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    // Nothing here links what ships to what was validated — in either direction.
    // Calling that PASS would assert an artifact chain that was never observed.
    expect(record.status).toBe(SKIP);
    expect(assessReadiness([record]).blockers).toEqual([]);
    expect(JSON.stringify(record.findings)).not.toContain(
      "promotes the CI-built artifact"
    );
  });

  it("keeps the release-path reason alongside a standing credential blocker", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, DEPLOY_YML, [
      DEPLOY_NAME,
      ON,
      WORKFLOW_RUN,
      WORKFLOWS_CI,
      JOBS,
      SHIP_JOB,
      RUNS_ON,
      STEPS,
      RUN_BUILD,
      RUN_CDK_DEPLOY,
    ]);
    await writeWorkflow(cwd, CI_YML, [
      "name: CI",
      ON_PUSH,
      JOBS,
      "  quality:",
      "    uses: ./.github/workflows/quality.yml",
      "    secrets: inherit",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    // B3 standing must not swallow the release-path reason: dropping it is the
    // #1898 defect one layer in.
    expect(record.status).toBe(FAIL);
    expect(
      assessReadiness([record]).blockers.map(blocker => blocker.id)
    ).toEqual(["B3"]);
    expect(JSON.stringify(record.findings)).toContain("workflow_run");
  });
});
