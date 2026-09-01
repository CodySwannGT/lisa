/**
 * Regression tests for CodySwannGT/lisa#2750.
 *
 * The detached lockfile-reconciliation trampoline runs `stdio: "ignore"` and its
 * regen swallowed failures, so a trampoline that never spawned, one that died on
 * arrival, and one that ran and correctly did nothing all produced the same
 * evidence: none. These tests pin the three states apart, which is the half of
 * the ticket that keeps the next regression here visible.
 */
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkLockfileReconciliation } from "../../../src/cli/doctor-reconciliation.js";
import type {
  ReconciliationOutcome,
  ReconciliationReport,
} from "../../../src/core/reconciliation-report.js";
import {
  RECONCILIATION_REPORT_SCHEMA_VERSION,
  readReconciliationReport,
  recordReconciliationScheduled,
  recordReconciliationSpawnFailure,
  resolveReconciliationReportPath,
  writeReconciliationReport,
} from "../../../src/core/reconciliation-report.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CHECK_NAME = "Lockfiles reconciled after the last apply?";
const SCHEDULED_AT = "2026-01-15T10:00:00.000Z";
const LISA_VERSION = "4.17.2";
const FROZEN_HINT = "--ignore-scripts";
/** Long after any legitimate reconciliation could still be running. */
const WELL_AFTER = "2026-06-01T00:00:00.000Z";

/**
 * Build a report fixture with a chosen outcome and age.
 * @param outcome - Outcome to record
 * @param updatedAt - ISO timestamp of the last write
 * @returns A complete report
 */
function reportWith(
  outcome: ReconciliationOutcome,
  updatedAt: string
): ReconciliationReport {
  return {
    schema_version: RECONCILIATION_REPORT_SCHEMA_VERSION,
    lisa_version: LISA_VERSION,
    outcome,
    scheduled_at: SCHEDULED_AT,
    updated_at: updatedAt,
    package_managers: outcome === "regenerated" ? ["bun"] : [],
    detail: "fixture",
  };
}

describe("lockfile reconciliation doctor check", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("stays quiet when no reconciliation has ever been scheduled", async () => {
    const check = await checkLockfileReconciliation(projectDir);

    expect(check.name).toBe(CHECK_NAME);
    expect(check.status).toBe("ok");
  });

  it("stays quiet after a regen that landed", async () => {
    await writeReconciliationReport(
      projectDir,
      reportWith("regenerated", SCHEDULED_AT)
    );

    const check = await checkLockfileReconciliation(
      projectDir,
      () => new Date(WELL_AFTER)
    );

    expect(check.status).toBe("ok");
    expect(check.detail).toContain("bun");
  });

  it("stays quiet when the child ran and correctly had nothing to do", async () => {
    await writeReconciliationReport(
      projectDir,
      reportWith("not-needed", SCHEDULED_AT)
    );

    const check = await checkLockfileReconciliation(
      projectDir,
      () => new Date(WELL_AFTER)
    );

    expect(check.status).toBe("ok");
  });

  it("reports a regen that never started, distinctly from one that started and died", async () => {
    // The whole point of writing two pending outcomes: `scheduled` is the
    // parent's word alone, so no child ever ran; `started` is the child's own
    // first act, so it ran and then stopped. Before #2750 both looked exactly
    // like the successful no-op above.
    await writeReconciliationReport(
      projectDir,
      reportWith("scheduled", SCHEDULED_AT)
    );
    const neverStarted = await checkLockfileReconciliation(
      projectDir,
      () => new Date(WELL_AFTER)
    );

    await writeReconciliationReport(
      projectDir,
      reportWith("started", SCHEDULED_AT)
    );
    const diedPartway = await checkLockfileReconciliation(
      projectDir,
      () => new Date(WELL_AFTER)
    );

    expect(neverStarted.status).toBe("warn");
    expect(neverStarted.detail).toContain("did not start");
    expect(diedPartway.status).toBe("warn");
    expect(diedPartway.detail).toContain("without finishing");
    expect(neverStarted.detail).not.toBe(diedPartway.detail);
  });

  it("does not redden a reconciliation that is still legitimately in flight", async () => {
    await writeReconciliationReport(
      projectDir,
      reportWith("started", "2026-01-15T10:00:00.000Z")
    );

    const check = await checkLockfileReconciliation(
      projectDir,
      () => new Date("2026-01-15T10:01:00.000Z")
    );

    expect(check.status).toBe("ok");
    expect(check.detail).toContain("in flight");
  });

  it("names the repair and warns off the plain re-install that recreates the drift", async () => {
    await writeReconciliationReport(
      projectDir,
      reportWith("failed", SCHEDULED_AT)
    );

    const check = await checkLockfileReconciliation(
      projectDir,
      () => new Date(WELL_AFTER)
    );

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(FROZEN_HINT);
    expect(check.detail).toContain("re-runs postinstall");
  });

  it("reports a spawn that never produced a child", async () => {
    await recordReconciliationSpawnFailure(
      projectDir,
      LISA_VERSION,
      "EACCES",
      () => new Date(SCHEDULED_AT)
    );

    const check = await checkLockfileReconciliation(
      projectDir,
      () => new Date(WELL_AFTER)
    );

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("EACCES");
  });
});

describe("reconciliation report persistence", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("records the scheduled state before any child exists", async () => {
    const written = await recordReconciliationScheduled(
      projectDir,
      LISA_VERSION,
      () => new Date(SCHEDULED_AT)
    );

    expect(written).toBe(true);
    const report = await readReconciliationReport(projectDir);
    expect(report?.outcome).toBe("scheduled");
    expect(report?.scheduled_at).toBe(SCHEDULED_AT);
    expect(report?.lisa_version).toBe(LISA_VERSION);
  });

  it("resolves one path for readers and writers", () => {
    expect(resolveReconciliationReportPath(projectDir)).toBe(
      path.join(projectDir, ".lisa", "reconciliation-report.json")
    );
  });

  it("reads an unknown schema as no report rather than misreading it", async () => {
    await writeReconciliationReport(projectDir, {
      ...reportWith("regenerated", SCHEDULED_AT),
      schema_version: 999,
    });

    expect(await readReconciliationReport(projectDir)).toBeNull();
  });

  it("reads an unrecognised outcome as pending, never as success", async () => {
    await writeReconciliationReport(projectDir, {
      ...reportWith("regenerated", SCHEDULED_AT),
      outcome: "who-knows" as ReconciliationOutcome,
    });

    const report = await readReconciliationReport(projectDir);

    expect(report?.outcome).toBe("scheduled");
  });
});
