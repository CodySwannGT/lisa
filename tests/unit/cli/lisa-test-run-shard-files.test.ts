/**
 * File-list shard legs for `lisa-test-run` (CodySwannGT/lisa#4599).
 *
 * The integration plan job assigns files to legs from recorded timings. A leg
 * lists the run's own selection, keeps its planned files, places any file the
 * plan never saw by one rule every leg applies identically, and excludes
 * everything else, so each selected file runs in exactly one leg.
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assignShardFiles,
  filesShardArgv,
  readShardFilePlan,
  readVitestFileList,
  SHARD_PLAN_SCHEMA,
  type ShardFilePlan,
  vitestListArgv,
} from "../../../src/cli/lisa-test-run-shard-files.js";
import { shardPlanFrom } from "../../../src/cli/lisa-test-run-shard.js";

const directories: string[] = [];
const SCANNER_A = "tests/integration/scanner-a.test.ts";
const A_TEST = "tests/integration/a.test.ts";
const SCANNER_B = "tests/integration/scanner-b.test.ts";
const INTEGRATION_DIR = "tests/integration";
const LIST_JSON = "out/list.json";
const PLAN_PATH = "/plan.json";
const byName = (left: string, right: string): number =>
  left.localeCompare(right);

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

/**
 * Create one disposable directory.
 * @returns Absolute directory path
 */
function scratch(): string {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "lisa-shard-files-"));
  directories.push(directory);
  return directory;
}

/**
 * Write a plan file.
 * @param plan - Plan body
 * @returns Plan path
 */
function planFile(plan: unknown): string {
  const file = path.join(scratch(), "plan.json");
  fs.writeFileSync(file, JSON.stringify(plan));
  return file;
}

const PLAN: ShardFilePlan = {
  total: 3,
  assignments: {
    "tests/integration/slow.test.ts": 1,
    "tests/integration/mid.test.ts": 2,
    [SCANNER_A]: 3,
  },
  seconds: [100, 60, 20],
  defaultSeconds: 30,
  groups: [
    {
      files: [SCANNER_A, SCANNER_B],
      shard: 3,
    },
  ],
};

describe("readShardFilePlan", () => {
  it("reads a plan written for this layout", () => {
    const file = planFile({ schema: SHARD_PLAN_SCHEMA, ...PLAN });
    expect(readShardFilePlan(file, 3)).toEqual(PLAN);
  });

  it("refuses a plan for a different shard count", () => {
    const file = planFile({ schema: SHARD_PLAN_SCHEMA, ...PLAN });
    expect(() => readShardFilePlan(file, 4)).toThrow(
      /plans 3 shards, but this leg is one of 4/
    );
  });

  it.each([
    ["an unknown schema", { ...PLAN, schema: "other/v1" }],
    [
      "a file assigned past the last shard",
      {
        ...PLAN,
        schema: SHARD_PLAN_SCHEMA,
        assignments: { "a.test.ts": 4 },
      },
    ],
    [
      "a per-shard total list of the wrong length",
      { ...PLAN, schema: SHARD_PLAN_SCHEMA, seconds: [1, 2] },
    ],
    [
      "a group on no shard",
      {
        ...PLAN,
        schema: SHARD_PLAN_SCHEMA,
        groups: [{ files: ["a.test.ts"], shard: 0 }],
      },
    ],
  ])("refuses %s", (_label, plan) => {
    expect(() => readShardFilePlan(planFile(plan), 3)).toThrow(
      /is not a test shard plan/
    );
  });
});

describe("assignShardFiles", () => {
  it("keeps every planned file on its planned shard", () => {
    const placed = assignShardFiles(PLAN, [
      "tests/integration/slow.test.ts",
      "tests/integration/mid.test.ts",
      SCANNER_A,
    ]);
    expect(Object.fromEntries(placed)).toEqual(PLAN.assignments);
  });

  it("keeps a group member the plan never timed with its group", () => {
    const placed = assignShardFiles(PLAN, [SCANNER_B]);
    expect(placed.get(SCANNER_B)).toBe(3);
  });

  it("places unplanned files on the least-loaded shard, identically everywhere", () => {
    const selection = [
      "tests/integration/new-b.test.ts",
      "tests/integration/new-a.test.ts",
      "tests/integration/new-c.test.ts",
    ];
    const placed = assignShardFiles(PLAN, selection);
    // Sorted, then greedy: loads 100/60/20 take a (+30 -> s3 50), b (s3 80),
    // c (s2 90).
    expect(Object.fromEntries(placed)).toEqual({
      "tests/integration/new-a.test.ts": 3,
      "tests/integration/new-b.test.ts": 3,
      "tests/integration/new-c.test.ts": 2,
    });
    expect(
      Object.fromEntries(assignShardFiles(PLAN, [...selection].reverse()))
    ).toEqual(Object.fromEntries(placed));
  });

  it("gives every selected file exactly one shard", () => {
    const selection = Array.from(
      { length: 25 },
      (_, i) => `tests/integration/f${i}.test.ts`
    );
    const placed = assignShardFiles(PLAN, selection);
    expect([...placed.keys()].sort(byName)).toEqual(
      [...selection].sort(byName)
    );
    for (const shard of placed.values()) {
      expect(shard).toBeGreaterThanOrEqual(1);
      expect(shard).toBeLessThanOrEqual(3);
    }
  });
});

