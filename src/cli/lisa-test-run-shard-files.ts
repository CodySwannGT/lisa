/**
 * File-list shard legs for `lisa-test-run` (CodySwannGT/lisa#4599).
 *
 * `quality.yml`'s integration plan job assigns test files to legs
 * longest-processing-time-first from the per-file durations a previous run
 * recorded, and hands every leg the same plan. Vitest's own `--shard` cannot
 * take that plan: it slices by a hash of the path, and it decides which
 * projects' global setups to run from the FULL selection before it slices, so
 * every `--shard` leg pays every project's global setup (the history-scanner
 * download, for Lisa).
 *
 * A file-list leg therefore asks Vitest for the run's own selection
 * (`vitest list --filesOnly`, which resolves files and runs no global setup),
 * keeps the files the plan gave it, and excludes every other selected file.
 * Exclusion, not a positive file list, because the payload's positional
 * filters are OR-ed by Vitest: adding files to `vitest run tests/integration`
 * would select the whole directory again.
 *
 * A file the plan never saw (a test added since the timings were recorded) is
 * placed by one deterministic rule every leg applies to the same selection:
 * its group's shard when it belongs to a group, else the least-loaded shard.
 * So every selected file runs in exactly one leg.
 * @module cli/lisa-test-run-shard-files
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  runnerEntry,
  shardArgv,
  type ShardLeg,
} from "./lisa-test-run-shard.js";

/** The schema token a file plan carries. */
export const SHARD_PLAN_SCHEMA = "lisa.test-shard-plan/v1";

/** Files that must share one leg, e.g. suites behind one global setup. */
export interface ShardFileGroup {
  readonly files: readonly string[];
  readonly shard: number;
}

/** What the plan job decided, as every leg reads it. */
export interface ShardFilePlan {
  readonly total: number;
  /** Repository-relative file path to its 1-based shard. */
  readonly assignments: Readonly<Record<string, number>>;
  /** Planned seconds per shard, index 0 for shard 1. */
  readonly seconds: readonly number[];
  /** Weight given to a file the plan never timed. */
  readonly defaultSeconds: number;
  readonly groups: readonly ShardFileGroup[];
}

/**
 * Whether a value is a shard number for `total` shards.
 * @param value - Candidate
 * @param total - Shard count
 * @returns True for a whole number in 1..total
 */
function isShard(value: unknown, total: number): value is number {
  return (
    Number.isInteger(value) && Number(value) >= 1 && Number(value) <= total
  );
}

/**
 * Whether a parsed object is a well-formed plan.
 * @param raw - Parsed JSON
 * @returns True when every field has the shape the leg relies on
 */
function wellFormed(raw: Record<string, unknown>): boolean {
  const total = raw.total;
  if (raw.schema !== SHARD_PLAN_SCHEMA || !Number.isInteger(total))
    return false;
  const count = Number(total);
  const assignments = raw.assignments;
  const groups = raw.groups;
  return (
    count >= 1 &&
    typeof assignments === "object" &&
    assignments !== null &&
    Object.values(assignments).every(shard => isShard(shard, count)) &&
    Array.isArray(raw.seconds) &&
    raw.seconds.length === count &&
    raw.seconds.every(value => typeof value === "number" && value >= 0) &&
    typeof raw.defaultSeconds === "number" &&
    raw.defaultSeconds >= 0 &&
    Array.isArray(groups) &&
    groups.every(
      (group: { files?: unknown; shard?: unknown }) =>
        Array.isArray(group?.files) &&
        group.files.every(file => typeof file === "string") &&
        isShard(group.shard, count)
    )
  );
}

/**
 * Read the plan file a leg was given, refusing one for another layout.
 * @param file - Plan path
 * @param total - This leg's shard count
 * @returns The plan
 */
export function readShardFilePlan(file: string, total: number): ShardFilePlan {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
    string,
    unknown
  >;
  if (!wellFormed(raw)) throw new Error(`${file} is not a test shard plan.`);
  const plan = raw as unknown as ShardFilePlan & { schema?: string };
  if (plan.total !== total) {
    throw new Error(
      `${file} plans ${plan.total} shards, but this leg is one of ${total}.`
    );
  }
  return {
    total: plan.total,
    assignments: plan.assignments,
    seconds: plan.seconds,
    defaultSeconds: plan.defaultSeconds,
    groups: plan.groups,
  };
}

/**
 * The index of the smallest load, lowest shard first on a tie.
 * @param loads - Load per shard
 * @returns Zero-based index
 */
function leastLoaded(loads: readonly number[]): number {
  return loads.reduce(
    (best, load, index) => (load < (loads[best] ?? Infinity) ? index : best),
    0
  );
}

/**
 * Give every selected file one shard: its planned one, its group's, or the
 * least-loaded shard for a file the plan never saw. Pure and order-free, so
 * every leg computes the same answer from the same selection.
 * @param plan - The plan
 * @param selection - Repository-relative files the run selected
 * @returns File to 1-based shard, for every selected file
 */
