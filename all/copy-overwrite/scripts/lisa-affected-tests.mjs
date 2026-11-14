#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Run a test command at push, narrowed to the tests the change can affect
 * (CodySwannGT/lisa#4600). The decisions are in `lib/affected-tests.mjs`; this
 * file gathers their inputs (git, `.lisa.config.json`, the access map) and
 * runs the command.
 *
 * Usage:
 *   node scripts/lisa-affected-tests.mjs [--fetch <script>] -- <full test command…>
 *
 * The command after `--` is the FULL command, exactly as the push gate ran it
 * before. With `pushGate.affectedTests` off it runs unchanged and this prints
 * nothing. With it on, the command runs unchanged whenever a full-suite reason
 * holds (the reason is printed), or with its `vitest run` rewritten to
 * `vitest related --run <changed files> <map-selected tests>` otherwise.
 *
 * `--fetch <script>` names the script that downloads the access map
 * (`--base <sha> --out <dir>`, exit 1 when there is none). Without it, or when
 * it fails or takes too long, a map already on disk is used if it is still
 * valid for this branch; otherwise the full suite runs.
 * @module lisa-affected-tests
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_MAX_AGE_DAYS,
  MAX_AGE_ENV,
  PARTIAL_COVERAGE_SKIP_REASON,
  SELECTION_REPORT_ENV,
  affectedTestsSettings,
  changedFileCoverage,
  coverageDeclaredAtPush,
  coverageEscalationLines,
  excludedBy,
  explainSelection,
  fullSuiteEscalation,
  measuresCoverage,
  narrowable,
  partialArgv,
  recordedTriggers,
  selectAffectedTests,
  staleMapReason,
} from "./lib/affected-tests.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import { withPushGateDefaults } from "./lib/push-gate-defaults.mjs";

/** Where the map lives, relative to the repository root (gitignored). */
export const MAP_DIR = ".lisa/test-access-map";

/** Who speaks in this selector's lines. */
const SUBJECT = "affected tests";

/** The coverage mode that holds each changed file to the floor. */
const CHANGED_FILES = "changed-files";

/** How long a failed download is remembered before it is tried again. */
const MISS_TTL_MS = 15 * 60_000;

/** How long a map download may take before the push stops waiting for it. */
const FETCH_TIMEOUT_MS = 60_000;

/** Git's location variables, which a hook exports to its children. */
const GIT_LOCATION_ENV = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
]);

/**
 * Narrow only when the push gate runner asked for it.
 *
 * A host's shared `test:cov:unit` script carries the selector
 * (CodySwannGT/lisa#4611), and a developer who runs that script by hand
 * expects every test. With this flag the command runs unchanged unless the
 * gate runner set `LISA_SELECTION_REPORT`, which it does only at push (and
 * for `lisa check`, which runs the push gates ahead of the push).
 */
export const PUSH_ONLY_FLAG = "--push-only";

/**
 * Split `[--fetch <script>] [--push-only] -- <command…>`.
 * @param {ReadonlyArray<string>} argv Arguments after the script.
 * @returns {{fetch: string|undefined, pushOnly: boolean, command: string[]}} Parsed options.
 */
export function parseArgs(argv) {
  const separator = argv.indexOf("--");
  const own = separator === -1 ? [] : argv.slice(0, separator);
  const command = separator === -1 ? [] : argv.slice(separator + 1);
  const at = own.indexOf("--fetch");
  return {
    fetch: at === -1 ? undefined : own[at + 1],
    pushOnly: own.includes(PUSH_ONLY_FLAG),
    command,
  };
}

/**
 * Run git in `root`, without the location variables a hook exports.
 * @param {string} root Repository root.
 * @param {string[]} args Git arguments.
 * @returns {string|null} Trimmed stdout, or null when git fails.
 */
