/**
 * A row the recorder cannot read is evidence, and evidence is not deleted or
 * silently counted (#2578).
 *
 * Two halves, both of which used to fail quietly.
 *
 * The first is destruction. Keeping an unreadable row in place — the #2682 fix
 * — stopped the NEXT append from deleting it, but the history bound applies to
 * every stored line, so the row sat in the window counting down and was gone
 * once `maxEntries` appends had pushed past it. Nothing was reported, and
 * `skippedCorruptLines` dropped back to 0 afterwards, so a destroyed row looked
 * exactly like one that never existed. It is now copied to a sidecar before the
 * trim, and an append that cannot save it refuses rather than proceeding.
 *
 * The second is silence. `skippedCorruptLines` was computed on every read,
 * returned by the read and the write path, and destructured by every caller —
 * and printed by none of them. A counter nobody reads is not a control.
 * @module tests/unit/strategies/automation-run-record-quarantine
 */
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { recordAutomationRun } from "../../../plugins/src/base/scripts/automation-run-record.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const CLI_SCRIPT = path.resolve(
  "plugins/src/base/scripts/automation-run-record.mjs"
);
const LOOP_ID = "intake-build";
const RUNBOOK_PATH = ".lisa/automations/intake-build.runbook.md";
const RECORDS_PATH = ".lisa/automations/runs/intake-build.jsonl";
const QUARANTINE_PATH = ".lisa/automations/runs/intake-build.quarantine.jsonl";
const CONFIG_PATH = ".lisa.config.json";
const NOTHING_NEEDED = "nothing-needed";
const CHANGE_PROVED = "change-proved";

/** The summary the CLI cases record; identical across them by design. */
const BAD_ROW_SUMMARY = "A run against a ledger with a bad row.";

/** A line no JSON parser will accept — the shape of a truncated write. */
const UNREADABLE_ROW = '{"truncated"';

