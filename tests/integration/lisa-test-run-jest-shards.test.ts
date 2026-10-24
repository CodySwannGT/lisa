/**
 * Real Jest shards merge back to the single-run coverage (CodySwannGT/lisa#4479).
 *
 * The acceptance bar is "the merged coverage numbers match a single-job run on
 * the same commit", so this runs the real Jest twice over one fixture — once
 * whole, once as two shards through the exact argv `lisa-test-run` gives a
 * shard — and compares the merged totals with the whole run's.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { mergeJestShards } from "../../src/cli/lisa-test-run-jest-merge.js";
import { readShardReceipts } from "../../src/cli/lisa-test-run-shard.js";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  jestArgv,
  project as fixture,
  run,
  shardTwice,
  totals,
} from "./lisa-test-run-jest-shards-fixture.js";

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
 * The suite's three-file project, two of whose files are tested.
 * @param floor - Global line floor written into the project's own config
 * @param collectCoverage - Whether the config itself turns coverage on
 * @returns Fixture root
 */
function project(floor: number, collectCoverage = false): string {
  return fixture(directory => directories.push(directory), {
    floor,
    collectCoverage,
  });
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
