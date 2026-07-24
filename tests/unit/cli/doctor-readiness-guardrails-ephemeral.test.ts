/**
 * Ephemeral-environment and runbook-suppression coverage for the
 * feedback/guardrails readiness producer (B4, PRD #1739, #1896).
 *
 * The sibling suite pins what B4 stands on. This one pins the biggest
 * real-world way it could go wrong: **per-pull-request preview infrastructure**.
 * Tearing down `pr-1234` or a `PreviewStack` destroys what the same pipeline
 * built minutes earlier — there is nothing durable for a protection rule to
 * guard, and the trigger IS the gate. A producer that stood B4 on every preview
 * teardown would fire on a large share of modern repositories and be switched
 * off within a day.
 *
 * It also pins that an EMPTY runbook directory suppresses nothing: accepting one
 * as a "way back" would turn this blocker into an opt-out flag.
 * @module tests/unit/cli/doctor-readiness-guardrails-ephemeral
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
  writeRepoFile,
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

/** The ship blocker this producer can stand up. */
const BLOCKER_ID = "B4";

/** The workflow `name:` line most fixtures in this suite write. */
const DEPLOY_NAME_LINE = "name: Deploy";

/** The infrastructure job header reused across fixtures. */
const INFRA_JOB = "  infra:";

/** An irreversible infrastructure apply with the human confirmation removed. */
const RUN_TERRAFORM_APPLY = "      - run: terraform apply -auto-approve";

/** A production terraform destroy that should remain visible to B4. */
const RUN_TERRAFORM_DESTROY =
  "      - run: terraform destroy -auto-approve -var-file=prod.tfvars";

/** A local Postgres service declaration reused across service-target fixtures. */
const POSTGRES_SERVICE = [
  "    services:",
  "      postgres:",
  "        image: postgres:16",
];

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
  tempDir ??= await makeScratchRepo("guardrails-ephemeral");
  return tempDir;
}

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("assessFeedbackGuardrailsDimension — ephemeral environments stay clear", () => {
  it("does not stand B4 for a per-PR preview teardown", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      "on:",
      "  pull_request:",
      "    types: [closed]",
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      "      - run: terraform destroy -auto-approve -var env=pr-${{ github.event.number }}",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    // There is nothing durable to protect: the environment being destroyed was
    // created by the same pull request. The trigger IS the gate.
    expect(record.status).toBe(SKIP);
    expectNoBlocker(record.findings);
  });

  it("stands B4 when the same destructive operation is also reachable from a durable push trigger", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      "on:",
      "  push:",
      "    branches: [main]",
      "  pull_request:",
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      "      - run: terraform destroy -auto-approve -var-file=prod.tfvars",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(WARN);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(true);
  });

  it("does not stand B4 for a `serverless remove` of a per-PR stage", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      "      - run: serverless remove --stage pr-42",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(SKIP);
    expectNoBlocker(record.findings);
  });

  it("does not stand B4 for a `cdk destroy` of a preview stack", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      "      - run: cdk destroy PreviewStack-pr-7 --force",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(SKIP);
    expectNoBlocker(record.findings);
  });

  it("stands B4 for a durable stack whose name only contains `preview`", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      "      - run: cdk destroy CustomerPreviewStack --force",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(WARN);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(true);
  });

  it("does not stand B4 when a migration targets the job's own `services:` container", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      ...POSTGRES_SERVICE,
      "    env:",
      "      DATABASE_URL: postgres://postgres@postgres:5432/app",
      STEPS,
      "      - run: RAILS_ENV=production bundle exec rails db:migrate",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(SKIP);
    expectNoBlocker(record.findings);
    expect(
      asFindings(record.findings).some(finding =>
        String(finding.observation).includes("services:")
      )
    ).toBe(true);
  });

  it("stands B4 when a job service is unrelated to a durable infrastructure target", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      "    services:",
      "      redis:",
      "        image: redis:7",
      STEPS,
      RUN_TERRAFORM_DESTROY,
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(WARN);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(true);
    expect(
      asFindings(record.findings).some(finding =>
        String(finding.observation).includes("services:")
      )
    ).toBe(false);
  });

  it("stands B4 when a service name only appears as a generic terraform variable value", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      ...POSTGRES_SERVICE,
      STEPS,
      "      - run: terraform destroy -auto-approve -var database=postgres",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(WARN);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(true);
    expect(
      asFindings(record.findings).some(finding =>
        String(finding.observation).includes("services:")
      )
    ).toBe(false);
  });

  it("does not stand B4 when a step `env:` URL targets the job's own service", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      ...POSTGRES_SERVICE,
      STEPS,
      "      - run: RAILS_ENV=production bundle exec rails db:migrate",
      "        env:",
      "          DATABASE_URL: postgres://postgres@postgres:5432/app",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(SKIP);
    expectNoBlocker(record.findings);
    expect(
      asFindings(record.findings).some(finding =>
        String(finding.observation).includes("services:")
      )
    ).toBe(true);
  });

  it("does not stand B4 for an integration job applying test tfvars", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      "      - run: terraform apply -auto-approve -var-file=test.tfvars",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(SKIP);
    expectNoBlocker(record.findings);
  });

  it("does not stand B4 for a read-only `db:migrate:status` check", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, DEPLOY_YML, [
      DEPLOY_NAME_LINE,
      ON_PUSH,
      JOBS,
      INFRA_JOB,
      RUNS_ON,
      STEPS,
      "      - run: RAILS_ENV=production bundle exec rails db:migrate:status",
    ]);

    const record = await assessFeedbackGuardrailsDimension(root);

    expect(record.status).toBe(SKIP);
    expectNoBlocker(record.findings);
  });

  it("still stands B4 when a runbook directory exists but is empty", async () => {
    const root = await getTempDir();
    await writeRepoFile(root, "runbooks/.gitkeep", "");
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

    // An empty directory is not a way back. Accepting one would make
    // `mkdir runbooks` a one-command switch for turning B4 off.
    expect(record.status).toBe(WARN);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(true);
  });
});
