/**
 * Shard and merge planning for `lisa-test-run` (CodySwannGT/lisa#4479).
 *
 * `quality.yml` shards the unit suite by ENVIRONMENT, never by appending
 * arguments to the project's gate task. The task is a package script whose
 * shape Lisa does not know — `bun run test:cov` may reach the runner through
 * two `$npm_execpath run` hops, and npm, yarn and bun each forward trailing
 * arguments differently. The playwright workflow hit exactly that wall and
 * stopped sharding declared tasks altogether. An environment variable survives
 * every hop, and this wrapper is the one place that knows which runner it is
 * about to start, so the runner-specific spelling lives here.
 *
 * A shard leg writes a receipt BEFORE its runner starts. The workflow refuses a
 * leg that left none: a consumer still on a Lisa without this module, or a
 * gate task that bypasses `lisa-test-run`, would otherwise run the WHOLE suite
 * in every leg and report green N times — the sharded run would look healthy
 * while proving nothing about the speed-up it was adopted for.
 *
 * Per-shard coverage floors are switched off, because a shard measures a slice
 * of the suite against the whole source and fails any project-wide floor. The
 * floor is enforced once, by the merge, over the union of every shard.
 * @module cli/lisa-test-run-shard
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** `<index>/<total>` for one shard leg, e.g. `2/4`. */
export const SHARD_ENV = "LISA_TEST_SHARD";
/** Directory a shard leg writes its receipt and results into. */
export const SHARD_OUTPUT_ENV = "LISA_TEST_SHARD_OUTPUT";
/** Directory the merge leg downloaded every shard's results into. */
export const SHARD_MERGE_ENV = "LISA_TEST_SHARD_MERGE";
/** How many shards the merge leg must find. */
export const SHARD_TOTAL_ENV = "LISA_TEST_SHARD_TOTAL";
/** Every variable above, for stripping before the payload starts. */
export const SHARD_ENV_NAMES = [
  SHARD_ENV,
  SHARD_OUTPUT_ENV,
  SHARD_MERGE_ENV,
  SHARD_TOTAL_ENV,
] as const;

/** File a shard leg leaves in its output directory. */
export const SHARD_RECEIPT = "lisa-shard-receipt.json";

/** The test runners this wrapper knows how to shard. */
export type ShardRunner = "jest" | "vitest";

/** One shard leg. */
export interface ShardLeg {
  readonly kind: "shard";
  readonly index: number;
  readonly total: number;
  readonly output: string;
}

/** The merge leg. */
export interface ShardMerge {
  readonly kind: "merge";
  readonly directory: string;
  readonly total: number;
}

/** What this process was asked to be. */
export type ShardPlan = { readonly kind: "none" } | ShardLeg | ShardMerge;

/** One shard's receipt as read back by the merge. */
export interface ShardReceipt {
  readonly index: number;
  readonly total: number;
  readonly runner: ShardRunner;
  readonly coverage: boolean;
  /** Directory the receipt was found in — the shard's own results. */
  readonly directory: string;
}

const WHOLE_NUMBER = /^[1-9]\d*$/;

/**
 * Read a variable, treating an empty value as unset.
 * @param env - Process environment
 * @param name - Variable name
 * @returns The value, or undefined when unset or empty
 */
function setting(
  env: Readonly<Record<string, string | undefined>>,
  name: string
): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Parse one shard leg's `<index>/<total>`.
 * @param value - Raw `LISA_TEST_SHARD`
 * @param output - Raw `LISA_TEST_SHARD_OUTPUT`
 * @returns The shard leg
 */
function shardLeg(value: string, output: string | undefined): ShardLeg {
  const [index, total, ...rest] = value.split("/");
  if (
    rest.length > 0 ||
    index === undefined ||
    total === undefined ||
    !WHOLE_NUMBER.test(index) ||
    !WHOLE_NUMBER.test(total) ||
    Number(index) > Number(total)
  ) {
    throw new Error(
      `${SHARD_ENV} is ${JSON.stringify(value)}; it must be <index>/<total> with 1 <= index <= total.`
    );
  }
  if (output === undefined) {
    throw new Error(
      `${SHARD_ENV} is set but ${SHARD_OUTPUT_ENV} is not, so this shard has nowhere to leave its receipt.`
    );
  }
  return { kind: "shard", index: Number(index), total: Number(total), output };
}

/**
 * Decide whether this process is a shard leg, the merge, or neither.
 * @param env - Process environment
 * @returns The plan; `none` when no shard variable is set
 */
export function shardPlanFrom(
  env: Readonly<Record<string, string | undefined>>
): ShardPlan {
  const shard = setting(env, SHARD_ENV);
  const merge = setting(env, SHARD_MERGE_ENV);
  if (shard !== undefined && merge !== undefined) {
    throw new Error(
      `${SHARD_ENV} and ${SHARD_MERGE_ENV} are both set; a run is one shard or the merge, never both.`
    );
  }
  if (shard !== undefined)
    return shardLeg(shard, setting(env, SHARD_OUTPUT_ENV));
  if (merge === undefined) return { kind: "none" };
  const total = env[SHARD_TOTAL_ENV] ?? "";
  if (!WHOLE_NUMBER.test(total)) {
    throw new Error(
      `${SHARD_TOTAL_ENV} is ${JSON.stringify(total)}; the merge must be told how many shards to expect.`
    );
  }
  return { kind: "merge", directory: merge, total: Number(total) };
}

