/** Shard and merge planning for `lisa-test-run` (CodySwannGT/lisa#4479). */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkJestThresholds,
  gatherVitestBlobs,
  readShardReceipts,
  shardArgv,
  shardPlanFrom,
  shardRunnerOf,
  type ShardRunner,
  vitestMergeArgv,
  writeShardReceipt,
} from "../../../src/cli/lisa-test-run-shard.js";

const JEST: ShardRunner = "jest";
const VITEST: ShardRunner = "vitest";
const COVERAGE = "--coverage";
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

/**
 * Create one disposable directory for receipt fixtures.
 * @returns Absolute directory path
 */
function scratch(): string {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "lisa-shard-test-"));
  directories.push(directory);
  return directory;
}

/**
 * Write one shard's receipt the way a shard leg leaves it after download.
 * @param root - Merge directory the artifacts were downloaded into
 * @param index - One-based shard index
 * @param total - Shard count
 * @param runner - Test runner the shard rewrote
 * @returns The shard's own output directory
 */
function shardLeg(
  root: string,
  index: number,
  total: number,
  runner: ShardRunner = JEST
): string {
  const output = path.join(root, `unit-test-shard-nonce-${index}`);
  writeShardReceipt(
    { kind: "shard", index, total, output },
    runner,
    runner === JEST ? [JEST, COVERAGE] : [VITEST, "run"]
  );
  return output;
}

describe("shardPlanFrom", () => {
  it("is inert when no shard variable is set or every one is empty", () => {
    expect(shardPlanFrom({})).toEqual({ kind: "none" });
    expect(
      shardPlanFrom({
        LISA_TEST_SHARD: "",
        LISA_TEST_SHARD_OUTPUT: "",
        LISA_TEST_SHARD_MERGE: "",
        LISA_TEST_SHARD_TOTAL: "",
      })
    ).toEqual({ kind: "none" });
  });

  it("reads one shard leg", () => {
    expect(
      shardPlanFrom({ LISA_TEST_SHARD: "2/4", LISA_TEST_SHARD_OUTPUT: "/o" })
    ).toEqual({ kind: "shard", index: 2, total: 4, output: "/o" });
  });

  it.each(["0/4", "5/4", "a/b", "2", "2/4/1", "1.5/4", " 2/4"])(
    "refuses the malformed shard %j",
    value => {
      expect(() =>
        shardPlanFrom({ LISA_TEST_SHARD: value, LISA_TEST_SHARD_OUTPUT: "/o" })
      ).toThrow(/LISA_TEST_SHARD/);
    }
  );

  it("refuses a shard leg with nowhere to write its output", () => {
    expect(() => shardPlanFrom({ LISA_TEST_SHARD: "1/2" })).toThrow(
      /LISA_TEST_SHARD_OUTPUT/
    );
  });

  it("reads the merge leg", () => {
    expect(
      shardPlanFrom({ LISA_TEST_SHARD_MERGE: "/m", LISA_TEST_SHARD_TOTAL: "3" })
    ).toEqual({ kind: "merge", directory: "/m", total: 3 });
  });

  it.each(["", "0", "x", "2.5"])(
    "refuses a merge with the shard count %j",
    total => {
      expect(() =>
        shardPlanFrom({
          LISA_TEST_SHARD_MERGE: "/m",
          LISA_TEST_SHARD_TOTAL: total,
        })
      ).toThrow(/LISA_TEST_SHARD_TOTAL/);
    }
  );

  it("refuses a process told to be a shard and the merge at once", () => {
    expect(() =>
      shardPlanFrom({
        LISA_TEST_SHARD: "1/2",
        LISA_TEST_SHARD_OUTPUT: "/o",
        LISA_TEST_SHARD_MERGE: "/m",
        LISA_TEST_SHARD_TOTAL: "2",
      })
    ).toThrow(/both/);
  });
});

describe("shardRunnerOf", () => {
  it.each([
    [[JEST, COVERAGE], JEST],
    [["/w/node_modules/.bin/jest"], JEST],
    [["node", "node_modules/jest/bin/jest.js", COVERAGE], JEST],
    [[VITEST, "run"], VITEST],
    [["/w/node_modules/.bin/vitest", "run"], VITEST],
    [["node", "node_modules/vitest/vitest.mjs", "run"], VITEST],
    [
      ["node", "--max-old-space-size=6144", "node_modules/jest/bin/jest.js"],
      JEST,
    ],
    [["node", "--inspect", "--", "node_modules/vitest/vitest.mjs"], VITEST],
  ] as const)("names %j as %s", (argv, runner) => {
    expect(shardRunnerOf(argv)).toBe(runner);
  });

  it("refuses a command it cannot shard and names it", () => {
    expect(() => shardRunnerOf(["node", "scripts/lisa-mutation.mjs"])).toThrow(
      /cannot shard "node scripts\/lisa-mutation.mjs"/
    );
  });
});

