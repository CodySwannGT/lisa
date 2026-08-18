/**
 * Tests that an append leaves rows it did not author alone (#2682, #2578).
 *
 * The recorder rewrites the whole ledger on every append. These tests pin the
 * two ways that rewrite used to damage history: a stored `refs` shape the
 * writer did not recognise came back as `[]`, and a row that failed validation
 * came back as nothing at all. Both losses were silent, retroactive, and
 * inflicted by a loop that had no reason to touch the row.
 * @module tests/unit/strategies/automation-run-record-preservation
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readAutomationRunRecords,
  recordAutomationRun,
} from "../../../plugins/src/base/scripts/automation-run-record.mjs";

const LOOP_ID = "intake-build";
const RUNBOOK_PATH = ".lisa/automations/intake-build.runbook.md";
const RECORDS_PATH = ".lisa/automations/runs/intake-build.jsonl";
const CONFIG_PATH = ".lisa.config.json";
const NOTHING_NEEDED = "nothing-needed";
const BASE_TS = "2026-07-20T07:00:00.000Z";
const A_REF = "https://example.invalid/1";

const OBJECT_REFS = Object.freeze({
  tickets: ["ABC-1"],
  prs: [42],
  commits: ["deadbeef"],
});
const OBJECT_REFS_ROW = JSON.stringify({
  ts: BASE_TS,
  loop_id: LOOP_ID,
  outcome: "change-proved",
  summary: "prior run with object-shaped refs",
  runbook: RUNBOOK_PATH,
  refs: OBJECT_REFS,
  run_id: "run-1",
});
const UNPARSEABLE_ROW = '{"truncated"';

let root: string;

const put = (rel: string, contents: string): void => {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
};

const readLines = (rel: string): string[] =>
  readFileSync(path.join(root, rel), "utf8").trim().split(/\n/);

const appendUnrelated = async (runId: string): Promise<void> => {
  await recordAutomationRun({
    projectRoot: root,
    loopId: LOOP_ID,
    outcome: NOTHING_NEEDED,
    summary: "an unrelated later append",
    runbook: RUNBOOK_PATH,
    runId,
    ts: "2026-07-20T07:05:00.000Z",
  });
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-run-record-preserve-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("prior rows survive an append they did not author (#2682, #2578)", () => {
  it("leaves a prior object-shaped refs row byte-identical", async () => {
    put(RECORDS_PATH, `${OBJECT_REFS_ROW}\n`);

    await appendUnrelated("run-2");

    expect(readLines(RECORDS_PATH)[0]).toBe(OBJECT_REFS_ROW);
  });

  it("never replaces a refs value it cannot normalize with an empty array", async () => {
    put(RECORDS_PATH, `${OBJECT_REFS_ROW}\n`);

    await appendUnrelated("run-2");
    const { records } = await readAutomationRunRecords(
      path.join(root, RECORDS_PATH)
    );

    expect(records[0]?.refs).toEqual(OBJECT_REFS);
  });

  it("survives repeated appends rather than losing refs on the first one", async () => {
    put(RECORDS_PATH, `${OBJECT_REFS_ROW}\n`);

    await appendUnrelated("run-2");
    await appendUnrelated("run-3");
    await appendUnrelated("run-4");

    expect(readLines(RECORDS_PATH)[0]).toBe(OBJECT_REFS_ROW);
  });

  it("keeps a row it could not validate instead of deleting it (#2578)", async () => {
    put(RECORDS_PATH, `${UNPARSEABLE_ROW}\n`);

    await appendUnrelated("run-2");
    const lines = readLines(RECORDS_PATH);

    expect(lines[0]).toBe(UNPARSEABLE_ROW);
    expect(lines).toHaveLength(2);
  });

  it("refuses to author a new record whose refs cannot be stored as written", async () => {
    await expect(
      recordAutomationRun({
        projectRoot: root,
        loopId: LOOP_ID,
        outcome: NOTHING_NEEDED,
        summary: "refs the writer cannot store",
        runbook: RUNBOOK_PATH,
        runId: "run-1",
        ts: BASE_TS,
        refs: OBJECT_REFS as unknown as readonly string[],
      })
    ).rejects.toThrow("must be an array of strings");
  });

  it("still appends a well-formed record unchanged", async () => {
    const result = await recordAutomationRun({
      projectRoot: root,
      loopId: LOOP_ID,
      outcome: NOTHING_NEEDED,
      summary: "well-formed",
      runbook: RUNBOOK_PATH,
      runId: "run-1",
      ts: BASE_TS,
      refs: [A_REF],
    });

    expect(result.appended).toBe(true);
    expect(result.record.refs).toEqual([A_REF]);
    expect(JSON.parse(readLines(RECORDS_PATH)[0] ?? "{}")).toMatchObject({
      run_id: "run-1",
      refs: [A_REF],
    });
  });

  it("trims the bound over every stored line, unvalidatable ones included", async () => {
    put(
      CONFIG_PATH,
      JSON.stringify({ automations: { runHistory: { maxEntries: 2 } } })
    );
    put(RECORDS_PATH, `${UNPARSEABLE_ROW}\n${OBJECT_REFS_ROW}\n`);

    await appendUnrelated("run-2");

    const lines = readLines(RECORDS_PATH);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(OBJECT_REFS_ROW);
  });
});