function git(root, args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !GIT_LOCATION_ENV.has(key))
  );
  const child = spawnSync("git", args, {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return child.status === 0 ? child.stdout.trim() : null;
}

/**
 * Parse a JSON file, or undefined when it is missing or unreadable.
 * @param {string} file Path.
 * @returns {any} Parsed value.
 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * The commit this branch left the default branch at.
 * @param {string} root Repository root.
 * @param {NodeJS.ProcessEnv} env Environment (`LISA_AFFECTED_BASE_REF` overrides).
 * @returns {{sha: string, ref: string}|null} The merge-base, or null.
 */
function mergeBaseOf(root, env) {
  const symbolic = git(root, [
    "symbolic-ref",
    "--quiet",
    "refs/remotes/origin/HEAD",
  ]);
  const ref =
    env.LISA_AFFECTED_BASE_REF ||
    (symbolic ? symbolic.replace(/^refs\/remotes\//, "") : "origin/main");
  const sha = git(root, ["merge-base", "HEAD", ref]);
  return sha ? { sha, ref } : null;
}

/**
 * Files that differ between the merge-base and the working tree.
 * @param {string} root Repository root.
 * @param {string} base Merge-base.
 * @returns {Array<{path: string, status: "added"|"modified"|"deleted"}>|null} Changes, or null.
 */
function changedFiles(root, base) {
  const tracked = git(root, ["diff", "--name-status", "--no-renames", base]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]);
  if (tracked === null || untracked === null) return null;
  const status = letter =>
    letter === "A" ? "added" : letter === "D" ? "deleted" : "modified";
  const entries = tracked
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const [letter, ...rest] = line.split("\t");
      return { path: rest.join("\t"), status: status(letter[0]) };
    });
  const seen = new Set(entries.map(entry => entry.path));
  const added = untracked
    .split("\n")
    .filter(file => file && !seen.has(file))
    .map(file => ({ path: file, status: "added" }));
  return [...entries, ...added];
}

/**
 * Make sure a map for `base` is on disk, downloading it when needed.
 *
 * A map already downloaded for this exact base is reused without asking the
 * network. A download that found nothing is remembered for a few minutes so
 * a run of pushes does not pay for it each time.
 * @param {object} input Inputs.
 * @param {string} input.root Repository root.
 * @param {string} input.base Merge-base.
 * @param {string|undefined} input.fetch The download script.
 * @param {(line: string) => void} input.out Output.
 * @param {() => Date} input.now Clock.
 * @returns {void}
 */
function ensureMap({ root, base, fetch, out, now }) {
  const dir = join(root, MAP_DIR);
  if (readJson(join(dir, "meta.json"))?.requestedBase === base) return;
  if (!fetch || !existsSync(join(root, fetch))) return;
  const missFile = join(dir, "miss.json");
  const miss = readJson(missFile);
  if (
    miss?.requestedBase === base &&
    now().getTime() - Date.parse(miss.at) < MISS_TTL_MS
  ) {
    return;
  }
  out(
    `🎯 affected tests: downloading the test access map for ${base.slice(0, 12)}…`
  );
  const child = spawnSync(
    process.execPath,
    [join(root, fetch), "--base", base, "--out", dir],
    { cwd: root, encoding: "utf8", timeout: FETCH_TIMEOUT_MS }
  );
  if (child.status === 0) return;
  const why =
    child.error?.code === "ETIMEDOUT"
      ? `it took longer than ${FETCH_TIMEOUT_MS / 1000}s`
      : (child.stderr || "").trim().split("\n").at(-1) || "it failed";
  out(`   No new map: ${why}.`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    missFile,
    `${JSON.stringify({ requestedBase: base, at: now().toISOString() })}\n`
  );
}

/**
 * Read the map, or say why it cannot be used.
 * @param {object} input Inputs.
 * @param {string} input.root Repository root.
 * @param {string} input.base Merge-base.
 * @param {NodeJS.ProcessEnv} input.env Environment.
 * @param {() => Date} input.now Clock.
 * @returns {{map: Record<string, string[]>, meta: Record<string, any>}|{problem: string}} The map.
 */
function loadMap({ root, base, env, now }) {
  const dir = join(root, MAP_DIR);
  const meta = readJson(join(dir, "meta.json"));
  if (meta === undefined) {
    return {
      problem:
        "missing map: no test access map is available for this branch's base",
    };
  }
  const configured = Number(env[MAX_AGE_ENV]);
  const maxAgeDays =
    env[MAX_AGE_ENV] !== undefined &&
    env[MAX_AGE_ENV] !== "" &&
    Number.isFinite(configured)
      ? configured
      : DEFAULT_MAX_AGE_DAYS;
  const stale = staleMapReason({
    meta,
    mergeBase: base,
    isAncestor: (a, b) =>
      git(root, ["merge-base", "--is-ancestor", a, b]) !== null,
    now: now(),
    maxAgeDays,
  });
  if (stale) return { problem: stale };
  const map = readJson(join(dir, "map.json"));
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    return {
      problem: "missing map: the downloaded map file could not be read",
    };
  }
  return { map, meta };
}

/**
 * The project's coverage floors, from `vitest.thresholds.json`'s `global`.
 * @param {string} root Repository root.
 * @returns {Record<string, number>|null} Floors, or null when there are none.
 */
function thresholdsOf(root) {
  const floors = readJson(join(root, "vitest.thresholds.json"))?.global;
  return floors && typeof floors === "object" ? floors : null;
}

