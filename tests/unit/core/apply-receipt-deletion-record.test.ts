/**
 * The carry-forward rule for the apply receipt's deletion record
 * (CodySwannGT/lisa#4071).
 *
 * A plain install applies twice — once from the postinstall, once from the
 * detached reconciliation trampoline — and the second apply is idempotent, so it
 * removes nothing. Letting that emptiness win erased the only durable record of
 * a removal, written over by a process running with `stdio: "ignore"`.
 *
 * These cases pin the rule directly, one branch each, so the integration
 * reproduction is not the only thing standing between the fleet and a silent
 * regression.
 * @module tests/unit/core/apply-receipt-deletion-record
 */
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";

import type { ApplyReceipt } from "../../../src/core/apply-receipt.js";
import {
  readApplyReceipt,
  recordSuccessfulApply,
  resolveDeletionRecord,
} from "../../../src/core/apply-receipt.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

const REMOVED = ".github/workflows/retired.yml";
const NEWLY_REMOVED = ".claude/skills/renamed-away";
const EARLIER = "2026-01-01T00:00:00.000Z";
const NOW = "2026-02-02T00:00:00.000Z";

/**
 * A receipt that already recorded one removal.
 * @param overrides - Fields the case varies
 * @returns The prior receipt
 */
function priorReceipt(overrides: Partial<ApplyReceipt> = {}): ApplyReceipt {
  return {
    schema_version: 1,
    lisa_version: "1.0.0",
    applied_at: EARLIER,
    harness: "claude",
    apply_mode: "postinstall-safe",
    stale_paths: [],
    deleted_paths: [REMOVED],
    deletion_notices: [`Deleted: ${REMOVED} — a recorded ruling`],
    deletions_recorded_at: EARLIER,
    ...overrides,
  };
}

describe("resolveDeletionRecord", () => {
  it("keeps an earlier removal when this apply removed nothing", () => {
    const record = resolveDeletionRecord(
      priorReceipt(),
      { deletedPaths: [], deletionNotices: [] },
      NOW
    );

    expect(record.deleted_paths).toEqual([REMOVED]);
    // The timestamp travels with the record. Restamping it would make a
    // carried-forward removal read as something this apply just did.
    expect(record.deletions_recorded_at).toBe(EARLIER);
  });

  it("replaces the record when this apply removed something else", () => {
    const record = resolveDeletionRecord(
      priorReceipt(),
      {
        deletedPaths: [NEWLY_REMOVED],
        deletionNotices: [`Deleted: ${NEWLY_REMOVED} — renamed upstream`],
      },
      NOW
    );

    expect(record.deleted_paths).toEqual([NEWLY_REMOVED]);
    expect(record.deletions_recorded_at).toBe(NOW);
  });

  it("records nothing when there is no prior receipt and nothing went", () => {
    const record = resolveDeletionRecord(
      null,
      { deletedPaths: [], deletionNotices: [] },
      NOW
    );

    expect(record.deleted_paths).toEqual([]);
    // Null rather than NOW: no removal happened here, and a timestamp would
    // assert one did.
    expect(record.deletions_recorded_at).toBeNull();
  });

  it("keeps a refusal from an apply that removed nothing", () => {
    const refusal = `Kept (no declared basis): ${NEWLY_REMOVED} — unproven`;
    const record = resolveDeletionRecord(
      null,
      { deletedPaths: [], deletionNotices: [refusal] },
      NOW
    );

    expect(record.deletion_notices).toEqual([refusal]);
  });
});

describe("recordSuccessfulApply over an existing receipt", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(root);
  });

  it("does not let an idempotent re-apply blank the removal", async () => {
    await fs.outputJson(
      path.join(root, ".lisa", "apply-receipt.json"),
      priorReceipt()
    );

    await recordSuccessfulApply(root, {
      lisaVersion: "1.0.1",
      harness: "claude",
      applyMode: "postinstall-safe",
      stalePaths: [],
      deletedPaths: [],
      deletionNotices: [],
    });

    const receipt = await readApplyReceipt(root);
    expect(receipt?.deleted_paths).toEqual([REMOVED]);
    // The rest of the receipt is still this apply's: only the deletion record
    // is carried, and only because nothing replaced it.
    expect(receipt?.lisa_version).toBe("1.0.1");
    expect(receipt?.applied_at).not.toBe(EARLIER);
  });
});
