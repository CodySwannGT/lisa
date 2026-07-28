/**
 * Unit coverage for bounded local wrapper-script expansion in the B1
 * domain-ownership readiness producer.
 * @module tests/unit/cli/doctor-readiness-local-scripts
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

/** A repo-local wrapper script used by B1 script-expansion fixtures. */
const TEARDOWN_SCRIPT = "scripts/teardown-prod.sh";

/** A destructive SQL command used by B1 script-expansion fixtures. */
const DROP_TABLE_COMMAND = 'psql "$DATABASE_URL" -c "DROP TABLE users"';

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("local-scripts");
  return tempDir;
}

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("assessDomainOwnershipDimension — local wrapper script expansion", () => {
  // Test hardened to kill mutant M001 (Risk Factor: Data loss / wrapper script visibility).
  it("stands B1 when a workflow hides the destructive command inside a local script", async () => {
    const root = await getTempDir();
    await writeRepoFile(
      root,
      TEARDOWN_SCRIPT,
      ["#!/usr/bin/env bash", "set -euo pipefail", DROP_TABLE_COMMAND].join(
        "\n"
      )
    );
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      "      - run: ./scripts/teardown-prod.sh",
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(WARN);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(true);
  });

  // Test hardened to kill mutant M002 (Risk Factor: Availability / oversized wrapper script allocation).
  it("ignores oversized local wrapper scripts instead of decoding them", async () => {
    const root = await getTempDir();
    await writeRepoFile(
      root,
      TEARDOWN_SCRIPT,
      `${"a".repeat(16_385)}\nDROP TABLE users`
    );
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      "      - run: ./scripts/teardown-prod.sh",
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(SKIP);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(false);
  });

  // Test hardened to kill mutant M003 (Risk Factor: Data loss / non-invoked wrapper false positive).
  it("does not expand local script paths that are only echoed or commented", async () => {
    const root = await getTempDir();
    await writeRepoFile(root, TEARDOWN_SCRIPT, DROP_TABLE_COMMAND);
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      "      - run: |",
      "          echo ./scripts/teardown-prod.sh",
      "          # ./scripts/teardown-prod.sh",
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(SKIP);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(false);
  });

  // Test hardened to kill mutant M004 (Risk Factor: Data loss / explicit shell runner visibility).
  it("expands top-level scripts when an explicit shell runner invokes them", async () => {
    const root = await getTempDir();
    await writeRepoFile(root, "teardown-prod.sh", DROP_TABLE_COMMAND);
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      "      - run: bash teardown-prod.sh",
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(WARN);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(true);
  });

  // Test hardened to kill mutant M005 (Risk Factor: Data loss / env-prefixed wrapper visibility).
  it("expands local scripts after environment assignment prefixes", async () => {
    const root = await getTempDir();
    await writeRepoFile(root, TEARDOWN_SCRIPT, DROP_TABLE_COMMAND);
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      "      - run: DATABASE_URL=postgres://prod ./scripts/teardown-prod.sh",
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(WARN);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(true);
  });

  // Test hardened to kill mutant M006 (Risk Factor: Data loss / shell runner option visibility).
  it("expands local scripts after shell runner options", async () => {
    const root = await getTempDir();
    await writeRepoFile(root, TEARDOWN_SCRIPT, DROP_TABLE_COMMAND);
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      "      - run: bash -e ./scripts/teardown-prod.sh",
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(WARN);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(true);
  });

  // Test hardened to kill mutant M007 (Risk Factor: Availability / aggregate wrapper expansion budget).
  it("caps aggregate local wrapper expansion across one scan", async () => {
    const root = await getTempDir();
    const indices = Array.from({ length: 65 }, (_value, index) => index);
    await Promise.all(
      indices.map(async index => {
        const script = `scripts/wrapper-${index}.sh`;
        await writeRepoFile(
          root,
          script,
          index === 64 ? DROP_TABLE_COMMAND : "echo safe"
        );
      })
    );
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      "      - run: |",
      ...indices.map(index => `          ./scripts/wrapper-${index}.sh`),
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(SKIP);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(false);
  });
});
