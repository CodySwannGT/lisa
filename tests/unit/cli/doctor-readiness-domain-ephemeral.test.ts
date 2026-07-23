/**
 * Ephemeral-evidence and runbook-suppression coverage for the domain-ownership
 * readiness producer (B1, PRD #1739, #1896).
 *
 * The sibling suite pins what B1 stands on. This one pins the two ways a
 * conservative producer can still get it wrong:
 *
 * 1. **The evidence that a target is throwaway is routinely outside the
 *    command.** `psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE"` reads as
 *    production destruction until you see the job's `env:` block pointing at
 *    `127.0.0.1`, or the `services:` container the job booted moments earlier.
 * 2. **An empty runbook directory is not a recovery procedure.** Treating one
 *    as a way back would make `mkdir docs/runbooks` a one-command switch for
 *    turning this blocker off repository-wide.
 * @module tests/unit/cli/doctor-readiness-domain-ephemeral
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { assessDomainOwnershipDimension } from "../../../src/cli/doctor-readiness-domain.js";
import {
  asFindings,
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
const BLOCKER_ID = "B1";

/** The workflow file every fixture in this suite writes. */
const CLEANUP_YML = "cleanup.yml";

/** The workflow `name:` line every fixture in this suite writes. */
const CLEANUP_NAME = "name: Cleanup";

/** A destructive job header reused across fixtures. */
const WIPE_JOB = "  wipe:";

/** An irreversible bucket-emptying command against a production bucket. */
const RUN_S3_WIPE =
  "      - run: aws s3 rm s3://acme-prod-user-uploads --recursive";

/** A schema reset aimed at whatever the job's own environment points at. */
const RUN_SCHEMA_RESET =
  '      - run: psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE"';

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("domain-ephemeral");
  return tempDir;
}

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("assessDomainOwnershipDimension — ephemeral CI evidence outside the command", () => {
  it("does not stand B1 when the job's own `env:` resolves the target to an ephemeral one", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      "    env:",
      "      DATABASE_URL: postgres://postgres@127.0.0.1:5432/app",
      STEPS,
      RUN_SCHEMA_RESET,
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(SKIP);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("does not stand B1 when the job runs against its own `services:` container", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      "on:",
      "  pull_request:",
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      "    services:",
      "      postgres:",
      "        image: postgres:16",
      STEPS,
      RUN_SCHEMA_RESET,
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(SKIP);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("does not stand B1 for the AWS CLI's own `--dryrun` rehearsal spelling", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      "      - run: aws s3 rm s3://acme-prod-uploads --recursive --dryrun",
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(SKIP);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("stands B1 for a durable bucket whose name only contains `preview`", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      "      - run: aws s3 rm s3://acme-customer-preview-recordings --recursive",
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(WARN);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(true);
  });
});

describe("assessDomainOwnershipDimension — an empty runbook directory suppresses nothing", () => {
  it("still stands B1 when `docs/runbooks/` exists but is empty", async () => {
    const root = await getTempDir();
    await writeRepoFile(root, "docs/runbooks/.gitkeep", "");
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      RUN_S3_WIPE,
    ]);

    const record = await assessDomainOwnershipDimension(root);

    // An empty directory is not a recovery procedure. Accepting one would make
    // creating that directory a one-command switch for turning B1 and B4 off.
    expect(record.status).toBe(WARN);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(true);
  });

  it("clears B1 once that directory actually holds a runbook", async () => {
    const root = await getTempDir();
    await writeRepoFile(
      root,
      "docs/runbooks/restore-uploads.md",
      "# Restore uploads\n\nRe-sync from the nightly backup bucket.\n"
    );
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      RUN_S3_WIPE,
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(SKIP);
    const findings = asFindings(record.findings);
    expect(String(findings[0].reason)).toContain("recovery runbook present");
    expect(String(findings[0].reason)).not.toContain(
      "found none running unattended and ungated"
    );
    for (const finding of findings) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });
});
