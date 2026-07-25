/**
 * Opaque action/reusable-workflow coverage for the feedback/guardrails
 * readiness producer (B4, PRD #1739, #1896).
 *
 * These cases are deliberately unresolved observations. The offline scanner
 * cannot inspect action internals or called workflow files, but it should not
 * let consequential-looking authority disappear from the report.
 * @module tests/unit/cli/doctor-readiness-guardrails-opaque-actions
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
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

/** The workflow `name:` line most fixtures in this suite write. */
const DEPLOY_NAME_LINE = "name: Deploy";

/** The infrastructure job header reused across fixtures. */
const INFRA_JOB = "  infra:";

/**
 * Every finding in a record, asserted to name no blocker.
 * @param findings - The record's raw findings
 */
function expectNoBlocker(findings: readonly unknown[]): void {
  for (const finding of asFindings(findings)) {
    expect(Object.hasOwn(finding, "blocker")).toBe(false);
  }
}

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("guardrails-opaque-actions");
  return tempDir;
}

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("assessFeedbackGuardrailsDimension — opaque consequential calls", () => {
  it("surfaces action-driven destructive work as unresolved", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      "      - uses: hashicorp/terraform-github-actions@v1",
      "        with:",
      "          tf_actions_subcommand: destroy",
      "          tf_actions_working_dir: infra/prod",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(SKIP);
    expectNoBlocker(record.findings);
    expect(
      asFindings(record.findings).some(finding =>
        String(finding.observation).includes(
          "hashicorp/terraform-github-actions@v1"
        )
      )
    ).toBe(true);
  });

  it("surfaces consequential reusable workflow calls as unresolved", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      "  teardown:",
      "    uses: ./.github/workflows/destroy-production.yml",
      "    with:",
      "      command: terraform destroy -auto-approve",
      "      target: production",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(SKIP);
    expectNoBlocker(record.findings);
    expect(
      asFindings(record.findings).some(finding =>
        String(finding.observation).includes("destroy-production.yml")
      )
    ).toBe(true);
  });
});
