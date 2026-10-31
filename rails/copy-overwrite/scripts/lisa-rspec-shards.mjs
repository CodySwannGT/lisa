#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * RSpec shard planner and verifier for `quality-rails.yml` `test_shards`.
 *
 * The reusable Rails workflow runs the suite as N parallel legs when a caller
 * sets `test_shards` above 1. This file is the part of that which decides
 * something, kept out of the workflow so it can be tested:
 *
 *   plan     Discover every spec file the way a bare `bundle exec rspec`
 *            would, weigh each one, and split them across N shards. Balanced
 *            by the per-file timings of a previous run when they exist, and by
 *            file size when they do not. The split is proven a partition —
 *            every file in exactly one shard — before it is written.
 *   files    Write one shard's file list, one path per line.
 *   stage    Copy a finished shard's SimpleCov `.resultset.json` beside its
 *            run record, so the aggregate can collate it.
 *   verify   In the aggregate: prove from every shard's run record — written
 *            by `lisa_rspec_shard_recorder.rb` from RSpec's own
 *            `files_to_run` — that the shards loaded every planned file
 *            exactly once, and that the plan still matches the checkout. It
 *            then names the resultsets to collate.
 *   timings  Fold every shard's per-example run times into per-file timings
 *            for the next run's plan.
 *
 * Node-only and dependency-free on purpose: it runs on the bare runner, in
 * jobs that never install the project's gems, and never inside the scratch
 * supervisor's payload.
 *
 * Usage:
 *   node scripts/lisa-rspec-shards.mjs plan --shards N --out plan.json [--timings t.json] [--root .]
 *   node scripts/lisa-rspec-shards.mjs files --plan plan.json --shard K --out files.txt
 *   node scripts/lisa-rspec-shards.mjs stage --record record.json --out DIR
 *   node scripts/lisa-rspec-shards.mjs verify --plan plan.json --shards-dir DIR --resultsets out.txt [--root .]
 *   node scripts/lisa-rspec-shards.mjs timings --shards-dir DIR --out timings.json
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Plan and record schema version. */
export const SCHEMA_VERSION = 1;

/** The bounds `test_shards` accepts, matching `unit_test_shards`. */
export const MIN_SHARDS = 1;
export const MAX_SHARDS = 20;

/** RSpec's default `--default-path`. */
const SPEC_DIR = "spec";

/** The run record each shard writes, named inside its shard directory. */
export const RECORD_FILE = "record.json";

/** The staged SimpleCov resultset inside a shard directory. */
export const RESULTSET_FILE = "resultset.json";

/**
 * `.rspec` options that change which files a bare `rspec` loads. Sharding
 * passes explicit file paths, which bypass every one of them, so a project
 * that sets any would silently run a different set sharded than unsharded.
 */
const DISCOVERY_OPTIONS = [
  "--pattern",
  "-P",
  "--exclude-pattern",
  "--default-path",
];

/**
 * @typedef {object} PlanShard
 * @property {number} index - 1-based shard number
 * @property {string[]} files - Repo-relative spec paths, sorted
 * @property {number} estimate - Summed weight of the shard's files
 */

/**
 * @typedef {object} Plan
 * @property {number} version - Schema version
 * @property {number} total - Shard count
 * @property {"timings" | "size" | "mixed"} basis - What the weights came from
 * @property {string[]} files - Every discovered spec file, sorted
 * @property {PlanShard[]} shards - One entry per shard, in order
 */

/**
 * @typedef {object} ExampleTiming
 * @property {string} file - Repo-relative spec path the example belongs to
 * @property {number} run_time - Seconds
 */

/**
 * @typedef {object} ShardRecord
 * @property {number} version - Schema version
 * @property {string} shard - "K/N"
 * @property {string[]} files_to_run - What RSpec itself loaded
 * @property {ExampleTiming[]} examples - Per-example timings
 * @property {{ active: boolean, coverage_path?: string }} simplecov - Coverage hand-off
 */

/**
 * Raised for a refusal whose message is the whole explanation.
 */
export class ShardError extends Error {}