/** A well-formed prior row: the control the bound may evict freely. */
const READABLE_ROW = JSON.stringify({
  ts: "2026-07-20T06:59:00.000Z",
  loop_id: LOOP_ID,
  outcome: CHANGE_PROVED,
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

const read = (rel: string): string =>
  readFileSync(path.join(root, rel), "utf8");

const boundHistoryTo = (maxEntries: number): void =>
  put(
    CONFIG_PATH,
    JSON.stringify({ automations: { runHistory: { maxEntries } } })
  );

const appendUnrelated = async (
  runId: string
): Promise<{ readonly quarantinedLines: number }> =>
  recordAutomationRun({
    projectRoot: root,
    loopId: LOOP_ID,
    outcome: NOTHING_NEEDED,
    summary: "an unrelated later append",
    runbook: RUNBOOK_PATH,
    runId,
    ts: "2026-07-20T07:05:00.000Z",
  });

/**
 * Append unrelated runs one after another, collecting what each one rescued.
 *
 * Recursive rather than looped because each append reads the file the previous
 * one wrote, so they cannot overlap.
 * @param count - How many unrelated appends to perform
 * @param index - 1-based position of the next append
 * @returns The per-append quarantined-line counts, in order
 */
const appendSequence = async (
  count: number,
  index = 1
): Promise<readonly number[]> => {
  if (index > count) return [];
  const { quarantinedLines } = await appendUnrelated(`run-${index}`);
  return [quarantinedLines, ...(await appendSequence(count, index + 1))];
};

/**
 * Run the recorder CLI against the temp project the way a loop skill does.
 * @param summary - The operator-readable one-liner the run records
 * @returns The CLI's exit status and captured streams
 */
const runRecorderCli = (
  summary: string
): {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
} => {
  const result = boundedSpawnSync({
    label: "automation-run-record.mjs",
    command: process.execPath,
    args: [
      CLI_SCRIPT,
      "--loop-id",
      LOOP_ID,
      "--outcome",
      CHANGE_PROVED,
      "--summary",
      summary,
      "--runbook",
      RUNBOOK_PATH,
    ],
    cwd: root,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-run-record-quarantine-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("an unreadable row survives the history bound (#2578)", () => {
  it("keeps the bytes verbatim in a sidecar when the bound evicts it", async () => {
    boundHistoryTo(3);
    put(RECORDS_PATH, `${UNREADABLE_ROW}\n`);

    await appendSequence(4);

    expect(read(QUARANTINE_PATH).trim().split(/\n/)).toEqual([UNREADABLE_ROW]);
  });

  it("reports how many rows it rescued rather than only counting them", async () => {
    boundHistoryTo(3);
    put(RECORDS_PATH, `${UNREADABLE_ROW}\n`);

    expect(await appendSequence(4)).toEqual([0, 0, 1, 0]);
  });

  it("still trims the ledger to the configured bound", async () => {
    boundHistoryTo(3);
    put(RECORDS_PATH, `${UNREADABLE_ROW}\n`);

    await appendSequence(4);

    expect(read(RECORDS_PATH).trim().split(/\n/)).toHaveLength(3);
  });

  it("does not quarantine a well-formed row the bound evicts", async () => {
    // The bounded history is the contract for readable rows: ageing one out is
    // the design working, not evidence of anything, and copying it to a sidecar
    // would turn a bounded file into an unbounded one.
    boundHistoryTo(2);
    put(RECORDS_PATH, `${READABLE_ROW}\n`);

    await appendSequence(3);

    expect(existsSync(path.join(root, QUARANTINE_PATH))).toBe(false);
  });

  it("writes no sidecar at all while nothing has been evicted", async () => {
    boundHistoryTo(50);
    put(RECORDS_PATH, `${UNREADABLE_ROW}\n`);

    await appendSequence(1);

    expect(existsSync(path.join(root, QUARANTINE_PATH))).toBe(false);
  });

  it("refuses the append when the evidence cannot be saved", async () => {
    // Fail closed on the one step that is irreversible. Swallowing a failed
    // sidecar write and trimming anyway would delete the row exactly as before,
    // with an extra layer of machinery claiming it had been rescued.
    boundHistoryTo(3);
    put(RECORDS_PATH, `${UNREADABLE_ROW}\n`);
    mkdirSync(path.join(root, QUARANTINE_PATH), { recursive: true });
    await appendSequence(2);

    await expect(appendUnrelated("run-3")).rejects.toThrow();
  });

  it("leaves the row in the ledger when the sidecar write failed", async () => {
    boundHistoryTo(3);
    put(RECORDS_PATH, `${UNREADABLE_ROW}\n`);
    mkdirSync(path.join(root, QUARANTINE_PATH), { recursive: true });
    await appendSequence(2);

    await appendUnrelated("run-3").catch(() => undefined);

    expect(read(RECORDS_PATH)).toContain(UNREADABLE_ROW);
  });
});

describe("unreadable rows are reported, not just counted (#2578)", () => {
  it("puts the count in the CLI's own result", () => {
    put(RECORDS_PATH, `${UNREADABLE_ROW}\n`);

    const result = runRecorderCli(BAD_ROW_SUMMARY);

    expect(JSON.parse(result.stdout)).toMatchObject({
      skipped_corrupt_lines: 1,
    });
  });

  it("says so in words an operator can act on, not only as a number", () => {
    put(RECORDS_PATH, `${UNREADABLE_ROW}\n`);

    const result = runRecorderCli(BAD_ROW_SUMMARY);

    expect(result.stderr).toContain(RECORDS_PATH);
    expect(result.stderr).toContain(QUARANTINE_PATH);
  });

  it("does not fail a run whose own append succeeded", () => {
    // The append worked. Reporting a successful write as a failed one is the
    // same defect pointed the other way, and it would fire on every cycle of
    // that loop until someone edited the file.
    put(RECORDS_PATH, `${UNREADABLE_ROW}\n`);

    expect(runRecorderCli(BAD_ROW_SUMMARY).status).toBe(0);
  });

  it("stays silent about a ledger it can read end to end", () => {
    put(RECORDS_PATH, `${READABLE_ROW}\n`);

    expect(runRecorderCli("A run against a healthy ledger.").stderr).toBe("");
  });
});
