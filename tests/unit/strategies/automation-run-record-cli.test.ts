/**
 * Tests for the argv-parsed CLI entrypoint of the run-record helper (#1798).
 *
 * Registered loop skills record their run outcome by spawning this script
 * (`node .../automation-run-record.mjs --loop-id … --outcome … …`), so these
 * tests spawn it end to end and assert the file written, the rejection paths,
 * and idempotent dedupe.
 * @module tests/unit/strategies/automation-run-record-cli
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AUTOMATION_RUN_OUTCOMES } from "../../../plugins/src/base/scripts/automation-run-record.mjs";

const CLI_SCRIPT = path.resolve(
  "plugins/src/base/scripts/automation-run-record.mjs"
);
const LOOP = "intake-tickets";
const RUNBOOK = ".lisa/automations/intake-tickets.runbook.md";
const RECORDS = ".lisa/automations/runs/intake-tickets.jsonl";
const NOTHING_SUMMARY = "Scanned 0 ready items; nothing to propose.";
const NOTHING_NEEDED = "nothing-needed";
const F_LOOP = "--loop-id";
const F_OUTCOME = "--outcome";
const F_SUMMARY = "--summary";
const F_RUNBOOK = "--runbook";
const F_RUN_ID = "--run-id";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-run-record-cli-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const runCli = (
  args: readonly string[]
): { status: number; stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, [CLI_SCRIPT, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

const readLines = (rel: string): string[] =>
  readFileSync(path.join(root, rel), "utf8").trim().split(/\n/);

describe("automation run record CLI (#1798)", () => {
  it("records one operator-readable outcome and writes the loop's file", () => {
    const result = runCli([
      F_LOOP,
      LOOP,
      F_OUTCOME,
      NOTHING_NEEDED,
      F_SUMMARY,
      NOTHING_SUMMARY,
      F_RUNBOOK,
      RUNBOOK,
      "--ref",
      "https://github.com/CodySwannGT/lisa/issues/1798",
      F_RUN_ID,
      "cli-run-1",
    ]);

    expect(result.status).toBe(0);
    const lines = readLines(RECORDS);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      loop_id: LOOP,
      outcome: NOTHING_NEEDED,
      summary: NOTHING_SUMMARY,
      runbook: RUNBOOK,
      refs: ["https://github.com/CodySwannGT/lisa/issues/1798"],
      run_id: "cli-run-1",
    });
    expect(JSON.parse(result.stdout)).toMatchObject({ appended: true });
  });

  it("resolves --project-root to write outside the working directory", () => {
    const projectRoot = path.join(root, "nested-project");
    mkdirSync(projectRoot, { recursive: true });
    const result = runCli([
      "--project-root",
      projectRoot,
      F_LOOP,
      "monitor",
      F_OUTCOME,
      "candidate-proposed",
      F_SUMMARY,
      "Filed #1 for the latency regression; awaiting your flip to ready.",
      F_RUNBOOK,
      ".lisa/automations/monitor.runbook.md",
      F_RUN_ID,
      "cli-monitor-1",
    ]);

    expect(result.status).toBe(0);
    expect(
      existsSync(path.join(projectRoot, ".lisa/automations/runs/monitor.jsonl"))
    ).toBe(true);
  });

  it("exits non-zero and lists the six outcomes on an invalid outcome", () => {
    const result = runCli([
      F_LOOP,
      LOOP,
      F_OUTCOME,
      "blocked",
      F_SUMMARY,
      "This should not be recorded.",
      F_RUNBOOK,
      RUNBOOK,
      F_RUN_ID,
      "cli-bad-1",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(AUTOMATION_RUN_OUTCOMES.join(", "));
    expect(existsSync(path.join(root, RECORDS))).toBe(false);
  });

  it("exits non-zero on an unknown flag without recording", () => {
    const result = runCli([
      F_LOOP,
      LOOP,
      F_OUTCOME,
      NOTHING_NEEDED,
      F_SUMMARY,
      NOTHING_SUMMARY,
      F_RUNBOOK,
      RUNBOOK,
      "--bogus",
      "value",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--bogus");
  });

  it("suppresses a duplicate re-append for the same run_id", () => {
    const args = [
      F_LOOP,
      LOOP,
      F_OUTCOME,
      "candidate-proposed",
      F_SUMMARY,
      "Proposed #1810; awaiting your flip to ready.",
      F_RUNBOOK,
      RUNBOOK,
      F_RUN_ID,
      "cli-dedupe-1",
    ];

    const first = runCli(args);
    const second = runCli(args);

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ appended: true });
    expect(JSON.parse(second.stdout)).toMatchObject({ appended: false });
    expect(readLines(RECORDS)).toHaveLength(1);
  });
});
