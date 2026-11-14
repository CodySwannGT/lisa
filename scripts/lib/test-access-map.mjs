/**
 * The test-to-file access map Lisa's own CI records (CodySwannGT/lisa#4593).
 *
 * During the full PR run, every test file's entry lists the repository files
 * that test imported, read or executed. B4 (#4600) reads the map to pick the
 * tests a push affects, so it must see what the import graph cannot: Markdown
 * a contract test reads through `fs`, and scripts a test spawns.
 *
 * Three pieces share this module so they cannot disagree on a path or a name:
 *
 * - the tracer (`test-access-map-tracer.mjs`), loaded into every test worker
 *   and every Node child through `NODE_OPTIONS=--import`, which records file
 *   reads, module loads and spawns against `LISA_ACCESS_MAP_TEST_FILE` and
 *   appends them as NDJSON under `LISA_ACCESS_MAP_DIR`;
 * - the setup file (`test-access-map-setup.mjs`), which names the current test
 *   file for the tracer and adds the modules Vitest's own module runner
 *   evaluated (those never reach a Node loader hook);
 * - the reporter built here, which merges the raw records once the run ends
 *   into `tmp/test-access-map/<scope>.json`.
 *
 * Everything is off unless `LISA_ACCESS_MAP=1` AND the project's effective
 * `pushGate.affectedTests` is on, so ordinary local runs are untouched. The
 * shipped Vitest presets carry the plugin (CodySwannGT/lisa#4611), so a host's
 * own CI records its map the same way Lisa's does.
 * @module test-access-map
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { withPushGateDefaults } from "../../all/copy-overwrite/scripts/lib/push-gate-defaults.mjs";
import { declaredTestScope } from "./test-timings-reporter.mjs";

/** Directory, relative to the Vitest root, the per-scope maps land in. */
export const TEST_ACCESS_MAP_DIRECTORY = "tmp/test-access-map";

/** Bumped whenever what the tracer records changes meaning. */
export const TEST_ACCESS_MAP_TRACER_VERSION = 1;

/** Environment the tracer reads; set by {@link armTestAccessMap}. */
export const ACCESS_MAP_ENV = Object.freeze({
  enabled: "LISA_ACCESS_MAP",
  directory: "LISA_ACCESS_MAP_DIR",
  root: "LISA_ACCESS_MAP_ROOT",
  testFile: "LISA_ACCESS_MAP_TEST_FILE",
  owner: "LISA_ACCESS_MAP_OWNER_PID",
});

/** Repository prefixes that are dependencies or generated output, not sources. */
const DROPPED_PREFIXES = Object.freeze([
  ".git/",
  "node_modules/",
  "dist/",
  "coverage/",
  "tmp/",
]);

const TRACER_PATH = path.join(
  import.meta.dirname,
  "test-access-map-tracer.mjs"
);

/** The Vitest setup file that names each test file for the tracer. */
export const TEST_ACCESS_MAP_SETUP_FILE = path.join(
  import.meta.dirname,
  "test-access-map-setup.mjs"
);

/**
 * Whether the access map is requested for this process.
 * @param {Readonly<Record<string, string | undefined>>} env - Process environment
 * @returns {boolean} True when `LISA_ACCESS_MAP=1`
 */
export function testAccessMapEnabled(env) {
  return env[ACCESS_MAP_ENV.enabled] === "1";
}

/**
 * The scope this run records a map for, or `undefined` when it records none.
 * Never in a Vitest process a test spawned (a worker exports
 * `VITEST_WORKER_ID` to its children): a nested fixture run is attributed to
 * the outer test instead of writing a map of its own.
 * @param {Readonly<Record<string, string | undefined>>} env - Process environment
 * @returns {"unit" | "integration" | undefined} Scope
 */
export function testAccessMapScope(env) {
  if (!testAccessMapEnabled(env) || env["VITEST_WORKER_ID"] !== undefined)
    return undefined;
  return declaredTestScope(env);
}

