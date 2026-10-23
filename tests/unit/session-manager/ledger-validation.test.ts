/**
 * The ledger's backlog validation cache: a backlog item that failed
 * validation is remembered against its tracker `updatedAt`, so the manager
 * re-validates it once per edit rather than once per cycle, and forgets it
 * once the item is promoted.
 * @module tests/unit/session-manager/ledger-validation
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearValidationFailure,
  readLedger,
  recordValidationFailure,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/ledger.mjs";

const REF = "TEAM-7";
const AT = "2026-10-23T12:00:00.000Z";
const UPDATED = "2026-10-20T08:00:00.000Z";
const seams = { now: () => new Date(AT) };

describe("ledger validation failures", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-sm-validation-"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("records a failure against the item's updatedAt", async () => {
    const entry = await recordValidationFailure(
      root,
      { ref: REF, updatedAt: UPDATED, reason: "S4, S18" },
      seams
    );
    expect(entry).toEqual({ updatedAt: UPDATED, at: AT, reason: "S4, S18" });
    expect((await readLedger(root)).validationFailures).toEqual({
      [REF]: entry,
    });
  });

  it("replaces an older failure for the same ref", async () => {
    await recordValidationFailure(root, { ref: REF, updatedAt: "old" }, seams);
    await recordValidationFailure(
      root,
      { ref: REF, updatedAt: UPDATED },
      seams
    );
    const failures = (await readLedger(root)).validationFailures;
    expect(Object.keys(failures)).toEqual([REF]);
    expect(failures[REF]?.updatedAt).toBe(UPDATED);
    expect(failures[REF]?.reason).toBeNull();
  });

  it("refuses a failure without updatedAt, which could never expire", async () => {
    await expect(
      recordValidationFailure(root, { ref: REF, updatedAt: "" }, seams)
    ).rejects.toThrow(/updatedAt/);
  });

  it("clears a failure and reports whether one existed", async () => {
    await recordValidationFailure(
      root,
      { ref: REF, updatedAt: UPDATED },
      seams
    );
    expect(await clearValidationFailure(root, { ref: REF }, seams)).toEqual({
      cleared: true,
    });
    expect(await clearValidationFailure(root, { ref: REF }, seams)).toEqual({
      cleared: false,
    });
    expect((await readLedger(root)).validationFailures).toEqual({});
  });

  it("keeps items and control untouched", async () => {
    const before = await readLedger(root);
    await recordValidationFailure(
      root,
      { ref: REF, updatedAt: UPDATED },
      seams
    );
    const after = await readLedger(root);
    expect(after.items).toEqual(before.items);
    expect(after.control).toEqual(before.control);
  });
});