/**
 * Normalise a path to forward slashes, relative, without a leading `./`.
 * @param {string} path - Path as RSpec or the filesystem spelled it
 * @returns {string} Canonical repo-relative path
 */
export function canonicalPath(path) {
  return path
    .split(sep)
    .join("/")
    .replace(/^(\.\/)+/, "");
}

/**
 * Refuse a project whose `.rspec` changes which files a bare `rspec` loads.
 * @param {string} root - Project root
 */
export function refuseCustomDiscovery(root) {
  for (const name of [".rspec", ".rspec-local"]) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    const tokens = readFileSync(file, "utf8")
      .split("\n")
      .filter(line => !line.trim().startsWith("#"))
      .flatMap(line => line.trim().split(/\s+/))
      .map(token => token.split("=")[0]);
    const found = DISCOVERY_OPTIONS.filter(option => tokens.includes(option));
    if (found.length > 0) {
      throw new ShardError(
        `${name} sets ${found.join(", ")}, which changes which spec files a bare \`rspec\` loads. Sharding passes explicit file paths, which bypass ${found.length === 1 ? "that option" : "those options"}, so the sharded run would not be the suite the unsharded run is. Remove ${found.length === 1 ? "it" : "them"}, or leave test_shards at 1.`
      );
    }
  }
}

/**
 * Every spec file a bare `rspec` loads: `spec/**\/*_spec.rb`, skipping dot
 * entries as Ruby's glob does. A symlinked directory is refused rather than
 * guessed at, because RSpec's pattern follows exactly one level of them.
 * @param {string} root - Project root
 * @returns {string[]} Repo-relative spec paths, sorted
 */
export function discoverSpecFiles(root) {
  const base = join(root, SPEC_DIR);
  if (!existsSync(base)) return [];
  /** @type {string[]} */
  const found = [];
  /** @param {string} dir - Directory to walk */
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        if (statSync(full).isDirectory()) {
          throw new ShardError(
            `${canonicalPath(relative(root, full))} is a symlinked directory. RSpec's default pattern follows one level of symlinks, which this planner does not reproduce, so it refuses rather than risk dropping files. Leave test_shards at 1, or replace the symlink.`
          );
        }
        if (entry.name.endsWith("_spec.rb"))
          found.push(canonicalPath(relative(root, full)));
        continue;
      }
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith("_spec.rb"))
        found.push(canonicalPath(relative(root, full)));
    }
  };
  walk(base);
  return found.sort();
}

/**
 * Read a timings file, tolerating its absence or a foreign shape.
 * @param {string | undefined} path - Timings file path
 * @returns {Record<string, number>} Seconds by repo-relative spec path
 */
