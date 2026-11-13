/**
 * Unit tests for scripts/test-timing-report.mjs (CodySwannGT/lisa#4592).
 *
 * The fixtures are Vitest `json` reporter output in the layout
 * `gh run download -p 'test-timings-*'` produces: one directory per artifact,
 * named `test-timings-<run>-<attempt>-<job>`, holding `<scope>.json`.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectTimings,
  formatReport,
  main,
  summarize,
} from "../../../scripts/test-timing-report.mjs";

const ROOT = "/home/runner/work/lisa/lisa";
const A = "tests/unit/a.test.ts";
const B = "tests/unit/b.test.ts";
const SHARD_1 = "test-timings-9-1-unit-shard-1";
const UNIT = "test-timings-9-1-unit";
const INTEGRATION = "test-timings-9-1-integration";

/** One file entry as Vitest's json reporter writes it. */
interface FileEntry {
  readonly name: string;
  readonly seconds: number;
  readonly tests?: number;
  readonly skipped?: boolean;
}

/**
 * Build a Vitest json report.
 * @param files - Files the report carries
 * @returns The report object
 */
function vitestJson(files: readonly FileEntry[]): unknown {
  return {
    numTotalTests: files.reduce((sum, file) => sum + (file.tests ?? 1), 0),
    testResults: files.map(file => ({
      name: `${ROOT}/${file.name}`,
      startTime: 1_000,
      endTime: 1_000 + file.seconds * 1000,
      status: file.skipped ? "skipped" : "passed",
      assertionResults: Array.from({ length: file.tests ?? 1 }, (_, i) => ({
        title: `case ${i}`,
        status: file.skipped ? "skipped" : "passed",
        duration: file.skipped ? 0 : (file.seconds * 1000) / (file.tests ?? 1),
      })),
    })),
  };
}

let dir: string;

/**
 * Write one artifact's timing file.
 * @param artifact - Artifact directory name
 * @param scope - Scope file name
 * @param files - Files in the report
 */