/**
 * Decide what to run.
 * @param {object} input Inputs.
 * @param {string} input.root Repository root.
 * @param {string[]} input.command The full command.
 * @param {string|undefined} input.fetch The download script.
 * @param {Record<string, any>} input.config Parsed `.lisa.config.json`.
 * @param {"full"|"changed-files"|"skip"} input.mode Coverage mode.
 * @param {NodeJS.ProcessEnv} input.env Environment.
 * @param {(line: string) => void} input.out Output.
 * @param {() => Date} input.now Clock.
 * @returns {{selection: import("./lib/affected-tests.mjs").Selection, coverage: "measured"|"changed-files"|"skip"|"none"}} The plan.
 */
export function plan({ root, command, fetch, config, mode, env, out, now }) {
  const coverageWanted = measuresCoverage(command);
  const fullRun = reason => ({
    selection: { kind: "full", reason, tests: [], related: [], unread: [] },
    coverage: coverageWanted ? "measured" : "none",
  });
  if (env.CI || env.GITHUB_ACTIONS) {
    return fullRun("this is a CI run, and CI always runs every test");
  }
  if (!narrowable(command)) {
    return fullRun(
      "the test command is not a `vitest run`, so it cannot be narrowed"
    );
  }
  const declared = coverageDeclaredAtPush(config.gates) && coverageWanted;
  if (declared && mode === "full") {
    return fullRun(
      'coverage-adequacy is checked at push and needs every test, because pushGate.affectedCoverage is "full"'
    );
  }
  if (declared && mode === CHANGED_FILES && !thresholdsOf(root)) {
    return fullRun(
      "there is no vitest.thresholds.json to hold the changed files to"
    );
  }
  const base = mergeBaseOf(root, env);
  if (!base) {
    return fullRun("could not find where this branch left the default branch");
  }
  const changed = changedFiles(root, base.sha);
  if (!changed) return fullRun("could not list the changed files");
  if (changed.length === 0) {
    return fullRun(
      `nothing differs from ${base.ref}, so there is no change to narrow to`
    );
  }
  ensureMap({ root, base: base.sha, fetch, out, now });
  const loaded = loadMap({ root, base: base.sha, env, now });
  if ("problem" in loaded) return fullRun(loaded.problem);
  const atMapBase = new Set(
    (git(root, ["ls-tree", "-r", "--name-only", loaded.meta.baseSha]) ?? "")
      .split("\n")
      .filter(Boolean)
  );
  const selection = selectAffectedTests({
    changed: changed.map(entry => ({
      ...entry,
      existedAtMapBase: atMapBase.has(entry.path),
    })),
    map: loaded.map,
    excluded: excludedBy(command),
    exists: file => existsSync(join(root, file)),
    triggers: recordedTriggers(loaded.meta),
  });
  if (selection.kind === "full") {
    return { selection, coverage: coverageWanted ? "measured" : "none" };
  }
  if (!declared) return { selection, coverage: "none" };
  if (
    mode === CHANGED_FILES &&
    selection.tests.length === 0 &&
    selection.related.length > 0
  ) {
    return fullRun(
      "no test reaches the changed source files, so their coverage can only be measured by the full suite"
    );
  }
  return { selection, coverage: mode };
}

/** What each coverage outcome means, for the explanation. */
const COVERAGE_NOTE = Object.freeze({
  measured: "measured over the full suite, as before",
  none: "not measured at push (coverage-adequacy is not checked at push)",
  [CHANGED_FILES]:
    "each changed source file is held to vitest.thresholds.json on its own; one below it sends the push to the full suite",
  skip: `not measured; coverage-adequacy reports SKIPPED (${PARTIAL_COVERAGE_SKIP_REASON})`,
});

/**
 * Run a command with inherited output and return its exit code.
 * @param {string[]} argv Command.
 * @param {string} cwd Working directory.
 * @returns {number} Exit code (1 for a signal or a spawn failure).
 */
function run(argv, cwd) {
  const child = spawnSync(argv[0], argv.slice(1), { cwd, stdio: "inherit" });
  return typeof child.status === "number" ? child.status : 1;
}

/**
 * The CLI.
 * @param {string[]} argv Arguments after the script.
 * @param {object} [deps] Effects, injectable for tests.
 * @param {NodeJS.ProcessEnv} [deps.env] Environment.
 * @param {string} [deps.cwd] Working directory.
 * @param {(line: string) => void} [deps.out] Output.
 * @param {() => Date} [deps.now] Clock.
 * @returns {number} Exit code.
 */