/**
 * Whether one argv entry names a runner's executable or entry script.
 * @param entry - argv entry
 * @param runner - Runner name
 * @returns True when the entry starts that runner
 */
function names(entry: string | undefined, runner: ShardRunner): boolean {
  if (entry === undefined) return false;
  const base = path.basename(entry);
  return (
    base === runner ||
    base === `${runner}.js` ||
    base === `${runner}.mjs` ||
    entry.includes(`node_modules/${runner}/`)
  );
}

/**
 * The file a payload argv actually starts: the command itself, or — when the
 * command is `node` — the first argument that is not a Node flag, so
 * `node --max-old-space-size=6144 node_modules/jest/bin/jest.js` names Jest.
 * A flag that takes its value as a separate argument is not special-cased;
 * its value is taken for the entry, names no runner, and is refused loudly.
 * @param argv - Payload argv
 * @returns The entry, or undefined when `node` is given no script
 */
export function runnerEntry(argv: readonly string[]): string | undefined {
  if (path.basename(argv[0] ?? "") !== "node") return argv[0];
  return argv.slice(1).find(arg => !arg.startsWith("-"));
}

/**
 * Name the runner a payload argv starts, refusing anything else.
 * @param argv - Payload argv
 * @returns The runner
 */
export function shardRunnerOf(argv: readonly string[]): ShardRunner {
  const entry = runnerEntry(argv);
  const runner = (["jest", "vitest"] as const).find(candidate =>
    names(entry, candidate)
  );
  if (runner === undefined) {
    throw new Error(
      `lisa-test-run cannot shard "${argv.join(" ")}": only jest and vitest commands can be sharded.`
    );
  }
  return runner;
}

/**
 * Whether the payload collects coverage at all.
 * @param argv - Payload argv
 * @returns True when a coverage flag is present
 */
function collectsCoverage(argv: readonly string[]): boolean {
  return argv.some(
    arg =>
      arg === "--coverage" ||
      arg === "--coverage=true" ||
      arg === "--collectCoverage" ||
      arg === "--collectCoverage=true"
  );
}

/**
 * Rewrite one payload argv into a single shard of itself.
 * @param argv - Payload argv
 * @param runner - Runner the argv starts
 * @param leg - This shard leg
 * @returns The shard's argv
 */
export function shardArgv(
  argv: readonly [string, ...string[]],
  runner: ShardRunner,
  leg: ShardLeg
): [string, ...string[]] {
  const shard = `--shard=${leg.index}/${leg.total}`;
  if (runner === "jest") {
    return [
      ...argv,
      shard,
      "--coverageReporters=json",
      "--coverageThreshold={}",
      `--coverageDirectory=${path.join(leg.output, "coverage")}`,
    ];
  }
  return [
    ...argv,
    shard,
    "--reporter=blob",
    `--outputFile.blob=${path.join(leg.output, `blob-${leg.index}-${leg.total}.json`)}`,
    ...["lines", "functions", "branches", "statements"].map(
      metric => `--coverage.thresholds.${metric}=0`
    ),
  ];
}

/**
 * Leave the receipt that proves this leg ran only its slice.
 * @param leg - This shard leg
 * @param runner - Runner the leg starts
 * @param argv - The payload argv before sharding
 */
export function writeShardReceipt(
  leg: ShardLeg,
  runner: ShardRunner,
  argv: readonly string[]
): void {
  fs.mkdirSync(leg.output, { recursive: true });
  fs.writeFileSync(
    path.join(leg.output, SHARD_RECEIPT),
    `${JSON.stringify({
      schema: 1,
      index: leg.index,
      total: leg.total,
      runner,
      coverage: collectsCoverage(argv),
    })}\n`
  );
}

/**
 * Find every receipt directly in, or one level under, the merge directory —
 * which is where `download-artifact` puts one artifact per subdirectory.
 * @param directory - Merge directory
 * @returns Receipt paths
 */
function receiptPaths(directory: string): readonly string[] {
  const candidates = [
    directory,
    ...fs
      .readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(directory, entry.name)),
  ].map(candidate => path.join(candidate, SHARD_RECEIPT));
  return candidates.filter(candidate => fs.existsSync(candidate));
}

/**
 * Read one receipt file.
 * @param file - Receipt path
 * @returns The receipt
 */
function readReceipt(file: string): ShardReceipt {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<
    Omit<ShardReceipt, "directory">
  >;
  if (
    typeof raw.index !== "number" ||
    typeof raw.total !== "number" ||
    (raw.runner !== "jest" && raw.runner !== "vitest") ||
    typeof raw.coverage !== "boolean"
  ) {
    throw new Error(`${file} is not a unit-test shard receipt.`);
  }
  return {
    index: raw.index,
    total: raw.total,
    runner: raw.runner,
    coverage: raw.coverage,
    directory: path.dirname(file),
  };
}

