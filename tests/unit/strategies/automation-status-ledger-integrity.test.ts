/**
 * A ledger holding rows the recorder cannot read is reported on the status
 * surface, not counted where nobody looks (#2578).
 *
 * `skippedCorruptLines` was computed on every read, returned by both the read
 * and the write path, and destructured by every caller — including
 * `resolveAutomationRunDisplay`, which put it on the object both status
 * adapters consume. Neither adapter ever looked at it. A counter nobody reads
 * is not a control, and this one was the only signal that a loop's own history
 * had been damaged.
 * @module tests/unit/strategies/automation-status-ledger-integrity
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resolveAutomationRunDisplay,
  resolveLedgerIntegrityFinding,
} from "../../../plugins/src/base/scripts/automation-status-run-history.mjs";

const LOOP_ID = "intake-build";
const RUNBOOK_PATH = ".lisa/automations/intake-build.runbook.md";
const RECORDS_PATH = ".lisa/automations/runs/intake-build.jsonl";
const QUARANTINE_PATH = ".lisa/automations/runs/intake-build.quarantine.jsonl";

/** A line no JSON parser will accept — the shape of a truncated write. */
const UNREADABLE_ROW = '{"truncated"';

const READABLE_ROW = JSON.stringify({
  ts: "2026-07-20T06:59:00.000Z",
  loop_id: LOOP_ID,
  outcome: "change-proved",
  summary: "an earlier well-formed run",
  runbook: RUNBOOK_PATH,
  refs: [],
  run_id: "run-0",
});

let root: string;

const put = (rel: string, contents: string): void => {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-ledger-integrity-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a ledger with unreadable rows is reported (#2578)", () => {
  it("calls it drift rather than leaving the row silently out of history", async () => {
    put(RECORDS_PATH, `${UNREADABLE_ROW}\n${READABLE_ROW}\n`);

    const display = await resolveAutomationRunDisplay({
      projectRoot: root,
      loopId: LOOP_ID,
      runbookPath: RUNBOOK_PATH,
    });

    expect(resolveLedgerIntegrityFinding(display)).toMatchObject({
      status: "DRIFTED",
    });
  });

  it("points the operator at the file rather than at a count", async () => {
    put(RECORDS_PATH, `${UNREADABLE_ROW}\n${READABLE_ROW}\n`);

    const display = await resolveAutomationRunDisplay({
      projectRoot: root,
      loopId: LOOP_ID,
      runbookPath: RUNBOOK_PATH,
    });

    expect(resolveLedgerIntegrityFinding(display)?.remediation).toContain(
      path.join(root, RECORDS_PATH)
    );
  });

  it("says where the bytes go instead of implying they are lost", async () => {
    put(RECORDS_PATH, `${UNREADABLE_ROW}\n`);

    const display = await resolveAutomationRunDisplay({
      projectRoot: root,
      loopId: LOOP_ID,
      runbookPath: RUNBOOK_PATH,
    });

    expect(resolveLedgerIntegrityFinding(display)?.remediation).toContain(
      path.join(root, QUARANTINE_PATH)
    );
  });

  it("reports nothing for a ledger it can read end to end", async () => {
    put(RECORDS_PATH, `${READABLE_ROW}\n`);

    const display = await resolveAutomationRunDisplay({
      projectRoot: root,
      loopId: LOOP_ID,
      runbookPath: RUNBOOK_PATH,
    });

    expect(resolveLedgerIntegrityFinding(display)).toBeNull();
  });

  it("reports nothing for a loop that has never recorded a run", async () => {
    const display = await resolveAutomationRunDisplay({
      projectRoot: root,
      loopId: LOOP_ID,
      runbookPath: RUNBOOK_PATH,
    });

    expect(resolveLedgerIntegrityFinding(display)).toBeNull();
  });
});