describe("shardArgv", () => {
  const plan = { kind: "shard", index: 2, total: 4, output: "/o" } as const;

  it("gives jest the shard, a json-only report, and no per-shard floor", () => {
    expect(shardArgv([JEST, COVERAGE], JEST, plan)).toEqual([
      JEST,
      COVERAGE,
      "--shard=2/4",
      "--coverageReporters=json",
      "--coverageThreshold={}",
      `--coverageDirectory=${path.join("/o", "coverage")}`,
    ]);
  });

  it("gives vitest the shard, a blob report, and zeroed per-shard floors", () => {
    expect(shardArgv([VITEST, "run", COVERAGE], VITEST, plan)).toEqual([
      VITEST,
      "run",
      COVERAGE,
      "--shard=2/4",
      "--reporter=blob",
      `--outputFile.blob=${path.join("/o", "blob-2-4.json")}`,
      "--coverage.thresholds.lines=0",
      "--coverage.thresholds.functions=0",
      "--coverage.thresholds.branches=0",
      "--coverage.thresholds.statements=0",
    ]);
  });
});

describe("shard receipts", () => {
  it("returns every shard's receipt in index order", () => {
    const root = scratch();
    shardLeg(root, 2, 2);
    shardLeg(root, 1, 2);

    const receipts = readShardReceipts(root, 2);

    expect(receipts.map(receipt => receipt.index)).toEqual([1, 2]);
    expect(receipts[0]).toMatchObject({ runner: JEST, coverage: true });
    expect(receipts[0]?.directory).toBe(
      path.join(root, "unit-test-shard-nonce-1")
    );
  });

  it("records a shard that collected no coverage", () => {
    const root = scratch();
    writeShardReceipt(
      { kind: "shard", index: 1, total: 1, output: path.join(root, "a") },
      JEST,
      [JEST]
    );

    expect(readShardReceipts(root, 1)[0]?.coverage).toBe(false);
  });

  it("names the shards that never reported", () => {
    const root = scratch();
    shardLeg(root, 1, 3);

    expect(() => readShardReceipts(root, 3)).toThrow(
      /expected 3 unit-test shards.*missing shard 2, 3/
    );
  });

  it("refuses two receipts for one shard", () => {
    const root = scratch();
    shardLeg(root, 1, 2);
    fs.cpSync(
      path.join(root, "unit-test-shard-nonce-1"),
      path.join(root, "copy"),
      { recursive: true }
    );
    shardLeg(root, 2, 2);

    expect(() => readShardReceipts(root, 2)).toThrow(/shard 1 reported twice/);
  });

  it("refuses shards that disagree on the shard count", () => {
    const root = scratch();
    shardLeg(root, 1, 2);
    shardLeg(root, 2, 3);

    expect(() => readShardReceipts(root, 2)).toThrow(/2\/3/);
  });

  it("refuses shards that ran different test runners", () => {
    const root = scratch();
    shardLeg(root, 1, 2, JEST);
    shardLeg(root, 2, 2, VITEST);

    expect(() => readShardReceipts(root, 2)).toThrow(/jest.*vitest/);
  });
});

describe("vitest merge", () => {
  it("adds the merged blob directory to the same command", () => {
    expect(vitestMergeArgv([VITEST, "run", COVERAGE], "/b")).toEqual([
      VITEST,
      "run",
      COVERAGE,
      "--merge-reports=/b",
    ]);
  });

  it("gathers every shard's blob into one flat directory", () => {
    const root = scratch();
    for (const index of [1, 2]) {
      const output = shardLeg(root, index, 2, VITEST);
      fs.writeFileSync(path.join(output, `blob-${index}-2.json`), "{}");
    }
    const into = path.join(scratch(), "blobs");

    gatherVitestBlobs(readShardReceipts(root, 2), into);

    expect(
      fs.readdirSync(into).sort((left, right) => left.localeCompare(right))
    ).toEqual(["blob-1-2.json", "blob-2-2.json"]);
  });

  it("refuses a vitest shard that left no blob", () => {
    const root = scratch();
    shardLeg(root, 1, 1, VITEST);

    expect(() =>
      gatherVitestBlobs(
        readShardReceipts(root, 1),
        path.join(scratch(), "blobs")
      )
    ).toThrow(/shard 1 left no vitest blob/);
  });
});

describe("checkJestThresholds", () => {
  const summary = {
    lines: { total: 10, covered: 7, pct: 70 },
    statements: { total: 10, covered: 8, pct: 80 },
    functions: { total: 4, covered: 4, pct: 100 },
    branches: { total: 6, covered: 3, pct: 50 },
  };

  it("passes when every global floor holds", () => {
    expect(
      checkJestThresholds({ global: { lines: 70, branches: 50 } }, summary)
    ).toEqual([]);
  });

  it("reports a missed percentage floor in Jest's words", () => {
    expect(
      checkJestThresholds({ global: { lines: 90, functions: 100 } }, summary)
    ).toEqual([
      'Jest: "global" coverage threshold for lines (90%) not met: 70%',
    ]);
  });

  it("reads a negative floor as an uncovered-count ceiling", () => {
    expect(
      checkJestThresholds({ global: { branches: -2, statements: -2 } }, summary)
    ).toEqual([
      "Jest: Uncovered count for branches (3) exceeds global threshold (2)",
    ]);
  });

  it("passes with no thresholds at all", () => {
    expect(checkJestThresholds(undefined, summary)).toEqual([]);
    expect(checkJestThresholds({}, summary)).toEqual([]);
  });

  it("refuses a path or glob threshold and names the key", () => {
    expect(() =>
      checkJestThresholds(
        { global: { lines: 1 }, "./src/core/": { lines: 90 } },
        summary
      )
    ).toThrow(/"\.\/src\/core\/"/);
  });
});
