/**
 * Merge Jest shard coverage and enforce the project floor once (#4479).
 *
 * Jest has no counterpart to `vitest --merge-reports`, so the merge is done
 * here with the istanbul libraries Jest itself reports through. They are
 * resolved from the project's own Jest install, not bundled with Lisa, so the
 * coverage maps are read and written by the same library versions that
 * produced them.
 *
 * Nothing about the project's coverage configuration is restated. `jest
 * --showConfig` over the very argv the gate task ran resolves
 * `coverageThreshold`, `coverageReporters` and `coverageDirectory` under the
 * same environment — so `LISA_COVERAGE_SCOPE=unit` still selects the unit
 * floor — and the merge writes the reporters the project configured, into the
 * directory it configured, which is where the SonarCloud hand-off looks.
 * @module cli/lisa-test-run-jest-merge
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { env } from "node:process";

import {
  checkJestThresholds,
  type CoverageSummary,
  type JestThresholds,
  type ShardReceipt,
} from "./lisa-test-run-shard.js";

/** The slice of Jest's resolved global config the merge reads. */
interface JestCoverageConfig {
  readonly coverageThreshold?: JestThresholds;
  readonly coverageReporters: readonly (
    | string
    | readonly [string, Record<string, unknown>]
  )[];
  readonly coverageDirectory: string;
}

/** The istanbul surface the merge uses. */
interface Istanbul {
  readonly coverage: {
    createCoverageMap(data: object): {
      merge(data: object): void;
      getCoverageSummary(): { toJSON(): CoverageSummary };
    };
  };
  readonly report: {
    createContext(options: {
      dir: string;
      coverageMap: unknown;
      defaultSummarizer: string;
    }): unknown;
  };
  readonly reports: {
    create(
      name: string,
      options?: Record<string, unknown>
    ): { execute(context: unknown): void };
  };
}

/** Largest `--showConfig` document accepted, in bytes. */
const SHOW_CONFIG_LIMIT = 64 * 1024 * 1024;

/**
 * Resolve Jest's global coverage configuration for this exact command.
 * @param argv - Payload argv the gate task handed `lisa-test-run`
 * @param cwd - Project directory
 * @returns Resolved coverage configuration
 */
function showJestConfig(
  argv: readonly [string, ...string[]],
  cwd: string
): JestCoverageConfig {
  const [command, ...args] = argv;
  const shown = spawnSync(command, [...args, "--showConfig"], {
    cwd,
    encoding: "utf8",
    maxBuffer: SHOW_CONFIG_LIMIT,
  });
  if (shown.status !== 0) {
    throw new Error(
      `jest --showConfig exited ${shown.status ?? shown.signal}: ${shown.stderr}`
    );
  }
  return (JSON.parse(shown.stdout) as { globalConfig: JestCoverageConfig })
    .globalConfig;
}

/**
 * The file a bare command name runs, found on PATH.
 * @param command - Executable name or path
 * @returns Real path of the executable, or undefined
 */
function executablePath(command: string): string | undefined {
  const candidates = command.includes(path.sep)
    ? [command]
    : (env.PATH ?? "")
        .split(path.delimiter)
        .map(directory => path.join(directory, command));
  const found = candidates.find(candidate => fs.existsSync(candidate));
  return found === undefined ? undefined : fs.realpathSync(found);
}

/**
 * Resolve one istanbul library from the project, falling back to the copy
 * reachable from the Jest executable the gate task actually runs.
 * @param name - Package name
 * @param bases - Files to resolve from, in order
 * @returns The loaded module
 */
function load<T>(name: string, bases: readonly string[]): T {
  for (const base of bases) {
    try {
      return createRequire(base)(name) as T;
    } catch {
      // Next base: package managers that isolate dependencies hoist none.
    }
  }
  throw new Error(
    `${name} is not resolvable from the project or its jest install; the shard merge needs the istanbul libraries jest reports with.`
  );
}

/**
 * Every file the istanbul libraries may be resolved from.
 * @param argv - Payload argv
 * @param cwd - Project directory
 * @returns Resolution bases in the order they are tried: the project, then
 * `@jest/reporters` (which depends on istanbul directly) back up to Jest
 */
function resolutionBases(
  argv: readonly [string, ...string[]],
  cwd: string
): readonly string[] {
  const entry = path.basename(argv[0]) === "node" ? argv[1] : argv[0];
  const jest = entry === undefined ? undefined : executablePath(entry);
  const chain = ["@jest/core", "@jest/reporters"].reduce<readonly string[]>(
    (resolved, dependency) => {
      const from = resolved.at(-1);
      const next =
        from === undefined ? undefined : manifestFrom(from, dependency);
      return next === undefined ? resolved : [...resolved, next];
    },
    jest === undefined ? [] : [jest]
  );
  return [path.join(cwd, "package.json"), ...[...chain].reverse()];
}

/**
 * Resolve one package's manifest from a file, or undefined when unreachable.
 * @param from - File to resolve from
 * @param dependency - Package name
 * @returns The manifest path, or undefined
 */
function manifestFrom(from: string, dependency: string): string | undefined {
  try {
    return createRequire(from).resolve(`${dependency}/package.json`);
  } catch {
    return undefined;
  }
}

/**
 * Merge every shard's Jest coverage, write the configured reports, and check
 * the project's `coverageThreshold` once over the merged map.
 * @param argv - Payload argv the gate task handed `lisa-test-run`
 * @param receipts - Every shard's receipt, complete and consistent
 * @param cwd - Project directory
 * @returns Process exit code: 0 when every floor holds
 */
export function mergeJestShards(
  argv: readonly [string, ...string[]],
  receipts: readonly ShardReceipt[],
  cwd: string = process.cwd()
): number {
  if (!receipts.some(receipt => receipt.coverage)) {
    process.stdout.write(
      "lisa-test-run: no shard collected coverage, so there is nothing to merge.\n"
    );
    return 0;
  }
  const config = showJestConfig(argv, cwd);
  const bases = resolutionBases(argv, cwd);
  const istanbul: Istanbul = {
    coverage: load("istanbul-lib-coverage", bases),
    report: load("istanbul-lib-report", bases),
    reports: load("istanbul-reports", bases),
  };
  const map = istanbul.coverage.createCoverageMap({});
  for (const receipt of receipts) {
    const file = path.join(
      receipt.directory,
      "coverage",
      "coverage-final.json"
    );
    if (!fs.existsSync(file))
      throw new Error(`shard ${receipt.index} left no coverage (${file}).`);
    map.merge(JSON.parse(fs.readFileSync(file, "utf8")) as object);
  }
  const context = istanbul.report.createContext({
    dir: config.coverageDirectory,
    coverageMap: map,
    defaultSummarizer: "nested",
  });
  for (const reporter of config.coverageReporters) {
    const [name, options] =
      typeof reporter === "string" ? [reporter, {}] : reporter;
    istanbul.reports.create(name, options).execute(context);
  }
  const failures = checkJestThresholds(
    config.coverageThreshold,
    map.getCoverageSummary().toJSON()
  );
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  return failures.length === 0 ? 0 : 1;
}