export function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const out = deps.out ?? (line => console.log(line));
  const now = deps.now ?? (() => new Date());
  const { fetch, pushOnly, command } = parseArgs(argv);
  if (command.length === 0) {
    console.error(
      "usage: lisa-affected-tests.mjs [--fetch <script>] [--push-only] -- <test command…>"
    );
    return 2;
  }
  const cwd = deps.cwd ?? process.cwd();
  if (pushOnly && !env[SELECTION_REPORT_ENV]) return run(command, cwd);
  const root = git(cwd, ["rev-parse", "--show-toplevel"]) ?? cwd;
  // The stack's defaults under the project's own keys (CodySwannGT/lisa#4611).
  const config = withPushGateDefaults(
    readJson(join(root, ".lisa.config.json")) ?? {},
    root
  );
  let settings;
  try {
    settings = affectedTestsSettings(config);
  } catch (error) {
    console.error(
      `🚫 affected tests: ${error.message} Fix pushGate in .lisa.config.json. Nothing ran.`
    );
    return 2;
  }
  if (!settings.enabled) return run(command, cwd);

  const chosen = plan({
    root,
    command,
    fetch,
    config,
    mode: settings.coverage,
    env,
    out,
    now,
  });
  const { selection, coverage } = chosen;
  if (env[SELECTION_REPORT_ENV]) {
    try {
      writeFileSync(
        env[SELECTION_REPORT_ENV],
        `${JSON.stringify({ selection: selection.kind, reason: selection.reason ?? null, coverage, tests: selection.tests.length })}\n`
      );
    } catch {
      // Without the report the runner reads nothing and reports as before.
    }
  }
  for (const line of explainSelection(selection, COVERAGE_NOTE[coverage]))
    out(line);
  if (selection.kind === "full") return run(command, cwd);
  if (selection.tests.length === 0) {
    out(
      "   No unit test can reach the changed files, so there is nothing to run."
    );
    return 0;
  }

  const coverageDir =
    coverage === CHANGED_FILES
      ? mkdtempSync(join(tmpdir(), "lisa-affected-coverage-"))
      : undefined;
  let escalation;
  try {
    const code = run(
      partialArgv({
        argv: command,
        selection,
        coverage: coverage === CHANGED_FILES ? "on" : "off",
        coverageDir,
      }),
      cwd
    );
    if (code !== 0 || coverage !== CHANGED_FILES) return code;
    escalation = checkChangedFiles({ root, coverageDir, selection, out });
  } finally {
    if (coverageDir) rmSync(coverageDir, { recursive: true, force: true });
  }
  if (escalation.length === 0) return 0;
  return escalate({ lines: escalation, command, cwd, env, out });
}

/**
 * Run the full command, as `full` mode does, after a partial run could not
 * clear the changed files (CodySwannGT/lisa#4600: a push is never stricter
 * than whole-repo coverage). Its verdict is the push's, and the report says
 * a full run produced it, so the gate runner may remember the pass.
 * @param {object} input Inputs.
 * @param {string[]} input.lines Why, one line per reason.
 * @param {string[]} input.command The full command.
 * @param {string} input.cwd Working directory.
 * @param {NodeJS.ProcessEnv} input.env Environment.
 * @param {(line: string) => void} input.out Output.
 * @returns {number} The full run's exit code.
 */
function escalate({ lines, command, cwd, env, out }) {
  for (const line of lines) out(line);
  if (env[SELECTION_REPORT_ENV]) {
    try {
      writeFileSync(
        env[SELECTION_REPORT_ENV],
        `${JSON.stringify({ selection: "full", reason: lines.join(" "), coverage: "measured", tests: 0, escalated: true })}\n`
      );
    } catch {
      // Without the report the runner reads nothing and reports as before.
    }
  }
  return run(command, cwd);
}

/**
 * Hold each changed source file to the thresholds after a coverage-on run.
 * @param {object} input Inputs.
 * @param {string} input.root Repository root.
 * @param {string} input.coverageDir Where the run wrote `coverage-summary.json`.
 * @param {import("./lib/affected-tests.mjs").Selection} input.selection The selection.
 * @param {(line: string) => void} input.out Output.
 * @returns {string[]} Escalation lines; empty when every changed file meets its floor.
 */
function checkChangedFiles({ root, coverageDir, selection, out }) {
  const summary = readJson(join(coverageDir, "coverage-summary.json"));
  if (!summary) {
    return [
      fullSuiteEscalation(SUBJECT, "the partial run wrote no coverage summary"),
    ];
  }
  const verdict = changedFileCoverage({
    summary,
    root,
    files: selection.related,
    thresholds: thresholdsOf(root) ?? {},
  });
  if (verdict.shortfalls.length > 0) {
    return coverageEscalationLines({
      subject: SUBJECT,
      files: selection.related,
      shortfalls: verdict.shortfalls,
    });
  }
  const outside = verdict.unmeasured.length
    ? `; ${verdict.unmeasured.length} are outside coverage`
    : "";
  out(
    `✅ affected tests: ${verdict.measured.length} changed source file(s) meet the coverage floor${outside}`
  );
  return [];
}

if (invokedAsScript(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
