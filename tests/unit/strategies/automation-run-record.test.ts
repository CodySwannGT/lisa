/**
 * Tests for the durable per-run automation outcome substrate (#1797).
 *
 * The helper is dependency-free and shared by every registered Lisa automation
 * loop: one bounded JSONL file per loop, with closed outcome vocabulary and
 * idempotent per-invocation writes.
 * @module tests/unit/strategies/automation-run-record
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

import {
  AUTOMATION_RUN_OUTCOMES,
  automationRunRecordPath,
  readAutomationRunRecords,
  recordAutomationRun,
  resolveAutomationRunHistoryMaxEntries,
} from "../../../plugins/src/base/scripts/automation-run-record.mjs";

const LOOP_ID = "intake-build";
const RUNBOOK_PATH = ".lisa/automations/intake-build.runbook.md";
const RECORDS_PATH = ".lisa/automations/runs/intake-build.jsonl";
const NOTHING_NEEDED = "nothing-needed";
const BASE_TS = "2026-07-20T07:00:00.000Z";

let root: string;

const put = (rel: string, contents: string): void => {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
};

const readLines = (rel: string): string[] =>
  readFileSync(path.join(root, rel), "utf8").trim().split(/\n/);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-run-record-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("automation run records (#1797)", () => {
  it("appends exactly one operator-readable record for a run", async () => {
    const result = await recordAutomationRun({
      projectRoot: root,
      loopId: LOOP_ID,
      outcome: NOTHING_NEEDED,
      summary: "Scanned 0 ready issues; nothing to propose.",
      runbook: RUNBOOK_PATH,
      refs: ["https://github.com/CodySwannGT/lisa/issues/1797"],
      runId: "run-1",
      ts: BASE_TS,
    });

    expect(result.appended).toBe(true);
    expect(result.record).toMatchObject({
      loop_id: LOOP_ID,
      outcome: NOTHING_NEEDED,
      summary: "Scanned 0 ready issues; nothing to propose.",
      runbook: RUNBOOK_PATH,
      refs: ["https://github.com/CodySwannGT/lisa/issues/1797"],
      run_id: "run-1",
    });
    expect(readLines(RECORDS_PATH)).toHaveLength(1);
  });

  it("trims history at the configured bound", async () => {
    put(
      ".lisa.config.json",
      JSON.stringify({ automations: { runHistory: { maxEntries: 2 } } })
    );

    for (const runId of ["run-1", "run-2", "run-3"]) {
      await recordAutomationRun({
        projectRoot: root,
        loopId: LOOP_ID,
        outcome: "candidate-proposed",
        summary: `Recorded ${runId}.`,
        runbook: RUNBOOK_PATH,
        runId,
        ts: `2026-07-20T07:00:0${runId.at(-1)}.000Z`,
      });
    }

    const records = readLines(RECORDS_PATH).map(line => JSON.parse(line));
    expect(records.map(record => record.run_id)).toEqual(["run-2", "run-3"]);
  });

  it("lets local config override the shared history bound", async () => {
    put(
      ".lisa.config.json",
      JSON.stringify({ automations: { runHistory: { maxEntries: 4 } } })
    );
    put(
      ".lisa.config.local.json",
      JSON.stringify({ automations: { runHistory: { maxEntries: 3 } } })
    );

    await expect(resolveAutomationRunHistoryMaxEntries(root)).resolves.toBe(3);
  });

  it("skips corrupt lines instead of breaking the next append", async () => {
    put(
      ".lisa/automations/runs/intake-build.jsonl",
      [
        JSON.stringify({
          ts: BASE_TS,
          loop_id: LOOP_ID,
          outcome: NOTHING_NEEDED,
          summary: "Previous valid record.",
          runbook: RUNBOOK_PATH,
          refs: [],
          run_id: "run-1",
        }),
        '{"truncated"',
        "",
      ].join("\n")
    );

    const result = await recordAutomationRun({
      projectRoot: root,
      loopId: LOOP_ID,
      outcome: "change-proved",
      summary: "Wrote the run substrate and verified append behavior.",
      runbook: RUNBOOK_PATH,
      runId: "run-2",
      ts: "2026-07-20T07:01:00.000Z",
    });

    expect(result.skippedCorruptLines).toBe(1);
    expect(result.records.map(record => record.run_id)).toEqual([
      "run-1",
      "run-2",
    ]);
  });

  it("rejects outcomes outside the closed six-value vocabulary", async () => {
    await expect(
      recordAutomationRun({
        projectRoot: root,
        loopId: LOOP_ID,
        outcome: "blocked",
        summary: "This should not be recorded.",
        runbook: RUNBOOK_PATH,
        runId: "run-1",
      })
    ).rejects.toThrow(AUTOMATION_RUN_OUTCOMES.join(", "));
  });

  it("suppresses duplicate re-appends for the same run_id", async () => {
    const input = {
      projectRoot: root,
      loopId: LOOP_ID,
      outcome: "approval-requested",
      summary: "Deploy approval is waiting.",
      runbook: RUNBOOK_PATH,
      runId: "same-run",
      ts: BASE_TS,
    } as const;

    await recordAutomationRun(input);
    const second = await recordAutomationRun(input);

    expect(second.appended).toBe(false);
    expect(readLines(RECORDS_PATH)).toHaveLength(1);
  });

  it("stores each loop under its bounded local runs directory", () => {
    expect(automationRunRecordPath(root, "monitor")).toBe(
      path.join(root, ".lisa/automations/runs/monitor.jsonl")
    );
  });

  it("documents the local runs directory as ignored project state", () => {
    const gitignore = readFileSync(path.resolve(".gitignore"), "utf8");
    expect(gitignore).toContain(".lisa/automations/runs/");
  });

  it("keeps the distributed script artifact in lockstep with the source script", () => {
    const sourcePath = path.resolve(
      "plugins/src/base/scripts/automation-run-record.mjs"
    );
    const generatedPath = path.resolve(
      "plugins/lisa/scripts/automation-run-record.mjs"
    );

    expect(existsSync(generatedPath)).toBe(true);
    expect(readFileSync(generatedPath, "utf8")).toBe(
      readFileSync(sourcePath, "utf8")
    );
  });

  it("reads a missing records file as empty history", async () => {
    await expect(
      readAutomationRunRecords(path.join(root, ".lisa/missing.jsonl"))
    ).resolves.toMatchObject({ records: [], skippedCorruptLines: 0 });
  });
});