/**
 * A recorded absolute path as a repository-relative POSIX path, or
 * `undefined` when it is outside the repository, a dependency, or generated
 * output.
 * @param {string} root - Repository root (absolute)
 * @param {string} file - Absolute or `file:` URL path
 * @returns {string | undefined} Repository-relative path
 */
export function repositoryFile(root, file) {
  const absolute = file.startsWith("file:")
    ? decodeURIComponent(new URL(file).pathname)
    : file;
  if (!path.isAbsolute(absolute)) return undefined;
  const relative = path.relative(root, path.normalize(absolute));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative))
    return undefined;
  const posix = relative.split(path.sep).join("/");
  if (
    DROPPED_PREFIXES.some(prefix => posix.startsWith(prefix)) ||
    posix.includes("/node_modules/")
  )
    return undefined;
  return posix;
}

/**
 * Merge raw NDJSON records (`{"test": abs, "files": [abs, …]}`) into a map
 * keyed by repository-relative test file. Every executed test file gets an
 * entry, even one that touched nothing else, and lists itself.
 * @param {object} input - Inputs
 * @param {string} input.root - Repository root
 * @param {ReadonlyArray<string>} input.lines - Raw NDJSON lines
 * @param {ReadonlyArray<string>} input.testFiles - Absolute paths of executed test files
 * @returns {Readonly<Record<string, ReadonlyArray<string>>>} Sorted map
 */
export function mergeAccessRecords({ root, lines, testFiles }) {
  const records = lines.flatMap(line => {
    if (line.trim() === "") return [];
    try {
      const parsed = JSON.parse(line);
      return typeof parsed?.test === "string" && Array.isArray(parsed.files)
        ? [parsed]
        : [];
    } catch {
      return [];
    }
  });
  const entries = [
    ...testFiles.map(test => ({ test, files: [test] })),
    ...records,
  ].flatMap(({ test, files }) => {
    const key = repositoryFile(root, test);
    if (key === undefined) return [];
    return [
      [
        key,
        files.flatMap(file => {
          const relative =
            typeof file === "string" ? repositoryFile(root, file) : undefined;
          return relative === undefined ? [] : [relative];
        }),
      ],
    ];
  });

  const grouped = entries.reduce((map, [key, files]) => {
    const set = map.get(key) ?? new Set([key]);
    files.forEach(file => set.add(file));
    return map.set(key, set);
  }, new Map());

  return Object.fromEntries(
    [...grouped.keys()].sort().map(key => [key, [...grouped.get(key)].sort()])
  );
}

/**
 * A whole number from the environment that is at least `minimum`, or null.
 * @param {string | undefined} value - Raw value
 * @param {number} minimum - Smallest accepted value
 * @returns {number | null} The number, or null
 */
