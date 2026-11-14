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
  failingTestFiles,
  formatDuration,
  formatTimingLine,
  MAX_FAILING_TEST_FILES,
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
      failingTestFiles: [],
      failingTestFilesTruncated: false,
    });
    expect(gates[2]).toMatchObject({ state: "UNPROVABLE", provedBy: SLOW });
    expect(gates[3]).toMatchObject({ state: "NOT_RUN", exitCode: null });
  });

  it("reports a remembered pass as CACHED, not as a zero-time PASSED", () => {
    const doc = timingReport({
      moment: "push",
      startedAtMs: STARTED_MS,
      finishedAtMs: FINISHED_MS,
      cores: 18,
      start: { loadavg: [1, 1, 1], freeMem: 1 },
      end: { loadavg: [1, 1, 1], freeMem: 1 },
      versions: { node: "22.0.0", bun: "1.2.0" },
      head: "abc123",
      tree: "def456",
      result: {
        ...RESULT,
        results: [
          {
            ...RESULT.results[0],
            state: "passed",
            cached: true,
            durationMs: 0,
          },
        ],
      },
    });
    expect(doc.gates[0]).toMatchObject({ state: "CACHED", durationMs: 0 });
  });
});

/**
 * Build a report whose only gate is the given result entry.
 * @param entry - One `runGates` result entry
 * @returns The single gate record
 */
function onlyGate(entry: Record<string, unknown>) {
  return timingReport({
    moment: "push",
    startedAtMs: STARTED_MS,
    finishedAtMs: FINISHED_MS,
    cores: 1,
    start: { loadavg: [1, 1, 1], freeMem: 1 },
    end: { loadavg: [1, 1, 1], freeMem: 1 },
    versions: { node: null, bun: null },
    head: null,
    tree: null,
    result: { results: [entry] },
  }).gates[0];
}

const ROOT = "/work/repo";
const VITEST_A = "tests/unit/a.test.ts";
const VITEST_B = "tests/integration/b.test.ts";
const JEST_C = "src/c.test.tsx";

/** Gate output carrying Vitest and Jest failure lines, duplicates, and noise. */
const MIXED_OUTPUT = [
  " RUN  v3.2.4 /work/repo",
  ` ✓ |unit| tests/unit/ok.test.ts (3 tests) 12ms`,
  ` FAIL  |unit| ${VITEST_A} > widget > renders`,
  ` FAIL  |unit| ${VITEST_A} > widget > updates`,
  `\u001b[31m FAIL \u001b[39m |integration| ${VITEST_B} [ ${VITEST_B} ]`,
  ` FAIL  ${VITEST_A} > no project tag`,
  `FAIL ${JEST_C} (5.12 s)`,
  `FAIL ./src/d.test.js`,
  `FAIL ${ROOT}/src/e.test.ts`,
  "FAIL /elsewhere/outside.test.ts",
  "FAIL ../escape.test.ts",
  "Test Files  2 failed | 1 passed (3)",
  "  ● widget › renders — FAIL in the middle of prose is not a header",
].join("\n");

describe("failingTestFiles", () => {
  it("reads Vitest and Jest FAIL lines into deduped repo-relative paths", () => {
    expect(failingTestFiles(MIXED_OUTPUT, { root: ROOT })).toEqual({
      files: [VITEST_A, VITEST_B, JEST_C, "src/d.test.js", "src/e.test.ts"],
      truncated: false,
    });
  });

  it("caps the list and says it did", () => {
    const output = Array.from(
      { length: MAX_FAILING_TEST_FILES + 5 },
      (_, i) => `FAIL tests/f${i}.test.ts`
    ).join("\n");
    const parsed = failingTestFiles(output, { root: ROOT });
    expect(parsed.files).toHaveLength(MAX_FAILING_TEST_FILES);
    expect(parsed.truncated).toBe(true);
  });

  it.each([
    ["null", null],
    ["a number", 42],
    ["an object", { FAIL: "x" }],
    ["binary noise", "\u0000\u00ff FAIL \u0001\nFAIL\n FAIL  |broken"],
    [
      "passing output",
      " ✓ tests/unit/ok.test.ts (3 tests)\nTest Files  1 passed",
    ],
  ])("finds nothing in %s, without throwing", (_label, output) => {
    expect(failingTestFiles(output, { root: ROOT })).toEqual({
      files: [],
      truncated: false,
    });
  });
});

describe("failing test files in the report", () => {
  const failed = {
    id: SLOW,
    command: COV_COMMAND,
    state: "failed",
    code: 1,
    failingTests: { files: [VITEST_A, JEST_C], truncated: false },
  };

  it("records the failing test files of a failed gate", () => {
    expect(onlyGate(failed)).toMatchObject({
      state: "FAILED",
      failingTestFiles: [VITEST_A, JEST_C],
      failingTestFilesTruncated: false,
    });
  });

  it("carries the truncation flag through", () => {
    expect(
      onlyGate({
        ...failed,
        failingTests: { files: [VITEST_A], truncated: true },
      })
    ).toMatchObject({ failingTestFilesTruncated: true });
  });

  it.each([
    ["passed", false],
    ["passed", true],
    ["skipped", false],
  ])("records none for a %s gate (cached: %s)", (state, cached) => {
    expect(onlyGate({ ...failed, state, cached, code: 0 })).toMatchObject({
      failingTestFiles: [],
      failingTestFilesTruncated: false,
    });
  });

  it("records none when the entry's list is malformed", () => {
    expect(
      onlyGate({ ...failed, failingTests: { files: "nope", truncated: 1 } })
    ).toMatchObject({ failingTestFiles: [], failingTestFilesTruncated: false });
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
