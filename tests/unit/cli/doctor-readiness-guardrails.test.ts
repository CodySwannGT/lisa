/**
 * Unit coverage for the feedback/guardrails readiness producer (B4, PRD #1739,
 * #1896).
 *
 * Dimension 5 asks whether a failing loop produces a named outcome and a
 * runbook. Blocker B4 asks the operational half: does every irreversible or
 * expensive operation have a gate AND a way back?
 *
 * Only half of that is answerable offline. Whether a declared GitHub
 * `environment:` actually carries protection rules — required reviewers, wait
 * timers, branch restrictions — is a property of the GitHub API, not of any file
 * in the repository, so that half is a stated SKIP in every record this producer
 * emits. B4 therefore stands only when the file ALONE proves the operation is
 * ungated (no `environment:` key at all) and unrecoverable (no checked-in
 * runbook). The negative cases below are the load-bearing ones: an ordinary
 * `cdk deploy`, a CI-database migration, and any job that names an environment
 * must all leave B4 standing DOWN.
 * @module tests/unit/cli/doctor-readiness-guardrails
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  FEEDBACK_GUARDRAILS_DIMENSION_ID,
  assessFeedbackGuardrailsDimension,
} from "../../../src/cli/doctor-readiness-guardrails.js";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";
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
  writeRepoFile,
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

/** The dimension this producer owns. */
const DIMENSION_ID = "feedback-guardrails";

/** The ship blocker this producer can stand up. */
const BLOCKER_ID = "B4";

/** The workflow `name:` line most fixtures in this suite write. */
const DEPLOY_NAME_LINE = "name: Deploy";

/** The infrastructure job header reused across fixtures. */
const INFRA_JOB = "  infra:";

/** An irreversible infrastructure apply with the human confirmation removed. */
const RUN_TERRAFORM_APPLY = "      - run: terraform apply -auto-approve";

/** The stated reason the gate half of B4 cannot be settled offline. */
const OFFLINE_GATE_REASON = "not resolvable offline";

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
  tempDir ??= await makeScratchRepo("guardrails");
  return tempDir;
}

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("assessFeedbackGuardrailsDimension — B4 stands only on a file-provable case", () => {
  it("stands B4 for an auto-approved apply with no environment and no runbook", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      RUN_TERRAFORM_APPLY,
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.id).toBe(DIMENSION_ID);
    expect(record.status).toBe(WARN);
    const blocking = asFindings(record.findings).find(
      finding => finding.blocker === BLOCKER_ID
    );
    expect(blocking).toBeDefined();
    expect(String(blocking?.evidence)).toContain(
      ".github/workflows/deploy.yml"
    );
    expect(String(blocking?.evidence)).toContain("terraform apply");
    expect(String(blocking?.invariant_violated)).toContain("gate");
  });

  it("flips the repository to NOT_READY through the blocker engine", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      RUN_TERRAFORM_APPLY,
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);
    const assessment = assessReadiness([record]);

    expect(assessment.verdict).toBe("NOT_READY");
    expect(assessment.blockers.map(blocker => blocker.id)).toEqual([
      BLOCKER_ID,
    ]);
  });

  it("stands B4 for an explicitly production migration with no environment", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      "      - run: RAILS_ENV=production bundle exec rails db:migrate",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(WARN);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(true);
  });
});

describe("assessFeedbackGuardrailsDimension — the gate half is reasoned-SKIPped", () => {
  it("states that environment protection rules cannot be read offline", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      "    environment: production",
      STEPS,
      RUN_TERRAFORM_APPLY,
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(SKIP);
    expectNoBlocker(record.findings);
    const text = JSON.stringify(record.findings);
    expect(text).toContain(OFFLINE_GATE_REASON);
    expect(text).toContain("protection rule");
  });

  it("never claims PASS, because the gate half is never settled offline", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      "      - run: npm run build",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).not.toBe("PASS");
    expect(record.status).toBe(SKIP);
  });
});

describe("assessFeedbackGuardrailsDimension — ordinary operations stay clear", () => {
  it("does not stand B4 for an ordinary `cdk deploy`", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      "      - run: cdk deploy --all",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(SKIP);
    expectNoBlocker(record.findings);
  });

  it("does not stand B4 for a CI-database migration with no production marker", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      "name: Coverage",
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      "      - run: bundle exec rails db:create db:schema:load || bundle exec rails db:migrate",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(SKIP);
    expectNoBlocker(record.findings);
  });

  it("does not stand B4 when a checked-in runbook provides the way back", async () => {
    const root = await getTempDir();
    await writeRepoFile(
      root,
      ".lisa/automations/deploy.runbook.md",
      "# Deploy runbook\n\nRecovery: re-run the previous release tag.\n"
    );
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      RUN_TERRAFORM_APPLY,
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(SKIP);
    expectNoBlocker(record.findings);
  });

  it("does not stand B4 when the job itself is behind an `if:` gate", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      "    if: github.ref == 'refs/heads/main'",
      STEPS,
      RUN_TERRAFORM_APPLY,
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(SKIP);
    expectNoBlocker(record.findings);
  });

  it("does not stand B4 for a reusable workflow whose caller cannot be seen", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      "on: [workflow_call]",
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      RUN_TERRAFORM_APPLY,
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(SKIP);
    expectNoBlocker(record.findings);
  });

  it("renders a stated-reason SKIP for a repository that declares no workflows", async () => {
    const root = await getTempDir();

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.id).toBe(FEEDBACK_GUARDRAILS_DIMENSION_ID);
    expect(record.status).toBe(SKIP);
    const findings = asFindings(record.findings);
    expect(findings.length).toBeGreaterThan(0);
    expect(String(findings[0].reason)).toContain(
      "No GitHub Actions workflow files were found"
    );
    expect(findings[0].skip).toBe(true);
    expectNoBlocker(record.findings);
  });
});
