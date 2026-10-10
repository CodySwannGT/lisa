/** Real disposable Git histories for the committed BDD projection contract. */
import * as fs from "node:fs";
import * as path from "node:path";
import { expect } from "vitest";

import { boundedSpawnSync } from "../../../helpers/io-latency-budget.js";
import {
  GIT_BIN,
  HEALTHY_MAP,
  MAP_REL,
  PLAYWRIGHT,
  RATIFIED,
  REPO_ROOT,
  TODAY,
  WEB,
  featureSource,
  hermeticEnv,
  makeProject,
} from "./support.js";

export const FEATURE_FILES = [
  "alpha.feature",
  "middle.feature",
  "omega.feature",
];
export const BASE_COUNTS = [2, 4, 2];
export const UNION_COUNTS = [3, 4, 4];
export const LEGACY_OUTPUTS = [
  "bdd/coverage-report.json",
  "docs/bdd-scenario-matrix.md",
  "docs/e2e-bdd-coverage.md",
];
export const OUTPUT_DIRS = [
  "bdd/reports/v1/features",
  "docs/bdd-scenario-matrix",
  "docs/e2e-bdd-coverage",
];
const FIXTURE_AUTHOR = "Fixture Base";

/** One native command result; nonzero exits remain visible to the caller. */
export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Both independent feature tips descend directly from this real common base. */
export interface MergeHistory {
  readonly root: string;
  readonly base: string;
  readonly alpha: string;
  readonly omega: string;
}

/** Runtime report3 remains the complete aggregate, unlike committed leaves. */
export interface AggregateReport {
  readonly schemaVersion: number;
  readonly scenarios: { declared: number; required: number; excluded: number };
  readonly traceability: {
    overall: {
      covered: number;
      total: number;
      percentage: number;
      exact: number;
    };
  };
  readonly execution: Record<string, unknown>;
  readonly floor: {
    ok: boolean;
    byPlatform: Record<string, { floor: number }>;
  };
  readonly gaps: readonly unknown[];
  readonly testInventory: {
    discovered: number;
    disclosed: number;
    undisclosed: unknown[];
  };
}

/** Stable synthetic identifiers, never real downstream names or tickets. */
function scenarioId(group: number, index: number): string {
  return `BDD-${FEATURE_FILES[group]!.split(".")[0]!.toUpperCase()}-${String(index + 1).padStart(3, "0")}`;
}

/** Separate existing mapping groups give Git genuinely independent input edits. */
function mappings(counts: readonly number[]): Record<string, unknown>[] {
  return counts.flatMap((count, group) =>
    Array.from({ length: count }, (_, index) => ({
      scenario: scenarioId(group, index),
      runner: PLAYWRIGHT,
      platforms: [WEB],
      file: `e2e/${FEATURE_FILES[group]!.replace(".feature", ".spec.ts")}`,
      evidence: `proves ${scenarioId(group, index)}`,
      level: "behavioral",
    }))
  );
}

/** Write one feature and its aligned discovered test declarations. */
function writeGroup(root: string, group: number, count: number): void {
  const scenarios = Array.from({ length: count }, (_, index) => ({
    id: scenarioId(group, index),
    tags: [WEB, RATIFIED, "TASK-123"],
  }));
  const file = FEATURE_FILES[group]!;
  // Same display title deliberately cannot be the generated-leaf identity.
  fs.writeFileSync(
    path.join(root, "bdd/features", file),
    featureSource(group === 1 ? "Middle" : "Shared display title", scenarios)
  );
  fs.mkdirSync(path.join(root, "e2e"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "e2e", file.replace(".feature", ".spec.ts")),
    scenarios
      .map(item => `test("proves ${item.id}", async () => {});\n`)
      .join("")
  );
}

/** Preserve the positive floor and use the real project's input-map format. */
function writeContract(root: string, counts: readonly number[]): void {
  fs.writeFileSync(
    path.join(root, MAP_REL),
    `${JSON.stringify(
      {
        ...HEALTHY_MAP,
        trackers: { keys: ["TASK"] },
        coverageFloor: { [WEB]: 100 },
        mappings: mappings(counts),
      },
      null,
      2
    )}\n`
  );
}

/** Execute real Git with isolated identity/configuration, without hook bypasses. */
export function git(
  root: string,
  args: readonly string[],
  author = FIXTURE_AUTHOR
): CommandResult {
  return boundedSpawnSync({
    label: `BDD projection git ${args[0] ?? ""}`,
    command: GIT_BIN,
    args,
    cwd: root,
    env: {
      ...hermeticEnv(root),
      GIT_AUTHOR_NAME: author,
      GIT_AUTHOR_EMAIL: "fixture@example.test",
      GIT_COMMITTER_NAME: author,
      GIT_COMMITTER_EMAIL: "fixture@example.test",
      GIT_MERGE_AUTOEDIT: "no",
    },
  });
}