export function readTimings(path) {
  if (!path || !existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed?.version !== SCHEMA_VERSION || typeof parsed.files !== "object")
      return {};
    /** @type {Record<string, number>} */
    const out = {};
    for (const [file, seconds] of Object.entries(parsed.files)) {
      if (
        typeof seconds === "number" &&
        Number.isFinite(seconds) &&
        seconds >= 0
      )
        out[file] = seconds;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Weigh each file: its recorded seconds when known, otherwise its size scaled
 * by the seconds-per-byte of the files that are known, otherwise its size.
 * @param {string[]} files - Spec paths
 * @param {Record<string, number>} sizes - Bytes by path
 * @param {Record<string, number>} timings - Seconds by path
 * @returns {{ weights: Record<string, number>, basis: Plan["basis"] }} Weights and their source
 */
export function weighFiles(files, sizes, timings) {
  const known = files.filter(file => file in timings);
  const knownBytes = known.reduce((sum, file) => sum + (sizes[file] ?? 0), 0);
  const knownSeconds = known.reduce(
    (sum, file) => sum + (timings[file] ?? 0),
    0
  );
  const perByte =
    known.length > 0 && knownBytes > 0 ? knownSeconds / knownBytes : 0;
  /** @type {Record<string, number>} */
  const weights = {};
  for (const file of files) {
    const size = Math.max(1, sizes[file] ?? 1);
    const timed = timings[file];
    if (timed !== undefined) weights[file] = timed;
    else weights[file] = perByte > 0 ? size * perByte : size;
  }
  let basis = /** @type {Plan["basis"]} */ ("size");
  if (known.length === files.length && files.length > 0) basis = "timings";
  else if (known.length > 0) basis = "mixed";
  return { weights, basis };
}

/**
 * Longest-processing-time-first split: heaviest file to the lightest shard.
 * Deterministic — ties break on path, then on the lower shard number.
 * @param {string[]} files - Spec paths
 * @param {Record<string, number>} weights - Weight by path
 * @param {number} total - Shard count
 * @returns {PlanShard[]} One entry per shard
 */
export function partition(files, weights, total) {
  /** @type {PlanShard[]} */
  const shards = Array.from({ length: total }, (_, i) => ({
    index: i + 1,
    files: [],
    estimate: 0,
  }));
  const ordered = [...files].sort(
    (a, b) =>
      (weights[b] ?? 0) - (weights[a] ?? 0) || (a < b ? -1 : a > b ? 1 : 0)
  );
  for (const file of ordered) {
    let target = shards[0];
    for (const shard of shards) {
      if (target === undefined || shard.estimate < target.estimate)
        target = shard;
    }
    if (target === undefined) throw new ShardError("no shards to assign to");
    target.files.push(file);
    target.estimate += weights[file] ?? 0;
  }
  for (const shard of shards) shard.files.sort();
  return shards;
}

/**
 * Name each file and the shards it appeared in.
 * @param {[string, number[]][]} overlap - File and shard numbers
 * @returns {string} "file (shards 1, 2); ..."
 */
function describeOverlap(overlap) {
  return overlap
    .map(([file, at]) => {
      const shards = at.join(", ");
      return `${file} (shards ${shards})`;
    })
    .join("; ");
}

/**
 * Prove a split is a partition of `files`: every file in exactly one shard,
 * nothing else in any shard, and no shard empty (an empty file list makes a
 * bare `rspec` run the WHOLE suite).
 * @param {string[]} files - Every discovered spec path
 * @param {{ index: number, files: string[] }[]} shards - The split
 */
export function assertPartition(files, shards) {
  /** @type {Map<string, number[]>} */
  const seen = new Map();
  for (const shard of shards) {
    if (shard.files.length === 0)
      throw new ShardError(
        `shard ${shard.index} has no spec files; a bare rspec would run the whole suite there.`
      );
    for (const file of shard.files)
      seen.set(file, [...(seen.get(file) ?? []), shard.index]);
  }
  const expected = new Set(files);
  const duplicated = [...seen].filter(([, at]) => at.length > 1);
  const dropped = files.filter(file => !seen.has(file));
  const foreign = [...seen.keys()].filter(file => !expected.has(file));
  /** @type {string[]} */
  const problems = [];
  if (duplicated.length > 0)
    problems.push(`in more than one shard: ${describeOverlap(duplicated)}`);
  if (dropped.length > 0) problems.push(`in no shard: ${dropped.join(", ")}`);
  if (foreign.length > 0)
    problems.push(`not a discovered spec file: ${foreign.join(", ")}`);
  if (problems.length > 0)
    throw new ShardError(
      `the shard split is not a partition of the suite — ${problems.join(" | ")}`
    );
}

/**
 * Parse and bound-check a shard count.
 * @param {string | number | undefined} value - Raw `test_shards`
 * @returns {number} The count
 */
export function parseShardCount(value) {
  const text = String(value ?? "").trim();
  const count = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(count) || count < MIN_SHARDS || count > MAX_SHARDS) {
    throw new ShardError(
      `test_shards is "${text}"; it must be a whole number from ${MIN_SHARDS} to ${MAX_SHARDS}. 1, the default, runs the suite in one unsharded job.`
    );
  }
  return count;
}

/**
 * Build a shard plan for a project.
 * @param {object} options - Planner inputs
 * @param {string} options.root - Project root
 * @param {number} options.total - Shard count
 * @param {Record<string, number>} [options.timings] - Seconds by path
 * @returns {Plan} The proven plan
 */
export function buildPlan({ root, total, timings = {} }) {
  refuseCustomDiscovery(root);
  const files = discoverSpecFiles(root);
  if (files.length === 0)
    throw new ShardError(
      `no spec files under ${SPEC_DIR}/ matched *_spec.rb, so there is nothing to shard.`
    );
  if (files.length < total)
    throw new ShardError(
      `test_shards is ${total} but the suite has only ${files.length} spec file(s). Lower test_shards to at most ${files.length}.`
    );
  /** @type {Record<string, number>} */
  const sizes = {};
  for (const file of files) sizes[file] = statSync(join(root, file)).size;
  const { weights, basis } = weighFiles(files, sizes, timings);
  const shards = partition(files, weights, total);
  assertPartition(files, shards);
  return { version: SCHEMA_VERSION, total, basis, files, shards };
}

/**
 * Read and shape-check a plan file.
 * @param {string} path - Plan path
 * @returns {Plan} The plan
 */
export function readPlan(path) {
  const plan = JSON.parse(readFileSync(path, "utf8"));
  if (
    plan?.version !== SCHEMA_VERSION ||
    !Array.isArray(plan.shards) ||
    !Array.isArray(plan.files)
  )
    throw new ShardError(
      `${path} is not a version ${SCHEMA_VERSION} RSpec shard plan.`
    );
  return plan;
}

/**
 * One shard's planned files.
 * @param {Plan} plan - The plan
 * @param {number} index - 1-based shard number
 * @returns {string[]} That shard's files
 */
export function shardFiles(plan, index) {
  const shard = plan.shards.find(entry => entry.index === index);
  if (!shard)
    throw new ShardError(
      `the plan has no shard ${index} (it has ${plan.total}).`
    );
  if (shard.files.length === 0)
    throw new ShardError(
      `shard ${index} has no spec files; refusing, because a bare rspec would run the whole suite.`
    );
  return shard.files;
}

/**
 * Every shard directory's run record, keyed by shard number.
 * @param {string} shardsDir - Directory holding one subdirectory per shard
 * @returns {{ records: Map<number, { dir: string, record: ShardRecord }>, problems: string[] }} Records found, and what was wrong
 */
export function readShardRecords(shardsDir) {
  /** @type {Map<number, { dir: string, record: ShardRecord }>} */
  const records = new Map();
  /** @type {string[]} */
  const problems = [];
  const dirs = existsSync(shardsDir)
    ? readdirSync(shardsDir, { withFileTypes: true }).filter(entry =>
        entry.isDirectory()
      )
    : [];
  for (const entry of dirs.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const dir = join(shardsDir, entry.name);
    const file = join(dir, RECORD_FILE);
    if (!existsSync(file)) {
      problems.push(
        `${entry.name} has no ${RECORD_FILE}: RSpec did not finish there, or the shard ran without lisa_rspec_shard_recorder.rb.`
      );
      continue;
    }
    /** @type {ShardRecord} */
    let record;
    try {
      record = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      problems.push(
        `${entry.name}/${RECORD_FILE} is not JSON: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }
    const index = Number(String(record?.shard ?? "").split("/")[0]);
    if (
      record?.version !== SCHEMA_VERSION ||
      !Number.isInteger(index) ||
      !Array.isArray(record.files_to_run)
    ) {
      problems.push(
        `${entry.name}/${RECORD_FILE} is not a version ${SCHEMA_VERSION} shard record.`
      );
      continue;
    }
    if (records.has(index)) {
      problems.push(
        `shard ${index} reported twice (${records.get(index)?.dir} and ${dir}).`
      );
      continue;
    }
    records.set(index, { dir, record });
  }
  return { records, problems };
}

/**
 * The aggregate's proof that the shards ran the suite exactly once.
 * @param {object} options - Verifier inputs
 * @param {Plan} options.plan - The plan the shards ran
 * @param {Map<number, { dir: string, record: ShardRecord }>} options.records - Shard records
 * @param {string[]} [options.recordProblems] - Problems found reading them
 * @param {string[]} options.discovered - Spec files in the aggregate's checkout
 * @returns {{ problems: string[], resultsets: string[], coverage: boolean }} Verdict and resultsets to collate
 */
export function verifyShards({
  plan,
  records,
  recordProblems = [],
  discovered,
}) {
  const problems = [...recordProblems];
  try {
    assertPartition(discovered, plan.shards);
  } catch (error) {
    problems.push(
      `the plan does not match this checkout: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  for (let index = 1; index <= plan.total; index++) {
    if (!records.has(index))
      problems.push(`shard ${index}/${plan.total} left no run record.`);
  }
  for (const index of records.keys()) {
    if (index < 1 || index > plan.total)
      problems.push(`a record names shard ${index}, outside 1-${plan.total}.`);
  }
  /** @type {Map<string, number[]>} */
  const ranIn = new Map();
  for (const [index, { record }] of records) {
    const ran = new Set(record.files_to_run.map(canonicalPath));
    for (const file of ran)
      ranIn.set(file, [...(ranIn.get(file) ?? []), index]);
    const planned = new Set(
      plan.shards.find(shard => shard.index === index)?.files ?? []
    );
    const unplanned = [...ran].filter(file => !planned.has(file)).sort();
    const skipped = [...planned].filter(file => !ran.has(file)).sort();
    if (unplanned.length > 0)
      problems.push(
        `shard ${index} ran files it was not given: ${unplanned.join(", ")}`
      );
    if (skipped.length > 0)
      problems.push(
        `shard ${index} did not run files it was given: ${skipped.join(", ")}`
      );
  }
  const twice = [...ranIn].filter(([, at]) => at.length > 1);
  if (twice.length > 0)
    problems.push(`ran in more than one shard: ${describeOverlap(twice)}`);
  const never = discovered.filter(file => !ranIn.has(file));
  if (never.length > 0 && records.size === plan.total)
    problems.push(`ran in no shard: ${never.join(", ")}`);

  const active = [...records.values()].filter(
    ({ record }) => record.simplecov?.active === true
  );
  /** @type {string[]} */
  const resultsets = [];
  if (active.length > 0 && active.length !== records.size) {
    problems.push(
      `SimpleCov measured ${active.length} of ${records.size} shards; merged coverage would be partial.`
    );
  }
  for (const { dir, record } of active) {
    const file = join(dir, RESULTSET_FILE);
    if (existsSync(file)) resultsets.push(resolve(file));
    else
      problems.push(
        `shard ${record.shard} measured coverage but uploaded no ${RESULTSET_FILE}.`
      );
  }
  return {
    problems,
    resultsets: resultsets.sort(),
    coverage: active.length > 0,
  };
}

/**
 * Fold every shard's example timings into per-file seconds.
 * @param {Iterable<{ record: ShardRecord }>} records - Shard records
 * @returns {{ version: number, files: Record<string, number> }} Timings document
 */
export function buildTimings(records) {
  /** @type {Record<string, number>} */
  const files = {};
  for (const { record } of records) {
    for (const file of record.files_to_run ?? [])
      files[canonicalPath(file)] ??= 0;
    for (const example of record.examples ?? []) {
      if (
        typeof example?.file !== "string" ||
        typeof example.run_time !== "number"
      )
        continue;
      const file = canonicalPath(example.file);
      files[file] = (files[file] ?? 0) + Math.max(0, example.run_time);
    }
  }
  /** @type {Record<string, number>} */
  const sorted = {};
  for (const file of Object.keys(files).sort())
    sorted[file] = Math.round((files[file] ?? 0) * 1000) / 1000;
  return { version: SCHEMA_VERSION, files: sorted };
}

/**
 * Copy a shard's SimpleCov resultset beside its record.
 * @param {string} recordPath - The shard's record
 * @param {string} outDir - The shard's upload directory
 * @returns {string | null} The staged resultset, or null when SimpleCov was not measuring
 */
export function stageResultset(recordPath, outDir) {
  /** @type {ShardRecord} */
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  if (record.simplecov?.active !== true) return null;
  const source = join(
    record.simplecov.coverage_path ?? "coverage",
    ".resultset.json"
  );
  if (!existsSync(source))
    throw new ShardError(
      `SimpleCov was measuring but wrote no ${source}, so this shard's coverage cannot be collated.`
    );
  mkdirSync(outDir, { recursive: true });
  const target = join(outDir, RESULTSET_FILE);
  copyFileSync(source, target);
  return target;
}

/**
 * Parse `--flag value` pairs.
 * @param {string[]} argv - Arguments after the subcommand
 * @returns {Record<string, string>} Flags by name
 */
function parseFlags(argv) {
  /** @type {Record<string, string>} */
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--"))
      throw new ShardError(`unexpected argument "${arg}".`);
    const value = argv[i + 1];
    if (value === undefined) throw new ShardError(`${arg} needs a value.`);
    flags[arg.slice(2)] = value;
    i++;
  }
  return flags;
}

/**
 * A required flag.
 * @param {Record<string, string>} flags - Parsed flags
 * @param {string} name - Flag name
 * @returns {string} Its value
 */
function required(flags, name) {
  const value = flags[name];
  if (!value) throw new ShardError(`--${name} is required.`);
  return value;
}

/**
 * Write a file, creating its directory.
 * @param {string} path - Destination
 * @param {string} body - Contents
 */
function writeOut(path, body) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, body);
}

/**
 * Run one subcommand.
 * @param {string[]} argv - Process arguments after the script path
 * @returns {number} Exit status
 */
export function main(argv) {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  const root = resolve(flags.root ?? ".");
  switch (command) {
    case "plan": {
      const total = parseShardCount(required(flags, "shards"));
      const plan = buildPlan({
        root,
        total,
        timings: readTimings(flags.timings),
      });
      writeOut(required(flags, "out"), `${JSON.stringify(plan, null, 2)}\n`);
      console.log(
        `Planned ${plan.files.length} spec files across ${plan.total} shards, balanced by ${plan.basis}.`
      );
      for (const shard of plan.shards)
        console.log(
          `  shard ${shard.index}/${plan.total}: ${shard.files.length} files, estimate ${shard.estimate.toFixed(1)}`
        );
      return 0;
    }
    case "files": {
      const plan = readPlan(required(flags, "plan"));
      const files = shardFiles(plan, Number(required(flags, "shard")));
      writeOut(required(flags, "out"), `${files.join("\n")}\n`);
      console.log(
        `Shard ${flags.shard}/${plan.total}: ${files.length} spec files.`
      );
      return 0;
    }
    case "stage": {
      const staged = stageResultset(
        required(flags, "record"),
        required(flags, "out")
      );
      console.log(
        staged
          ? `Staged ${staged}.`
          : "SimpleCov was not measuring; no resultset to stage."
      );
      return 0;
    }
    case "verify": {
      const plan = readPlan(required(flags, "plan"));
      const { records, problems: recordProblems } = readShardRecords(
        required(flags, "shards-dir")
      );
      refuseCustomDiscovery(root);
      const verdict = verifyShards({
        plan,
        records,
        recordProblems,
        discovered: discoverSpecFiles(root),
      });
      writeOut(
        required(flags, "resultsets"),
        verdict.resultsets.map(file => `${file}\n`).join("")
      );
      if (verdict.problems.length > 0) {
        for (const problem of verdict.problems)
          console.log(
            `::error title=RSpec shards did not run the suite exactly once::${problem}`
          );
        return 1;
      }
      console.log(
        `Verified: ${plan.files.length} spec files ran exactly once across ${plan.total} shards.`
      );
      console.log(
        verdict.coverage
          ? `${verdict.resultsets.length} coverage resultsets to collate.`
          : "No shard measured SimpleCov coverage."
      );
      return 0;
    }
    case "timings": {
      const { records } = readShardRecords(required(flags, "shards-dir"));
      const timings = buildTimings(records.values());
      writeOut(required(flags, "out"), `${JSON.stringify(timings, null, 2)}\n`);
      console.log(
        `Recorded timings for ${Object.keys(timings.files).length} spec files.`
      );
      return 0;
    }
    default:
      throw new ShardError(
        `unknown subcommand "${command ?? ""}"; expected plan, files, stage, verify or timings.`
      );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof ShardError)) throw error;
    console.log(`::error title=RSpec shard plan refused::${error.message}`);
    process.exitCode = 1;
  }
}
