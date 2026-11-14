/**
 * Unit tests for scripts/plan-integration-shards.mjs (CodySwannGT/lisa#4599).
 *
 * The planner assigns integration files to shard legs
 * longest-processing-time-first from the newest recorded timings, keeps each
 * group (the history-scanner suites) in one leg, and prints every leg's
 * planned seconds. With no timings it still keeps the groups together; with
 * neither it hands the legs back to the runner's own `--shard`.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  findTimingsRun,
  formatPlan,
  main,
  planShards,
} from "../../../scripts/plan-integration-shards.mjs";
import { HISTORY_SCANNER_SUITES } from "../../../scripts/lib/history-scanner-suites.mjs";

const SCHEMA = "lisa.test-shard-plan/v1";
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

/**
 * Create one disposable directory.
 * @returns Absolute directory path
 */
function scratch(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-plan-shards-"));
  directories.push(directory);
  return directory;
}

/**
 * Write a downloaded integration timings artifact.
 * @param root - Download directory
 * @param name - Artifact name
 * @param files - File to seconds
 */
function artifact(
  root: string,
  name: string,
  files: Readonly<Record<string, number>>
): void {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "integration.json"),
    JSON.stringify({
      testResults: Object.entries(files).map(([file, seconds]) => ({
        name: `/home/runner/work/lisa/lisa/${file}`,
        startTime: 0,
        endTime: seconds * 1000,
        assertionResults: [{ status: "passed", duration: seconds * 1000 }],
      })),
    })
  );
}

describe("planShards", () => {
  it("assigns longest-first to the least-loaded shard", () => {
    const plan = planShards({
      total: 2,
      timings: [
        { file: "a", seconds: 5 },
        { file: "b", seconds: 4 },
        { file: "c", seconds: 3 },
        { file: "d", seconds: 3 },
      ],
      groups: [],
    });
    // a->1 (5), b->2 (4), c->2 (7), d->1 (8)
    expect(plan).toMatchObject({
      schema: SCHEMA,
      total: 2,
      assignments: { a: 1, b: 2, c: 2, d: 1 },
      seconds: [8, 7],
      defaultSeconds: 3.5,
      groups: [],
    });
  });

  it("keeps a group in one leg, weighing members it has no timing for", () => {
    const plan = planShards({
      total: 2,
      timings: [
        { file: "big", seconds: 10 },
        { file: "g1", seconds: 2 },
        { file: "g2", seconds: 2 },
        { file: "small", seconds: 1 },
      ],
      groups: [["g1", "g2", "g3"]],
    });
    // Group weighs 2 + 2 + median(2) = 6.
    expect(plan.assignments).toEqual({ big: 1, g1: 2, g2: 2, small: 2 });
    expect(plan.groups).toEqual([{ files: ["g1", "g2", "g3"], shard: 2 }]);
    expect(plan.seconds).toEqual([10, 7]);
  });

  it("plans by file count, groups together, when nothing was timed", () => {
    const plan = planShards({ total: 3, timings: [], groups: [["g1", "g2"]] });
    expect(plan).toMatchObject({
      assignments: {},
      defaultSeconds: 1,
      groups: [{ files: ["g1", "g2"], shard: 1 }],
      seconds: [2, 0, 0],
    });
  });

  it("prints every leg's planned total", () => {
    const plan = planShards({
      total: 2,
      timings: [
        { file: "a", seconds: 5 },
        { file: "b", seconds: 4 },
      ],
      groups: [],
    });
    expect(formatPlan(plan)).toEqual([
      "shard 1/2: 1 planned file, 5.0 s planned",
      "shard 2/2: 1 planned file, 4.0 s planned",
    ]);
  });
});

