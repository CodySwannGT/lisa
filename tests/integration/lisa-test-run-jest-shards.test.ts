/**
 * Real Jest shards merge back to the single-run coverage (CodySwannGT/lisa#4479).
 *
 * The acceptance bar is "the merged coverage numbers match a single-job run on
 * the same commit", so this runs the real Jest twice over one fixture — once
 * whole, once as two shards through the exact argv `lisa-test-run` gives a
 * shard — and compares the merged totals with the whole run's.
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { mergeJestShards } from "../../src/cli/lisa-test-run-jest-merge.js";
import {
  readShardReceipts,
  shardArgv,
  writeShardReceipt,
} from "../../src/cli/lisa-test-run-shard.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const JEST_BIN = path.join(REPO_ROOT, "node_modules", "jest", "bin", "jest.js");
// Measured 2026-10-21 on a quiet box (`ps aux | grep -c '[v]itest'` = 0):
// the slowest case ran 3.1s with real Jest/Vitest children of at most
// ~4s each, so 25s keeps a 3x margin at base and the children's 8s base
// inside the 2.5x bound.
useIoLatencyBudget(25_000);

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

/**
 * Build a CommonJS Jest project whose tests each cover a different file.
 * @param floor - Global line floor written into the project's own config
 * @param collectCoverage - Whether the config itself turns coverage on
 * @returns Fixture root
 */
function project(floor: number, collectCoverage = false): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-jest-shards-"));
  directories.push(root);
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "test"));
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"commonjs"}\n');
  for (const [name, hit, miss] of [
    ["a", 1, 2],
    ["b", 3, 4],
    ["c", 5, 6],
  ] as const)
    fs.writeFileSync(
      path.join(root, "src", `${name}.js`),
      `exports.${name} = x => {\n  if (x > 0) return ${hit};\n  return ${miss};\n};\n`
    );
  for (const name of ["a", "b"])
    fs.writeFileSync(
      path.join(root, "test", `${name}.test.js`),
      `const { ${name} } = require("../src/${name}.js");\ntest("${name}", () => expect(${name}(1)).toBeGreaterThan(0));\n`
    );
  fs.writeFileSync(
    path.join(root, "jest.config.js"),
    `module.exports = ${JSON.stringify({
      ...(collectCoverage ? { collectCoverage } : {}),
      collectCoverageFrom: ["src/**/*.js"],
      coverageReporters: ["json-summary", "lcov"],
      coverageThreshold: { global: { lines: floor } },
    })};\n`
  );
  return root;
}

/**
 * The argv a consumer's gate task hands `lisa-test-run`.
 * @param root - Fixture root
 * @param coverageFlag - Whether the command line asks for coverage
 * @returns Jest argv
 */
function jestArgv(root: string, coverageFlag = true): [string, ...string[]] {
  return [
    process.execPath,
    JEST_BIN,
    "--config",
    path.join(root, "jest.config.js"),
    // Inside the fixture: Jest's default cache is a shared tmpdir entry.
    `--cacheDirectory=${path.join(root, ".jest-cache")}`,
    ...(coverageFlag ? ["--coverage"] : []),
  ];
}

/**
 * Run one Jest command to completion in the fixture.
 * @param root - Fixture root
 * @param argv - Command and arguments
 * @returns Exit status
 */
function run(root: string, argv: readonly string[]): number | null {
  const [command, ...args] = argv;
  return boundedSpawnSync({
    label: "jest shard fixture run",
    command: command ?? "",
    args,
    baseMs: 8_000,
    cwd: root,
  }).status;
}

/**
 * Read the totals Jest's json-summary reporter wrote.
 * @param root - Fixture root
 * @returns Totals per metric
 */
function totals(root: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(root, "coverage", "coverage-summary.json"),
      "utf8"
    )
  ).total;
}

/**
 * Run both shards the way two matrix legs would, then return their receipts.
 * @param root - Fixture root
 * @param argv - The gate task's Jest command
 * @returns The downloaded-artifact directory
 */
function shardTwice(root: string, argv = jestArgv(root)): string {
  const merge = path.join(root, "downloaded");
  for (const index of [1, 2]) {
    const plan = {
      kind: "shard",
      index,
      total: 2,
      output: path.join(merge, `unit-test-shard-x-${index}`),
    } as const;
    writeShardReceipt(plan, "jest", argv);
    expect(run(root, shardArgv(argv, "jest", plan))).toBe(0);
  }
  return merge;
}

describe("Jest shard merge", () => {
  it("reproduces the single run's totals from two shards", () => {
    const whole = project(0);
    expect(run(whole, jestArgv(whole))).toBe(0);
    const sharded = project(0);
    const receipts = readShardReceipts(shardTwice(sharded), 2);

    expect(mergeJestShards(jestArgv(sharded), receipts, sharded)).toBe(0);

    expect(totals(sharded)).toEqual(totals(whole));
    expect(fs.existsSync(path.join(sharded, "coverage", "lcov.info"))).toBe(
      true
    );
  });

  it("enforces the project's floor once, on the merged coverage", () => {
    // Each shard alone covers 2 of 9 lines and the merge 4 of 9 (44.44%), so a
    // floor of 40 would fail every shard alone and holds on the merge.
    const holds = project(40);
    expect(
      mergeJestShards(
        jestArgv(holds),
        readShardReceipts(shardTwice(holds), 2),
        holds
      )
    ).toBe(0);

    const misses = project(90);
    expect(
      mergeJestShards(
        jestArgv(misses),
        readShardReceipts(shardTwice(misses), 2),
        misses
      )
    ).toBe(1);
  });

  it("enforces the floor when the config, not the command, turns coverage on", () => {
    // `collectCoverage: true` in jest.config with no --coverage flag: the
    // shards still collect, so the merge must still hold them to the floor:
    // the merged 44.44% holds a floor of 40 and misses one of 90.
    const holds = project(40, true);
    const holdsArgv = jestArgv(holds, false);
    expect(
      mergeJestShards(
        holdsArgv,
        readShardReceipts(shardTwice(holds, holdsArgv), 2),
        holds
      )
    ).toBe(0);
    expect(
      fs.existsSync(path.join(holds, "coverage", "coverage-summary.json"))
    ).toBe(true);

    const misses = project(90, true);
    const argv = jestArgv(misses, false);
    expect(
      mergeJestShards(
        argv,
        readShardReceipts(shardTwice(misses, argv), 2),
        misses
      )
    ).toBe(1);
  });
});