/** Require the native operation's terminal success with both diagnostic streams. */
export function successful(result: CommandResult): string {
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return result.stdout.trim();
}

/** Commit the actual whole fixture using an ordinary Git commit. */
function commit(root: string, message: string, author: string): string {
  successful(git(root, ["add", "-A"]));
  successful(git(root, ["commit", "-q", "-m", message], author));
  return successful(git(root, ["rev-parse", "HEAD"]));
}

/** Invoke the copied shipped CLI with a real base and deterministic date. */
export function cli(
  root: string,
  base: string,
  script: string,
  flags: readonly string[],
  extraEnv: Record<string, string> = {}
): CommandResult {
  return boundedSpawnSync({
    label: `BDD projection ${script} ${flags.join(" ")}`,
    command: process.execPath,
    args: [path.join(root, "scripts", script), ...flags],
    cwd: root,
    env: {
      ...hermeticEnv(root),
      BDD_COVERAGE_ROOT: root,
      BDD_BASE_SHA: base,
      BDD_TODAY: TODAY,
      ...extraEnv,
    },
  });
}

/** Both canonical writers must independently finish successfully. */
export function writeReports(root: string, base: string): void {
  successful(cli(root, base, "check-bdd-coverage.mjs", ["--write"]));
  successful(cli(root, base, "bdd-matrix.mjs", ["--write"]));
}

/** Require genuine complete aggregate output, never a fabricated receipt. */
export function aggregate(root: string, base: string): AggregateReport {
  return JSON.parse(
    successful(cli(root, base, "check-bdd-coverage.mjs", ["--report"]))
  ) as AggregateReport;
}

/** Build two independent ordinary feature commits from the same committed base. */
export function makeHistory(withReports: boolean): MergeHistory {
  const root = makeProject({});
  fs.cpSync(
    path.join(REPO_ROOT, "expo/copy-overwrite/scripts"),
    path.join(root, "scripts"),
    { recursive: true }
  );
  BASE_COUNTS.forEach((count, group) => writeGroup(root, group, count));
  writeContract(root, BASE_COUNTS);
  successful(git(root, ["init", "-q"]));
  const inputBase = commit(
    root,
    "test: declare common behaviors",
    FIXTURE_AUTHOR
  );
  expect(aggregate(root, inputBase).traceability.overall.percentage).toBe(100);
  if (withReports) writeReports(root, inputBase);
  const base = withReports
    ? commit(root, "test: generate common reports", FIXTURE_AUTHOR)
    : inputBase;
  const tips = [0, 2].map(group => {
    successful(git(root, ["checkout", "-q", "-b", `feature-${group}`, base]));
    const counts = BASE_COUNTS.map((count, index) =>
      index === group ? UNION_COUNTS[index]! : count
    );
    writeGroup(root, group, counts[group]!);
    writeContract(root, counts);
    expect(aggregate(root, base).scenarios.declared).toBe(group === 0 ? 9 : 10);
    if (withReports) writeReports(root, base);
    return commit(
      root,
      `test: add feature ${group} behaviors`,
      `Fixture Author ${group}`
    );
  });
  return { root, base, alpha: tips[0]!, omega: tips[1]! };
}

/** Complete generated path set plus bytes, including unexpected stale leaves. */
export function reportSnapshot(root: string): Record<string, string> {
  const leaves = OUTPUT_DIRS.flatMap(directory => {
    const absolute = path.join(root, directory);
    if (!fs.existsSync(absolute)) return [];
    return fs
      .readdirSync(absolute, { recursive: true, encoding: "utf8" })
      .filter(file => fs.lstatSync(path.join(absolute, file)).isFile())
      .map(file => `${directory}/${file.split(path.sep).join("/")}`);
  });
  return Object.fromEntries(
    [...LEGACY_OUTPUTS, ...leaves]
      .sort((left, right) => left.localeCompare(right, "en"))
      .map(file => [file, fs.readFileSync(path.join(root, file), "utf8")])
  );
}

/** Full repository-relative feature paths are the explicit projection identity. */
export function expectedOutputPaths(): string[] {
  return [
    ...LEGACY_OUTPUTS,
    ...FEATURE_FILES.flatMap(file =>
      OUTPUT_DIRS.map(
        (directory, index) =>
          `${directory}/bdd/features/${file}.${index === 0 ? "json" : "md"}`
      )
    ),
  ].sort((left, right) => left.localeCompare(right, "en"));
}