describe("findTimingsRun", () => {
  const listing = (entries: readonly object[]) =>
    entries.map(entry => JSON.stringify(entry)).join("\n");

  it("picks the newest run that uploaded integration timings", () => {
    const run = () =>
      listing([
        {
          name: "test-timings-7-1-unit",
          runId: 7,
          createdAt: "2026-11-12T10:00:00Z",
        },
        {
          name: "test-timings-5-1-integration",
          runId: 5,
          createdAt: "2026-11-11T10:00:00Z",
        },
        {
          name: "test-timings-6-2-integration-shard-2",
          runId: 6,
          createdAt: "2026-11-12T09:00:00Z",
        },
        {
          name: "test-timings-8-1-integration",
          runId: 8,
          createdAt: "2026-11-13T09:00:00Z",
          expired: true,
        },
      ]);
    expect(findTimingsRun("o/r", { run })).toBe("6");
  });

  it("answers undefined when no run has them", () => {
    expect(findTimingsRun("o/r", { run: () => "" })).toBeUndefined();
  });
});

describe("main", () => {
  /**
   * Run the CLI with captured output.
   * @param argv - Arguments
   * @param run - Command runner
   * @returns Exit code, output lines and the GITHUB_OUTPUT text
   */
  function cli(
    argv: readonly string[],
    run: (command: string, args: readonly string[]) => string = () => {
      throw new Error("gh unavailable");
    }
  ) {
    const outputFile = path.join(scratch(), "github-output");
    fs.writeFileSync(outputFile, "");
    const lines: string[] = [];
    const code = main([...argv, "--github-output", outputFile], {
      run,
      out: line => lines.push(line),
      err: line => lines.push(line),
      exists: () => true,
    });
    return { code, lines, output: fs.readFileSync(outputFile, "utf8") };
  }

  it("plans from downloaded timings and hands the plan to the legs", () => {
    const root = scratch();
    artifact(root, "test-timings-6-1-integration-shard-1", {
      "tests/integration/a.test.ts": 30,
      [HISTORY_SCANNER_SUITES[0] ?? ""]: 5,
    });
    artifact(root, "test-timings-6-1-integration-shard-2", {
      "tests/integration/b.test.ts": 20,
    });

    const result = cli(["--shards", "2", "--timings", root]);

    expect(result.code).toBe(0);
    expect(result.output).toMatch(/^mode=files\n/);
    const plan = JSON.parse(/plan=(.*)\n/.exec(result.output)?.[1] ?? "{}");
    expect(plan.schema).toBe(SCHEMA);
    // The group weighs 5 s plus the 20 s median for each of its three
    // untimed members, so it is the longest item and takes shard 1.
    expect(plan.assignments["tests/integration/a.test.ts"]).toBe(2);
    expect(plan.groups).toEqual([
      { files: [...HISTORY_SCANNER_SUITES], shard: 1 },
    ]);
    expect(result.lines.join("\n")).toContain("longest-processing-time-first");
    expect(result.lines.join("\n")).toContain("shard 1/2:");
  });

  it("still keeps the scanner suites together when no timings can be fetched", () => {
    const result = cli(["--shards", "3", "--repo", "o/r"]);

    expect(result.code).toBe(0);
    expect(result.output).toMatch(/^mode=files\n/);
    const plan = JSON.parse(/plan=(.*)\n/.exec(result.output)?.[1] ?? "{}");
    expect(plan.assignments).toEqual({});
    expect(plan.groups[0].shard).toBe(1);
    expect(result.lines.join("\n")).toContain("no integration timings");
  });

  it("downloads the newest run's integration timings with gh", () => {
    const calls: string[][] = [];
    const run = (command: string, args: readonly string[]) => {
      calls.push([command, ...args]);
      if (args[0] === "api")
        return JSON.stringify({
          name: "test-timings-6-1-integration",
          runId: 6,
          createdAt: "2026-11-12T09:00:00Z",
        });
      const into = args[args.indexOf("-D") + 1] ?? "";
      artifact(into, "test-timings-6-1-integration", {
        "tests/integration/a.test.ts": 3,
      });
      return "";
    };

    const result = cli(["--shards", "2", "--repo", "o/r"], run);

    expect(result.code).toBe(0);
    expect(calls[1]).toEqual([
      "gh",
      "run",
      "download",
      "6",
      "-R",
      "o/r",
      "-p",
      "test-timings-*-integration*",
      "-D",
      expect.any(String),
    ]);
    expect(result.lines.join("\n")).toContain("run 6");
  });

  it.each([[["--shards", "1"]], [["--shards", "x"]], [[]]])(
    "refuses %j",
    argv => {
      expect(cli(argv).code).toBe(2);
    }
  );
});