function wholeNumber(value, minimum) {
  const parsed = /^\d+$/.test(value ?? "") ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

/**
 * Metadata a published map carries, read from the CI environment.
 *
 * `piece` and `pieces` (CodySwannGT/lisa#4593) say which piece of the scope's
 * map this job uploaded and how many the scope has: the workflow passes the
 * job's `strategy.job-index` and `strategy.job-total` as
 * `LISA_ACCESS_MAP_PIECE` and `LISA_ACCESS_MAP_PIECES`. The fetcher refuses a
 * run missing any piece, because a shard that never uploaded would otherwise
 * drop its tests from the merged map, and refuses a piece with no count.
 * @param {Readonly<Record<string, string | undefined>>} env - Process environment
 * @param {string} scope - Map scope
 * @param {Date} now - Creation time
 * @param {ReadonlyArray<string>} [triggers] - The project's full-rerun triggers
 * @returns {Readonly<Record<string, unknown>>} Metadata
 */
export function accessMapMetadata(env, scope, now, triggers = []) {
  return {
    scope,
    baseSha: env["LISA_ACCESS_MAP_BASE_SHA"] || null,
    headSha: env["LISA_ACCESS_MAP_HEAD_SHA"] || env["GITHUB_SHA"] || null,
    runId: env["GITHUB_RUN_ID"] || null,
    createdAt: now.toISOString(),
    tracerVersion: TEST_ACCESS_MAP_TRACER_VERSION,
    piece: wholeNumber(env["LISA_ACCESS_MAP_PIECE"], 0),
    pieces: wholeNumber(env["LISA_ACCESS_MAP_PIECES"], 1),
    triggers: [...triggers],
  };
}

/**
 * The project's own full-rerun triggers, from its resolved Vitest config, as
 * repository-relative globs (CodySwannGT/lisa#4611).
 *
 * The selector cannot resolve a host's merged Vitest config at push, so the
 * recorder writes `forceRerunTriggers`, `setupFiles` and `globalSetup` into
 * the map. A change to any of them then runs the full suite with the trigger
 * printed. Absolute paths become repository-relative, and paths outside the
 * repository or under `node_modules` (Lisa's own preset files) are dropped.
 * @param {string} root - Vitest root directory
 * @param {{ forceRerunTriggers?: unknown, setupFiles?: unknown, globalSetup?: unknown }} config - Resolved Vitest config
 * @returns {ReadonlyArray<string>} Sorted, de-duplicated globs
 */
export function configuredTriggers(root, config) {
  const listed = ["forceRerunTriggers", "setupFiles", "globalSetup"].flatMap(
    key => {
      const value = config?.[key];
      const entries = Array.isArray(value) ? value : [value];
      return entries.filter(entry => typeof entry === "string" && entry);
    }
  );
  const globs = listed.flatMap(entry => {
    if (!path.isAbsolute(entry) && !entry.startsWith("file:")) return [entry];
    const relative = repositoryFile(root, entry);
    return relative === undefined ? [] : [relative];
  });
  return [...new Set(globs)].sort();
}

/**
 * Whether the project at `root` wants a map recorded: its effective
 * `pushGate.affectedTests`, stack defaults included (CodySwannGT/lisa#4611).
 * A host that turned selection off pays nothing for a map it never reads. A
 * missing or unreadable config falls back to the stack default; a malformed
 * `pushGate` records nothing.
 * @param {string} root - Project root
 * @returns {boolean} True when the map is wanted
 */
export function accessMapWanted(root) {
  const config = (() => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(root, ".lisa.config.json"), "utf8")
      );
    } catch {
      return {};
    }
  })();
  return withPushGateDefaults(config, root).pushGate?.affectedTests === true;
}

/**
 * Prepare this process's environment so every worker and Node child the run
 * starts inherits the tracer. Idempotent: the hook runs once per project.
 * Returns the raw-record directory, or `undefined` when the map is off.
 * @param {Record<string, string | undefined>} env - Process environment (mutated)
 * @param {string} root - Vitest root directory
 * @returns {string | undefined} Raw-record directory
 */
export function armTestAccessMap(env, root) {
  const scope = testAccessMapScope(env);
  if (scope === undefined) return undefined;
  const existing = env[ACCESS_MAP_ENV.directory];
  if (existing !== undefined) return existing;
  const directory = path.join(
    root,
    TEST_ACCESS_MAP_DIRECTORY,
    `raw-${scope}-${process.pid}`
  );
  fs.rmSync(directory, { recursive: true, force: true });
  const importFlag = `--import=${pathToFileURL(TRACER_PATH).href}`;
  const options = env["NODE_OPTIONS"] ?? "";

  env[ACCESS_MAP_ENV.directory] = directory;
  env[ACCESS_MAP_ENV.root] = root;
  if (!options.includes(importFlag))
    env["NODE_OPTIONS"] = `${options} ${importFlag}`.trim();

  return directory;
}

