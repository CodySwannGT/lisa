/**
 * The reader half of CodySwannGT/lisa#4071.
 *
 * `deleted_paths` has been written on every apply since #3656 and read by
 * nothing. A record nobody reads has the same standing as the stream nobody
 * hears — which is what the install path was already using — so these cases pin
 * the check that finally reads it back, on a command an operator runs.
 * @module tests/unit/cli/doctor-apply-deletions
 */
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";

import { checkApplyDeletions } from "../../../src/cli/doctor-apply-deletions.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

const REMOVED = ".github/workflows/retired.yml";
const RULING = "Removed fleet-wide by a recorded ruling";
const REFUSED = ".github/workflows/host-authored.yml";

describe("checkApplyDeletions", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(root);
  });

  /**
   * Write a receipt for the case to read.
   * @param receipt - Receipt fields beyond the required identity
   * @returns Promise resolving once written
   */
  async function writeReceipt(receipt: Record<string, unknown>): Promise<void> {
    await fs.outputJson(path.join(root, ".lisa", "apply-receipt.json"), {
      schema_version: 1,
      lisa_version: "1.0.0",
      applied_at: "2026-02-02T00:00:00.000Z",
      harness: "claude",
      apply_mode: "postinstall-safe",
      stale_paths: [],
      ...receipt,
    });
  }

  it("names the removed file and the reason it went", async () => {
    await writeReceipt({
      deleted_paths: [REMOVED],
      deletion_notices: [`Deleted: ${REMOVED} — ${RULING}`],
      deletions_recorded_at: "2026-01-01T00:00:00.000Z",
    });

    const check = await checkApplyDeletions(root);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(REMOVED);
    expect(check.detail).toContain(RULING);
    // The date of the REMOVAL, not of the apply that carried the record.
    expect(check.detail).toContain("2026-01-01T00:00:00.000Z");
  });

  it("still names the file when an older receipt recorded no reasons", async () => {
    await writeReceipt({ deleted_paths: [REMOVED] });

    const check = await checkApplyDeletions(root);

    // "Which files" without "why" is worth more than silence. A receipt written
    // before the notices existed degrades to naming them rather than to nothing.
    expect(check.status).toBe("warn");
    expect(check.detail).toContain(REMOVED);
  });

  it("reports a refusal without calling it a removal", async () => {
    await writeReceipt({
      deleted_paths: [],
      deletion_notices: [`Kept (no declared basis): ${REFUSED} — unproven`],
    });

    const check = await checkApplyDeletions(root);

    // Nothing is missing, so this is not a warning — but the fail-closed branch
    // still has to say it ran, on a channel that is open.
    expect(check.status).toBe("ok");
    expect(check.detail).toContain(REFUSED);
  });

  it("says nothing alarming when the apply removed nothing", async () => {
    await writeReceipt({ deleted_paths: [], deletion_notices: [] });

    const check = await checkApplyDeletions(root);

    expect(check.status).toBe("ok");
    expect(check.detail).not.toContain(REMOVED);
  });

  it("defers to the apply-freshness check when there is no receipt", async () => {
    const check = await checkApplyDeletions(root);

    expect(check.status).toBe("ok");
  });
});