export function assignShardFiles(
  plan: ShardFilePlan,
  selection: readonly string[]
): ReadonlyMap<string, number> {
  const grouped = new Map(
    plan.groups.flatMap(group => group.files.map(file => [file, group.shard]))
  );
  const sorted = [...new Set(selection)].sort((left, right) =>
    left.localeCompare(right)
  );
  const known = sorted.flatMap(file => {
    const shard = plan.assignments[file] ?? grouped.get(file);
    return shard === undefined ? [] : [[file, shard] as const];
  });
  const planned = new Set(known.map(([file]) => file));
  const unknown = sorted
    .filter(file => !planned.has(file))
    .reduce<{
      readonly loads: readonly number[];
      readonly placed: readonly (readonly [string, number])[];
    }>(
      ({ loads, placed }, file) => {
        const index = leastLoaded(loads);
        return {
          loads: loads.map((load, at) =>
            at === index ? load + plan.defaultSeconds : load
          ),
          placed: [...placed, [file, index + 1] as const],
        };
      },
      { loads: plan.seconds, placed: [] }
    );
  return new Map([...known, ...unknown.placed]);
}

/**
 * Turn a `vitest run` payload into the `vitest list` of the same selection.
 * @param argv - Payload argv
 * @param json - Where Vitest writes the list
 * @returns The list command
 */
export function vitestListArgv(
  argv: readonly [string, ...string[]],
  json: string
): [string, ...string[]] {
  const entry = runnerEntry(argv);
  const start = entry === undefined ? -1 : argv.indexOf(entry);
  const run = argv.indexOf("run", start + 1);
  if (start === -1 || run !== start + 1) {
    throw new Error(
      `a file-list shard needs a \`vitest run\` command, not "${argv.join(" ")}".`
    );
  }
  return [
    argv[0],
    ...argv.slice(1, run),
    "list",
    ...argv.slice(run + 1).filter(arg => !arg.startsWith("--shard")),
    "--filesOnly",
    `--json=${json}`,
  ];
}

/**
 * Read `vitest list --filesOnly --json` output as repository paths.
 * @param file - The list Vitest wrote
 * @param root - Directory paths are made relative to
 * @returns Unique sorted paths
 */
export function readVitestFileList(file: string, root: string): string[] {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  if (
    !Array.isArray(raw) ||
    !raw.every(entry => typeof entry?.file === "string")
  ) {
    throw new Error(`${file} is not a vitest file list.`);
  }
  const files = (raw as { file: string }[]).map(entry =>
    path.relative(root, entry.file).split(path.sep).join("/")
  );
  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}

/**
 * Escape glob metacharacters so an exclusion names one file.
 * @param file - Repository path
 * @returns A glob matching only that path
 */
function literalGlob(file: string): string {
  return file.replace(/[*?[\]{}()!+@]/g, "\\$&");
}

/**
 * The leg's argv: the shard reporting a `--shard` leg gets, without the
 * slice, plus one exclusion per file another leg runs.
 * @param argv - Payload argv
 * @param leg - This shard leg
 * @param others - Selected files assigned to other legs
 * @param mine - How many selected files this leg runs
 * @returns The leg's argv
 */
export function filesShardArgv(
  argv: readonly [string, ...string[]],
  leg: ShardLeg,
  others: readonly string[],
  mine: number
): [string, ...string[]] {
  const reporting = shardArgv(argv, "vitest", leg)
    .slice(argv.length)
    .filter(arg => !arg.startsWith("--shard="));
  return [
    ...argv,
    ...others.map(file => `--exclude=${literalGlob(file)}`),
    ...(mine === 0 ? ["--passWithNoTests"] : []),
    ...reporting,
  ];
}

/** Lists a payload's selection; injectable for tests. */
export type ListSelection = (
  argv: readonly [string, ...string[]],
  env: NodeJS.ProcessEnv
) => string[];

/**
 * Run `vitest list` for the payload's selection. Lisa's CI-only reporters and
 * the access-map tracer are switched off for it: it runs no tests and must
 * leave nothing a later step would read.
 * @param argv - Payload argv
 * @param env - Environment the payload will run with
 * @returns Repository-relative selected files
 */
export const listVitestSelection: ListSelection = (argv, env) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-shard-list-"));
  try {
    const json = path.join(scratch, "files.json");
    const [command, ...args] = vitestListArgv(argv, json);
    const child = spawnSync(command, args, {
      env: { ...env, LISA_ACCESS_MAP: "", LISA_TEST_TIMINGS_SCOPE: "" },
      stdio: ["ignore", "ignore", "inherit"],
      timeout: 300_000,
    });
    if (child.status !== 0 || !fs.existsSync(json)) {
      throw new Error(
        `could not list the selection with "${[command, ...args].join(" ")}" (exit ${child.status ?? child.signal}).`
      );
    }
    return readVitestFileList(json, process.cwd());
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
};

/** A file-list leg's argv and what it decided. */
export interface FilesShardDecision {
  readonly argv: [string, ...string[]];
  readonly mine: number;
  readonly selected: number;
  readonly plannedSeconds: number;
}

/**
 * Plan one file-list leg end to end.
 * @param argv - Payload argv
 * @param leg - This shard leg, carrying its plan path
 * @param env - Environment the payload will run with
 * @param list - Selection lister
 * @returns The leg's argv and counts
 */
export function planFilesShard(
  argv: readonly [string, ...string[]],
  leg: ShardLeg & { readonly filePlan: string },
  env: NodeJS.ProcessEnv,
  list: ListSelection = listVitestSelection
): FilesShardDecision {
  const plan = readShardFilePlan(leg.filePlan, leg.total);
  const selection = list(argv, env);
  const placed = assignShardFiles(plan, selection);
  const others = [...placed]
    .filter(([, shard]) => shard !== leg.index)
    .map(([file]) => file);
  const mine = placed.size - others.length;
  return {
    argv: filesShardArgv(argv, leg, others, mine),
    mine,
    selected: placed.size,
    plannedSeconds: plan.seconds[leg.index - 1] ?? 0,
  };
}
