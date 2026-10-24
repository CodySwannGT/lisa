/**
 * Real-Jest fixtures for the shard-merge suites (CodySwannGT/lisa#4479, #4488).
 *
 * Split out of `lisa-test-run-jest-shards.test.ts` so the report suite can
 * build the same projects. Each fixture is a CommonJS Jest project whose tests
 * each cover a different source file; it is run whole, or as two shards
 * through the exact argv `lisa-test-run` gives a shard.
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { expect } from "vitest";

import {
  shardArgv,
  writeShardReceipt,
} from "../../src/cli/lisa-test-run-shard.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const JEST_BIN = path.join(REPO_ROOT, "node_modules", "jest", "bin", "jest.js");

/** One `coverageReporters` entry, as Jest's config accepts it. */
export type CoverageReporter = string | [string, Record<string, unknown>];

/** What a fixture project is built from. */
export interface ProjectOptions {
  /** Global line floor written into the project's own config. */
  readonly floor?: number;
  /** Whether the config itself turns coverage on. */
  readonly collectCoverage?: boolean;
  /** Source files, relative to `src/`. */
  readonly sources?: readonly string[];
  /** Sources that get a test, so the rest stay uncovered. */
  readonly tested?: readonly string[];
  /** The project's `coverageReporters`. */
  readonly reporters?: readonly CoverageReporter[];
}

/**
 * Build a CommonJS Jest project whose tests each cover a different file.
 * @param register - Suite-local teardown registry
 * @param options - Layout and coverage configuration
 * @param options.floor - Global line floor written into the project's config
 * @param options.collectCoverage - Whether the config itself turns coverage on
 * @param options.sources - Source files, relative to `src/`
 * @param options.tested - Sources that get a test
 * @param options.reporters - The project's `coverageReporters`
 * @returns Fixture root
 */
export function project(
  register: (directory: string) => void,
  {
    floor = 0,
    collectCoverage = false,
    sources = ["a.js", "b.js", "c.js"],
    tested = ["a.js", "b.js"],
    reporters = ["json-summary", "lcov"],
  }: ProjectOptions = {}
): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-jest-shards-"));
  register(root);
  fs.mkdirSync(path.join(root, "test"));
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"commonjs"}\n');
  for (const [index, source] of sources.entries()) {
    const file = path.join(root, "src", source);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `exports.f = x => {\n  if (x > 0) return ${2 * index + 1};\n  return ${2 * index + 2};\n};\n`
    );
  }
  for (const [index, source] of tested.entries())
    fs.writeFileSync(
      path.join(root, "test", `t${index}.test.js`),
      `const { f } = require("../src/${source}");\ntest("${source}", () => expect(f(1)).toBeGreaterThan(0));\n`
    );
  fs.writeFileSync(
    path.join(root, "jest.config.js"),
    `module.exports = ${JSON.stringify({
      ...(collectCoverage ? { collectCoverage } : {}),
      collectCoverageFrom: ["src/**/*.js"],
      coverageReporters: reporters,
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
export function jestArgv(
  root: string,
  coverageFlag = true
): [string, ...string[]] {
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
export function run(root: string, argv: readonly string[]): number | null {
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
 * Read one file the coverage reporters wrote.
 * @param root - Fixture root
 * @param name - File name inside `coverage/`
 * @returns Its contents
 */
export function coverageFile(root: string, name: string): string {
  return fs.readFileSync(path.join(root, "coverage", name), "utf8");
}

/**
 * Read the totals Jest's json-summary reporter wrote.
 * @param root - Fixture root
 * @returns Totals per metric
 */
export function totals(root: string): Record<string, unknown> {
  return JSON.parse(coverageFile(root, "coverage-summary.json")).total;
}

/**
 * Run both shards the way two matrix legs would.
 * @param root - Fixture root
 * @param argv - The gate task's Jest command
 * @returns The downloaded-artifact directory
 */
export function shardTwice(root: string, argv = jestArgv(root)): string {
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
