/**
 * Negative-case coverage for the domain-ownership readiness producer (B1,
 * PRD #1739, #1896).
 *
 * These are the cases that must leave B1 standing DOWN, and they carry more
 * weight than the positive ones. A standing blocker flips the whole repository
 * to `NOT_READY`, so a producer that fired on a gated command, a reversible
 * migration, a bare `migrations/` directory, a manually dispatched workflow, a
 * job that backs up before it destroys, or a reusable workflow whose caller is
 * invisible would be worse than no producer at all.
 * @module tests/unit/cli/doctor-readiness-domain-negatives
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
  writeRepoFile,
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

/** The workflow file every fixture in this suite writes. */
const CLEANUP_YML = "cleanup.yml";

/** The workflow `name:` line every fixture in this suite writes. */
const CLEANUP_NAME = "name: Cleanup";

/** A destructive job header reused across fixtures. */
const WIPE_JOB = "  wipe:";

/** An irreversible bucket-emptying command against a production bucket. */
const RUN_S3_WIPE =
  "      - run: aws s3 rm s3://acme-prod-user-uploads --recursive";

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("domain-negatives");
  return tempDir;
}

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});
describe("assessDomainOwnershipDimension — never manufactures RED from absence", () => {
  it("does not stand B1 when the destructive job declares an environment gate", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      "    environment: production",
      STEPS,
      RUN_S3_WIPE,
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(SKIP);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("does not stand B1 when the destructive step is behind an `if:` guard", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      "      - if: ${{ inputs.confirm_destroy == 'yes' }}",
      "        run: aws s3 rm s3://acme-prod-user-uploads --recursive",
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(SKIP);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("does not stand B1 when the same job takes a backup first", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      "      - run: aws s3 sync s3://acme-prod-user-uploads s3://acme-backup",
      RUN_S3_WIPE,
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(SKIP);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("does not stand B1 for a manually dispatched workflow", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      "on: [workflow_dispatch]",
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      RUN_S3_WIPE,
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(SKIP);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("does not stand B1 for a destructive command aimed at an ephemeral CI database", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      '      - run: psql -c "DROP DATABASE acme_test"',
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(SKIP);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("does not stand B1 for a reversible migration that drops a table", async () => {
    const root = await getTempDir();
    await writeRepoFile(
      root,
      "migrations/0007_drop_legacy_sessions.sql",
      "-- up\nDROP TABLE legacy_sessions;\n-- down\nCREATE TABLE legacy_sessions (id int);\n"
    );

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(SKIP);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("does not stand B1 for a bare migrations directory", async () => {
    const root = await getTempDir();
    await writeRepoFile(root, "migrations/.keep", "");

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(SKIP);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("does not stand B1 for a reusable workflow whose caller cannot be seen", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      "on: [workflow_call]",
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      RUN_S3_WIPE,
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(SKIP);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });
});