/**
 * Refuse a set of receipts that is not exactly shards 1..total of one run.
 * @param receipts - Every receipt found
 * @param total - Expected shard count
 */
function assertCompleteShardSet(
  receipts: readonly ShardReceipt[],
  total: number
): void {
  const foreign = receipts.find(receipt => receipt.total !== total);
  if (foreign !== undefined) {
    throw new Error(
      `shard ${foreign.index}/${foreign.total} belongs to a different layout; expected ${total} shards.`
    );
  }
  const indices = receipts.map(receipt => receipt.index);
  const repeated = indices.find(
    (index, position) => indices.indexOf(index) !== position
  );
  if (repeated !== undefined)
    throw new Error(`shard ${repeated} reported twice.`);
  const seen = new Set(indices);
  const missing = Array.from({ length: total }, (_, i) => i + 1).filter(
    index => !seen.has(index)
  );
  if (missing.length > 0) {
    throw new Error(
      `expected ${total} unit-test shards but found ${seen.size}: missing shard ${missing.join(", ")}.`
    );
  }
  const runners = [...new Set(receipts.map(receipt => receipt.runner))];
  if (runners.length > 1) {
    throw new Error(
      `the shards ran different test runners (${runners.join(", ")}); they cannot be merged.`
    );
  }
}

/**
 * Read every shard's receipt, refusing an incomplete or inconsistent set.
 * @param directory - Merge directory
 * @param total - Expected shard count
 * @returns Receipts in shard order
 */
export function readShardReceipts(
  directory: string,
  total: number
): readonly ShardReceipt[] {
  const receipts = receiptPaths(directory).map(readReceipt);
  assertCompleteShardSet(receipts, total);
  return [...receipts].sort((left, right) => left.index - right.index);
}

/**
 * Turn the payload argv into Vitest's report merge over the gathered blobs.
 * @param argv - Payload argv
 * @param blobs - Directory holding every shard's blob
 * @returns Merge argv
 */
export function vitestMergeArgv(
  argv: readonly [string, ...string[]],
  blobs: string
): [string, ...string[]] {
  return [...argv, `--merge-reports=${blobs}`];
}

/**
 * Copy every shard's blob into one flat directory, which is the only layout
 * `vitest --merge-reports` reads.
 * @param receipts - Every shard's receipt
 * @param into - Destination directory
 */
export function gatherVitestBlobs(
  receipts: readonly ShardReceipt[],
  into: string
): void {
  fs.mkdirSync(into, { recursive: true });
  for (const receipt of receipts) {
    const blob = `blob-${receipt.index}-${receipt.total}.json`;
    const source = path.join(receipt.directory, blob);
    if (!fs.existsSync(source))
      throw new Error(`shard ${receipt.index} left no vitest blob (${blob}).`);
    fs.copyFileSync(source, path.join(into, blob));
  }
}

/** One coverage metric's totals, as istanbul summarises it. */
export interface CoverageMetric {
  readonly total: number;
  readonly covered: number;
  readonly pct: number;
}

/** Istanbul's summary of a coverage map. */
export type CoverageSummary = Readonly<
  Record<"lines" | "statements" | "functions" | "branches", CoverageMetric>
>;

/** A Jest `coverageThreshold` object. */
export type JestThresholds = Readonly<
  Record<string, Readonly<Record<string, number>>>
>;

/**
 * Check merged coverage against the project's Jest `coverageThreshold`, with
 * Jest's own semantics and wording: a positive number is a percentage floor, a
 * negative one a ceiling on uncovered entities.
 *
 * Only the `global` key is supported. Path and glob keys select files by
 * Jest's own matching, and reimplementing that here would be a second
 * definition free to drift from the first, so a sharded run refuses them by
 * name instead of approximating them.
 * @param thresholds - Resolved `coverageThreshold`, or undefined
 * @param summary - Merged coverage summary
 * @returns Jest-worded failures; empty when every floor holds
 */
export function checkJestThresholds(
  thresholds: JestThresholds | undefined,
  summary: CoverageSummary
): readonly string[] {
  const keys = Object.keys(thresholds ?? {});
  const unsupported = keys.find(key => key !== "global");
  if (unsupported !== undefined) {
    throw new Error(
      `coverageThreshold key ${JSON.stringify(unsupported)} cannot be checked across shards; only "global" thresholds are supported when unit_test_shards > 1.`
    );
  }
  const global = thresholds?.global ?? {};
  return (["statements", "branches", "lines", "functions"] as const).flatMap(
    metric => {
      const threshold = global[metric];
      if (threshold === undefined) return [];
      const actual = summary[metric];
      if (threshold < 0) {
        const uncovered = actual.total - actual.covered;
        return -threshold < uncovered
          ? [
              `Jest: Uncovered count for ${metric} (${uncovered}) exceeds global threshold (${-threshold})`,
            ]
          : [];
      }
      return actual.pct < threshold
        ? [
            `Jest: "global" coverage threshold for ${metric} (${threshold}%) not met: ${actual.pct}%`,
          ]
        : [];
    }
  );
}