/**
 * Every NDJSON line under the raw-record directory.
 * @param {string} directory - Raw-record directory
 * @returns {ReadonlyArray<string> | undefined} Lines, or undefined when nothing was recorded
 */
function rawLines(directory) {
  if (!fs.existsSync(directory)) return undefined;
  const files = fs
    .readdirSync(directory)
    .filter(name => name.endsWith(".ndjson"));
  if (files.length === 0) return undefined;
  return files.flatMap(name =>
    fs.readFileSync(path.join(directory, name), "utf8").split("\n")
  );
}

/**
 * A Vitest reporter that writes `<root>/tmp/test-access-map/<scope>.json`
 * once the run ends: `{ meta, map }`. A run that recorded nothing — a
 * `--merge-reports` aggregate, say — writes nothing rather than an empty map.
 * @param {object} input - Inputs
 * @param {string} input.root - Vitest root directory
 * @param {string} input.directory - Raw-record directory
 * @param {Readonly<Record<string, string | undefined>>} input.env - Process environment
 * @param {ReadonlyArray<string>} [input.triggers] - The project's full-rerun triggers
 * @returns {{ onTestRunEnd: (modules: ReadonlyArray<{ moduleId: string, state: () => string }>) => void }} Reporter
 */
export function testAccessMapReporter({ root, directory, env, triggers = [] }) {
  return {
    lisaTestAccessMap: true,
    onTestRunEnd(testModules) {
      const scope = testAccessMapScope(env);
      const lines = rawLines(directory);
      if (scope === undefined || lines === undefined) return;
      const testFiles = testModules
        .filter(module => module.state() !== "skipped")
        .map(module => module.moduleId);
      const map = mergeAccessRecords({ root, lines, testFiles });
      const output = path.join(
        root,
        TEST_ACCESS_MAP_DIRECTORY,
        `${scope}.json`
      );
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(
        output,
        `${JSON.stringify({ meta: accessMapMetadata(env, scope, new Date(), triggers), map }, null, 2)}\n`
      );
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

/**
 * The resolved reporters with the access-map reporter appended once. The
 * config hook runs once per Vitest project and every project shares one list.
 * @param {ReadonlyArray<unknown>} reporters - Resolved reporters
 * @param {object} reporter - The access-map reporter
 * @returns {ReadonlyArray<unknown>} Reporters, with an access-map reporter at most once
 */
export function withTestAccessMapReporter(reporters, reporter) {
  const present = reporters.some(
    entry =>
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry) &&
      entry.lisaTestAccessMap === true
  );
  return present ? reporters : [...reporters, reporter];
}

/**
 * The setup files the access map adds: its own when the map is on, else none.
 * @param {Readonly<Record<string, string | undefined>>} env - Process environment
 * @returns {ReadonlyArray<string>} Setup files
 */
export function testAccessMapSetupFiles(env) {
  return testAccessMapEnabled(env) ? [TEST_ACCESS_MAP_SETUP_FILE] : [];
}

/**
 * The Vitest plugin that arms the tracer and appends the reporter. It works
 * after config resolution, so a shard leg's CLI `--reporter=blob` keeps it.
 * @param {Record<string, string | undefined>} [env] - Process environment (mutated when armed)
 * @returns {{ name: string, configureVitest: (context: { vitest: { config: { root: string, reporters: unknown[] } } }) => void }} Plugin
 */
export function testAccessMapPlugin(env = process.env) {
  return {
    name: "lisa:test-access-map",
    configureVitest({ vitest }) {
      const root = vitest.config.root;
      if (!testAccessMapEnabled(env) || !accessMapWanted(root)) return;
      const directory = armTestAccessMap(env, root);
      if (directory === undefined) return;
      const reporter = testAccessMapReporter({
        root,
        directory,
        env,
        triggers: configuredTriggers(root, vitest.config),
      });

      vitest.config.reporters = [
        ...withTestAccessMapReporter(vitest.config.reporters, reporter),
      ];
    },
  };
}