describe("vitestListArgv", () => {
  it("lists the same selection instead of running it", () => {
    expect(
      vitestListArgv(
        [
          "vitest",
          "run",
          INTEGRATION_DIR,
          "--exclude=**/x.test.ts",
          "--reporter=verbose",
        ],
        LIST_JSON
      )
    ).toEqual([
      "vitest",
      "list",
      INTEGRATION_DIR,
      "--exclude=**/x.test.ts",
      "--reporter=verbose",
      "--filesOnly",
      `--json=${LIST_JSON}`,
    ]);
  });

  it("keeps node's own flags in front of the vitest entry", () => {
    expect(
      vitestListArgv(
        [
          "node",
          "--max-old-space-size=4096",
          "node_modules/vitest/vitest.mjs",
          "run",
        ],
        LIST_JSON
      )
    ).toEqual([
      "node",
      "--max-old-space-size=4096",
      "node_modules/vitest/vitest.mjs",
      "list",
      "--filesOnly",
      `--json=${LIST_JSON}`,
    ]);
  });

  it("refuses a command that is not `vitest run`", () => {
    expect(() => vitestListArgv(["vitest", "--run"], LIST_JSON)).toThrow(
      /needs a `vitest run` command/
    );
  });
});

describe("readVitestFileList", () => {
  it("reads vitest's file list as repository paths, once each", () => {
    const root = scratch();
    const list = path.join(root, "list.json");
    fs.writeFileSync(
      list,
      JSON.stringify([
        {
          file: path.join(root, "tests/integration/b.test.ts"),
          projectName: "lisa",
        },
        { file: path.join(root, A_TEST), projectName: "x" },
        { file: path.join(root, A_TEST), projectName: "y" },
      ])
    );
    expect(readVitestFileList(list, root)).toEqual([
      A_TEST,
      "tests/integration/b.test.ts",
    ]);
  });

  it("refuses output that is not a file list", () => {
    const list = path.join(scratch(), "list.json");
    fs.writeFileSync(list, "{}");
    expect(() => readVitestFileList(list, "/")).toThrow(
      /not a vitest file list/
    );
  });
});

describe("filesShardArgv", () => {
  const leg = { kind: "shard", index: 2, total: 3, output: "/out" } as const;

  it("excludes every other leg's files and keeps the shard reporting", () => {
    expect(
      filesShardArgv(
        ["vitest", "run", INTEGRATION_DIR],
        leg,
        [A_TEST, "tests/integration/[odd].test.ts"],
        4
      )
    ).toEqual([
      "vitest",
      "run",
      INTEGRATION_DIR,
      "--exclude=tests/integration/a.test.ts",
      "--exclude=tests/integration/\\[odd\\].test.ts",
      "--reporter=default",
      "--reporter=blob",
      "--outputFile.blob=/out/blob-2-3.json",
      "--coverage.thresholds=false",
    ]);
  });

  it("lets a leg with no files of its own pass instead of failing on none", () => {
    expect(filesShardArgv(["vitest", "run"], leg, ["a.test.ts"], 0)).toContain(
      "--passWithNoTests"
    );
  });
});

describe("shardPlanFrom with a file plan", () => {
  it("hands the plan path to the shard leg", () => {
    expect(
      shardPlanFrom({
        LISA_TEST_SHARD: "2/3",
        LISA_TEST_SHARD_OUTPUT: "/out",
        LISA_TEST_SHARD_PLAN: PLAN_PATH,
      })
    ).toEqual({
      kind: "shard",
      index: 2,
      total: 3,
      output: "/out",
      filePlan: PLAN_PATH,
    });
  });

  it("refuses a file plan with no shard leg to apply it to", () => {
    expect(() => shardPlanFrom({ LISA_TEST_SHARD_PLAN: PLAN_PATH })).toThrow(
      /LISA_TEST_SHARD_PLAN is set but LISA_TEST_SHARD is not\./
    );
  });
});