function writeArtifact(
  artifact: string,
  scope: string,
  files: readonly FileEntry[]
): void {
  fs.mkdirSync(path.join(dir, artifact), { recursive: true });
  fs.writeFileSync(
    path.join(dir, artifact, `${scope}.json`),
    JSON.stringify(vitestJson(files))
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-test-timings-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const integrationFiles: readonly FileEntry[] = [
  { name: "tests/integration/big.test.ts", seconds: 60 },
  { name: "tests/integration/small.test.ts", seconds: 40 },
];

describe("collectTimings", () => {
  it("merges a sharded pair into one unit scope", () => {
    writeArtifact(SHARD_1, "unit", [{ name: A, seconds: 3, tests: 2 }]);
    writeArtifact("test-timings-9-1-unit-shard-2", "unit", [
      { name: B, seconds: 1 },
    ]);
    writeArtifact(INTEGRATION, "integration", integrationFiles);
    const timings = collectTimings(dir);
    expect(timings.unit.map(file => [file.file, file.seconds])).toEqual([
      [A, 3],
      [B, 1],
    ]);
    expect(timings.unit.map(file => file.tests)).toEqual([2, 1]);
  });

  it("counts a file once when the merged unit job repeats the shards", () => {
    const files = [{ name: A, seconds: 3 }];
    writeArtifact(SHARD_1, "unit", files);
    writeArtifact(UNIT, "unit", files);
    expect(collectTimings(dir).unit).toHaveLength(1);
  });

  it("prefers a rerun attempt's timing for the same file", () => {
    writeArtifact(SHARD_1, "unit", [{ name: A, seconds: 9 }]);
    writeArtifact("test-timings-9-2-unit-shard-1", "unit", [
      { name: A, seconds: 2 },
    ]);
    expect(collectTimings(dir).unit[0]?.seconds).toBe(2);
  });

  it("never lets a fully skipped record replace an executed one", () => {
    writeArtifact(SHARD_1, "unit", [{ name: A, seconds: 4 }]);
    writeArtifact("test-timings-9-2-unit-shard-1", "unit", [
      { name: A, seconds: 0, skipped: true },
    ]);
    expect(collectTimings(dir).unit[0]?.seconds).toBe(4);
  });

  it("ignores JSON that is not a Vitest report", () => {
    fs.writeFileSync(path.join(dir, "unit.json"), JSON.stringify({ x: 1 }));
    expect(collectTimings(dir).unit).toEqual([]);
  });
});

describe("summarize", () => {
  it("reports counts, top files, shares and concentration", () => {
    const files = Array.from({ length: 4 }, (_, i) => ({
      file: `f${i}`,
      seconds: [50, 30, 15, 5][i] ?? 0,
      tests: 1,
    }));
    const summary = summarize(files, 2);
    expect(summary.files).toBe(4);
    expect(summary.tests).toBe(4);
    expect(summary.seconds).toBe(100);
    expect(summary.top).toEqual([
      { file: "f0", seconds: 50, share: 0.5 },
      { file: "f1", seconds: 30, share: 0.3 },
    ]);
    expect(summary.concentration).toEqual({
      top10: 1,
      top100: 1,
      top200: 1,
    });
  });
});

describe("main", () => {
  /**
   * Run main and capture its streams.
   * @param argv - Arguments
   * @returns Exit code and captured output
   */
  function run(argv: readonly string[]): {
    code: number;
    out: string;
    err: string;
  } {
    const out: string[] = [];
    const err: string[] = [];
    const code = main(argv, {
      stdout: (line: string) => out.push(line),
      stderr: (line: string) => err.push(line),
    });
    return { code, out: out.join("\n"), err: err.join("\n") };
  }

  it("prints the top files and the top 10/100/200 share per scope", () => {
    writeArtifact(UNIT, "unit", [
      { name: "tests/unit/slow.test.ts", seconds: 9 },
      { name: "tests/unit/fast.test.ts", seconds: 1 },
    ]);
    writeArtifact(INTEGRATION, "integration", integrationFiles);
    const { code, out } = run(["--dir", dir, "--top", "1"]);
    expect(code).toBe(0);
    expect(out).toContain("unit: 2 files, 2 tests, 10.0s");
    expect(out).toContain("9.00s   90.0%  tests/unit/slow.test.ts");
    expect(out).not.toContain("tests/unit/fast.test.ts");
    expect(out).toContain("integration: 2 files");
    expect(out).toContain("60.0%  tests/integration/big.test.ts");
    expect(out).toMatch(
      /top 10: 100\.0% {2}top 100: 100\.0% {2}top 200: 100\.0%/
    );
  });

  it("emits the same data as JSON", () => {
    writeArtifact(UNIT, "unit", [{ name: A, seconds: 2 }]);
    writeArtifact(INTEGRATION, "integration", integrationFiles);
    const { code, out } = run(["--dir", dir, "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.schema).toBe(1);
    expect(parsed.scopes.integration.top[0]).toEqual({
      file: "tests/integration/big.test.ts",
      seconds: 60,
      share: 0.6,
    });
    expect(parsed.scopes.unit.all).toEqual([{ file: A, seconds: 2, tests: 1 }]);
  });

  it("exits 1 naming the missing integration scope", () => {
    writeArtifact(UNIT, "unit", [{ name: A, seconds: 2 }]);
    const { code, out, err } = run(["--dir", dir]);
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toContain("integration");
    expect(err).not.toContain("unit timings");
  });

  it("exits 1 on an empty directory, naming every scope", () => {
    const { code, err } = run(["--dir", dir]);
    expect(code).toBe(1);
    expect(err).toContain("unit");
    expect(err).toContain("integration");
  });

  it("downloads a run's test-timings artifacts with --run", () => {
    const calls: string[] = [];
    const out: string[] = [];
    const code = main(["--run", "41330364793"], {
      stdout: line => out.push(line),
      stderr: () => undefined,
      download: (runId, into) => {
        calls.push(runId);
        dir = into;
        writeArtifact("test-timings-41330364793-1-unit", "unit", [
          { name: A, seconds: 2 },
        ]);
        writeArtifact(
          "test-timings-41330364793-1-integration",
          "integration",
          integrationFiles
        );
      },
    });
    expect(code).toBe(0);
    expect(calls).toEqual(["41330364793"]);
    expect(out.join("\n")).toContain("integration: 2 files");
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("exits 1 when the run's artifacts cannot be downloaded", () => {
    const err: string[] = [];
    const code = main(["--run", "7"], {
      stdout: () => undefined,
      stderr: line => err.push(line),
      download: () => {
        throw new Error("no artifacts matching test-timings-*");
      },
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("run 7");
  });

  it("refuses a missing directory and bad arguments with a usage error", () => {
    expect(run(["--dir", path.join(dir, "absent")]).code).toBe(1);
    expect(run([]).code).toBe(2);
    expect(run(["--dir", dir, "--top", "0"]).code).toBe(2);
    expect(run(["--dir", dir, "--run", "5"]).code).toBe(2);
  });
});

describe("formatReport", () => {
  it("says how many files there are when fewer than a cutoff", () => {
    const text = formatReport({
      unit: summarize([{ file: "a", seconds: 1, tests: 1 }], 20),
    });
    expect(text).toContain("(only 1 file;");
  });
});
