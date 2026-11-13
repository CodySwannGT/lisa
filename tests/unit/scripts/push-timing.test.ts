/**
 * The per-gate push timing report (CodySwannGT/lisa#4591).
 *
 * Every success measure on the fast-push epic is a measured delta, so a push
 * has to leave a record of how long each gate took and how loaded the host
 * was. These tests cover the pure pieces — the report shape, the file name,
 * the one-line summary, pruning — and that a write failure warns instead of
 * throwing, because the report must never change a gate verdict.
 * @module tests/unit/scripts/push-timing
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  formatDuration,
  formatTimingLine,
  reportFileName,
  timingReport,
  writeTimingReport,
} from "../../../all/copy-overwrite/scripts/lib/push-timing.mjs";

const STARTED_MS = Date.UTC(2026, 10, 2, 10, 15, 3, 456);
const FINISHED_MS = STARTED_MS + 252_000;
const SLOW = "test-correctness";
const PASSED_STATE = "passed";
const REQUIRED = "required";
const COV_COMMAND = "bun run test:cov";
const REPORT_NAME = "2026-11-02T10-15-03Z.json";
const DIR_NAME = "push-timing";
const roots: string[] = [];

/**
 * A private directory removed after each test.
 * @returns Absolute path of the directory
 */
function scratch(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-push-timing-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/** A gate run shaped like the one `runGates` returns. */
const RESULT = {
  moment: "push",
  results: [
    {
      id: "type-correctness",
      level: REQUIRED,
      command: "bun run typecheck",
      state: PASSED_STATE,
      code: 0,
      startedAt: new Date(STARTED_MS).toISOString(),
      durationMs: 40_000,
      provedBy: null,
    },
    {
      id: SLOW,
      level: REQUIRED,
      command: COV_COMMAND,
      state: "failed",
      code: 1,
      startedAt: new Date(STARTED_MS + 40_000).toISOString(),
      durationMs: 171_000,
      provedBy: null,
    },
    {
      id: "coverage-adequacy",
      level: REQUIRED,
      command: COV_COMMAND,
      state: "unprovable",
      code: 1,
      startedAt: new Date(STARTED_MS + 211_000).toISOString(),
      durationMs: 0,
      provedBy: SLOW,
    },
    {
      id: "test-integration",
      level: REQUIRED,
      command: "bun run test:integration",
      state: "not-run",
      code: null,
      startedAt: null,
      durationMs: 0,
      provedBy: null,
    },
  ],
};

/**
 * Build a report from the fixture run with fixed host readings.
 * @returns The report document
 */
function report() {
  return timingReport({
    moment: "push",
    startedAtMs: STARTED_MS,
    finishedAtMs: FINISHED_MS,
    cores: 18,
    start: { loadavg: [3.1, 2, 1], freeMem: 1000 },
    end: { loadavg: [5.4, 3, 2], freeMem: 900 },
    versions: { node: "22.0.0", bun: "1.2.0" },
    head: "abc123",
    tree: "def456",
    result: RESULT,
  });
}

describe("timingReport", () => {
  it("records the run fields, including load and memory at both ends", () => {
    const doc = report();
    expect(doc).toMatchObject({
      startedAt: "2026-11-02T10:15:03.456Z",
      finishedAt: new Date(FINISHED_MS).toISOString(),
      wallMs: 252_000,
      moment: "push",
      cores: 18,
      loadavgStart: [3.1, 2, 1],
      loadavgEnd: [5.4, 3, 2],
      freeMemStart: 1000,
      freeMemEnd: 900,
      node: "22.0.0",
      bun: "1.2.0",
      head: "abc123",
      tree: "def456",
    });
  });

  it("lists every gate with its state, exit code, and duration", () => {
    const gates = report().gates;
    expect(gates.map(gate => gate.id)).toEqual(
      RESULT.results.map(entry => entry.id)
    );
    expect(gates[1]).toEqual({
      id: SLOW,
      level: REQUIRED,
      command: COV_COMMAND,
      state: "FAILED",
      exitCode: 1,
      startedAt: RESULT.results[1]?.startedAt,
      durationMs: 171_000,
      provedBy: null,
    });
    expect(gates[2]).toMatchObject({ state: "UNPROVABLE", provedBy: SLOW });
    expect(gates[3]).toMatchObject({ state: "NOT_RUN", exitCode: null });
  });
});

describe("reportFileName", () => {
  it("is the ISO start, colon-free and without milliseconds", () => {
    expect(reportFileName(STARTED_MS)).toBe(REPORT_NAME);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0s"],
    [999, "1s"],
    [59_000, "59s"],
    [252_000, "4m12s"],
    [3_723_000, "1h2m3s"],
  ])("renders %i ms as %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("formatTimingLine", () => {
  it("names wall time, gate count, slowest gate, load, and the path", () => {
    expect(formatTimingLine(report(), `.lisa/push-timing/${REPORT_NAME}`)).toBe(
      "⏱ push 4m12s · 4 gates · slowest test-correctness 2m51s · " +
        "load 3.1→5.4/18 cores · .lisa/push-timing/2026-11-02T10-15-03Z.json"
    );
  });
});

describe("writeTimingReport", () => {
  it("writes the report as JSON named by its start time", () => {
    const dir = path.join(scratch(), ".lisa", DIR_NAME);
    const written = writeTimingReport(report(), { dir, warn: () => {} });
    expect(written).toBe(path.join(dir, REPORT_NAME));
    const parsed = JSON.parse(readFileSync(String(written), "utf8"));
    expect(parsed.gates).toHaveLength(4);
  });

  it("does not overwrite a report started in the same second", () => {
    const dir = scratch();
    const first = writeTimingReport(report(), { dir, warn: () => {} });
    const second = writeTimingReport(report(), { dir, warn: () => {} });
    expect(second).not.toBe(first);
    expect(readdirSync(dir)).toHaveLength(2);
  });

  it("keeps only the newest reports", () => {
    const dir = scratch();
    for (const name of [
      "2026-01-01T00-00-00Z.json",
      "2026-01-02T00-00-00Z.json",
      "2026-01-03T00-00-00Z.json",
      "notes.txt",
    ]) {
      writeFileSync(path.join(dir, name), "{}");
    }
    writeTimingReport(report(), { dir, keep: 2, warn: () => {} });
    expect(readdirSync(dir).sort((a, b) => a.localeCompare(b))).toEqual([
      "2026-01-03T00-00-00Z.json",
      REPORT_NAME,
      "notes.txt",
    ]);
  });

  it("warns and returns null instead of throwing when it cannot write", () => {
    const blocker = path.join(scratch(), "file");
    writeFileSync(blocker, "not a directory");
    const warnings: string[] = [];
    const written = writeTimingReport(report(), {
      dir: path.join(blocker, DIR_NAME),
      warn: line => warnings.push(line),
    });
    expect(written).toBeNull();
    expect(warnings.join("\n")).toMatch(/timing report/u);
    expect(existsSync(path.join(blocker, DIR_NAME))).toBe(false);
  });
});

describe("reports are ignored by version control", () => {
  const repoRoot = path.resolve(import.meta.dirname, "../../..");
  it.each([".gitignore", "all/copy-contents/gitignore"])(
    "%s ignores .lisa/push-timing/",
    file => {
      const lines = readFileSync(path.join(repoRoot, file), "utf8").split("\n");
      expect(lines).toContain(".lisa/push-timing/");
    }
  );
});
