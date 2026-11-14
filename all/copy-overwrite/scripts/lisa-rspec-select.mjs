#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Run RSpec at push, narrowed to the specs a change can reach
 * (CodySwannGT/lisa#4612). The decisions are in `lib/rspec-selection.mjs`;
 * this file gathers their inputs (git, `.lisa.config.json`, the Crystalball
 * map CI recorded) and runs RSpec.
 *
 * Usage:
 *   node scripts/lisa-rspec-select.mjs [--no-fetch] -- <full rspec command…>
 *   node scripts/lisa-rspec-select.mjs merge-maps --out <file> <map.json…>
 *
 * The command after `--` is the FULL command (`bundle exec rspec`), exactly as
 * the pre-push ran it before. With selection off it runs unchanged and this
 * prints nothing. With it on, it runs unchanged whenever a full-suite reason
 * holds (the reason is printed), or with the selected spec files appended
 * otherwise.
 *
 * The map for the branch's merge-base is downloaded with `gh` from the
 * repository's `crystalball-map-<base sha>-<run id>[-<leg>]` artifacts, which
 * `quality-rails.yml` uploads from its full RSpec run. Without `gh`, or when
 * the download fails or takes too long, a map already on disk is used if it
 * is still valid for this branch; otherwise the full suite runs.
 * `--no-fetch` uses only the map on disk.
 * @module lisa-rspec-select
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
  staleMapReason,
} from "./lib/affected-tests.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  MAP_DIR,
  SPEC_FILE,
  THRESHOLDS_FILE,
  alwaysRunSpecs,
  changedRubyCoverage,
  chooseMapRun,
  explainRspecSelection,
  fullSuite,
  isRailsProject,
  mergeMapDocuments,
  parseMapArtifacts,
  railsCoverageEscalation,
  railsFullSuiteEscalation,
  rspecSelectionSettings,
  selectRailsSpecs,
} from "./lib/rspec-selection.mjs";

/** The Ruby file that moves a partial run's coverage out of SimpleCov's minimums. */
export const PARTIAL_COVERAGE_HELPER = "scripts/lisa_rspec_partial_coverage.rb";

/** The coverage mode that holds each changed Ruby file to the floor. */
const CHANGED_FILES = "changed-files";

/** How long a failed download is remembered before it is tried again. */
const MISS_TTL_MS = 15 * 60_000;

/** How long the whole map download may take before the push stops waiting. */
const FETCH_BUDGET_MS = 60_000;

/** Artifact listing pages read, newest first, before giving up. */
const MAX_PAGES = 5;

/** Artifacts per listing page. */
const PAGE_SIZE = 100;

/** The fields read from each listed artifact. */
const LISTING_JQ =
  ".artifacts[] | {name, runId: .workflow_run.id, createdAt: .created_at, expired}";

/** The git subcommand that finds a branch point or proves ancestry. */
const MERGE_BASE = "merge-base";

/** The saved map, under {@link MAP_DIR}. */
const MAP_FILE = "map.json";

/** The saved map's metadata, under {@link MAP_DIR}. */
const META_FILE = "meta.json";

/** Git's location variables, which a hook exports to its children. */
const GIT_LOCATION_ENV = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
]);

/**
 * Run a command and return its result, without git's hook location variables.
 * @param {string} command Executable.
 * @param {string[]} args Arguments.
 * @param {object} options Options.
 * @param {string} options.cwd Working directory.
 * @param {number} [options.timeout] Milliseconds.
 * @returns {{status: number|null, stdout: string, stderr: string, error?: Error}} Result.
 */
function exec(command, args, { cwd, timeout }) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !GIT_LOCATION_ENV.has(key))
  );
  const child = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: child.status,
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? "",
    error: child.error,
  };
}

/**
 * Run git in `root`.
 * @param {string} root Repository root.
 * @param {string[]} args Git arguments.
 * @returns {string|null} Trimmed stdout, or null when git fails.
 */
function git(root, args) {
  const child = exec("git", args, { cwd: root });
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
  const sha = git(root, [MERGE_BASE, "HEAD", ref]);
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
 * Every `*_spec.rb` under `spec/`, repository-relative.
 * @param {string} root Repository root.
 * @returns {string[]} Spec files, sorted.
 */
function specFilesIn(root) {
  const walk = dir => {
    let entries;
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.flatMap(entry => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return walk(path);
      return SPEC_FILE.test(path) ? [path] : [];
    });
  };
  return walk("spec").sort();
}

/**
 * Every `.json` file under a directory, recursively.
 * @param {string} dir Directory.
 * @returns {string[]} Paths.
 */
function jsonFilesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return jsonFilesUnder(path);
    return entry.name.endsWith(".json") ? [path] : [];
  });
}

/**
 * Merge map documents and save `map.json` and `meta.json` into `out`.
 * @param {object} input Inputs.
 * @param {any[]} input.documents Parsed map documents.
 * @param {string} input.out Directory.
 * @param {Record<string, unknown>} input.meta Extra metadata.
 * @returns {boolean} False when there was no map to save.
 */
function saveMap({ documents, out, meta }) {
  const merged = mergeMapDocuments(documents);
  if (merged.metas.length === 0) return false;
  const createdAt =
    merged.metas
      .map(entry => String(entry.createdAt ?? ""))
      .filter(Boolean)
      .sort()[0] ?? "";
  const baseSha =
    merged.metas.map(entry => entry.baseSha).find(Boolean) ?? meta.baseSha;
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, MAP_FILE),
    `${JSON.stringify({ map: merged.map, alwaysRun: merged.alwaysRun }, null, 2)}\n`
  );
  writeFileSync(
    join(out, META_FILE),
    `${JSON.stringify(
      {
        ...meta,
        baseSha,
        createdAt,
        specFiles: Object.keys(merged.map).length,
      },
      null,
      2
    )}\n`
  );
  return true;
}

/**
 * Download the newest map for `base` (or its nearest ancestor) with `gh`.
 * @param {object} input Inputs.
 * @param {string} input.root Repository root.
 * @param {string} input.base Merge-base.
 * @param {string} input.dir Where the map lives.
 * @param {() => number} input.remaining Milliseconds left in the budget.
 * @returns {string|null} Why there is no map, or null on success.
 */
function downloadMap({ root, base, dir, remaining }) {
  const call = args => {
    const left = remaining();
    if (left <= 0) return { status: null, stdout: "", stderr: "out of time" };
    return exec("gh", args, { cwd: root, timeout: left });
  };
  const distance = baseSha => {
    if (baseSha === base) return 0;
    if (git(root, [MERGE_BASE, "--is-ancestor", baseSha, base]) === null) {
      return undefined;
    }
    const count = Number(
      git(root, ["rev-list", "--count", `${baseSha}..${base}`])
    );
    return Number.isFinite(count) ? count : undefined;
  };
  const seen = [];
  let choice;
  for (let page = 1; page <= MAX_PAGES && !choice; page += 1) {
    const listing = call([
      "api",
      `repos/{owner}/{repo}/actions/artifacts?per_page=${PAGE_SIZE}&page=${page}`,
      "--jq",
      LISTING_JQ,
    ]);
    if (listing.status !== 0) {
      return listing.error?.code === "ENOENT"
        ? "the GitHub CLI (gh) is not installed"
        : `could not list artifacts: ${(listing.stderr || "gh failed").trim().split("\n").at(-1)}`;
    }
    seen.push(...parseMapArtifacts(listing.stdout));
    choice = chooseMapRun(seen, distance);
    if (listing.stdout.split("\n").filter(Boolean).length < PAGE_SIZE) break;
  }
  if (!choice)
    return `no crystalball map for ${base.slice(0, 12)} or an ancestor of it`;
  const download = mkdtempSync(join(tmpdir(), "lisa-crystalball-map-"));
  try {
    const fetched = call([
      "run",
      "download",
      choice.runId,
      ...choice.names.flatMap(name => ["--name", name]),
      "--dir",
      download,
    ]);
    if (fetched.status !== 0) {
      return `could not download run ${choice.runId}'s map: ${(fetched.stderr || "gh failed").trim().split("\n").at(-1)}`;
    }
    const documents = jsonFilesUnder(download).map(readJson);
    const saved = saveMap({
      documents,
      out: dir,
      meta: {
        requestedBase: base,
        baseSha: choice.baseSha,
        commitsBehind: choice.distance,
        runId: choice.runId,
        artifacts: choice.names,
      },
    });
    return saved ? null : `run ${choice.runId}'s artifacts held no map`;
  } finally {
    rmSync(download, { recursive: true, force: true });
  }
}

/**
 * Make sure a map for `base` is on disk, downloading it when needed.
 * @param {object} input Inputs.
 * @param {string} input.root Repository root.
 * @param {string} input.base Merge-base.
 * @param {boolean} input.fetch Whether downloading is allowed.
 * @param {(line: string) => void} input.out Output.
 * @param {() => Date} input.now Clock.
 * @returns {void}
 */
function ensureMap({ root, base, fetch, out, now }) {
  const dir = join(root, MAP_DIR);
  if (readJson(join(dir, META_FILE))?.requestedBase === base) return;
  if (!fetch) return;
  const missFile = join(dir, "miss.json");
  const miss = readJson(missFile);
  if (
    miss?.requestedBase === base &&
    now().getTime() - Date.parse(miss.at) < MISS_TTL_MS
  ) {
    return;
  }
  out(
    `🎯 affected specs: downloading the crystalball map for ${base.slice(0, 12)}…`
  );
  const started = Date.now();
  const why = downloadMap({
    root,
    base,
    dir,
    remaining: () => FETCH_BUDGET_MS - (Date.now() - started),
  });
  if (why === null) return;
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
 * @returns {{map: Record<string, string[]>, alwaysRun: string[], meta: Record<string, any>}|{problem: string}} The map.
 */
function loadMap({ root, base, env, now }) {
  const dir = join(root, MAP_DIR);
  const meta = readJson(join(dir, META_FILE));
  if (meta === undefined) {
    return {
      problem:
        "missing map: no crystalball map is available for this branch's base",
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
      git(root, [MERGE_BASE, "--is-ancestor", a, b]) !== null,
    now: now(),
    maxAgeDays,
  });
  if (stale) return { problem: stale };
  const saved = readJson(join(dir, MAP_FILE));
  const map = saved?.map;
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    return {
      problem: "missing map: the downloaded map file could not be read",
    };
  }
  return {
    map,
    alwaysRun: Array.isArray(saved.alwaysRun) ? saved.alwaysRun : [],
    meta,
  };
}

/**
 * The project's coverage floors from `simplecov.thresholds.json`.
 * @param {string} root Repository root.
 * @returns {{line?: number, branch?: number}|null} Floors, or null when there are none.
 */
function thresholdsOf(root) {
  const floors = readJson(join(root, THRESHOLDS_FILE));
  if (!floors || typeof floors !== "object") return null;
  const picked = Object.fromEntries(
    ["line", "branch"]
      .filter(metric => typeof floors[metric] === "number")
      .map(metric => [metric, floors[metric]])
  );
  return Object.keys(picked).length ? picked : null;
}

/**
 * @typedef {object} RspecPlan
 * @property {"full"|"partial"} kind Which run to do.
 * @property {string|null} reason Why the full suite runs.
 * @property {string[]} specs Spec files a partial run passes to RSpec.
 * @property {"changed-files"|"skip"|"none"} coverage What a partial run does about coverage.
 * @property {string[]} lines The plain-language explanation to print.
 * @property {string[]} changedRuby Changed Ruby files outside spec/ (for the coverage check).
 * @property {import("./lib/rspec-selection.mjs").RspecSelection} selection The selection.
 */

/** What each coverage outcome means, for the explanation. */
const COVERAGE_NOTE = Object.freeze({
  full: "measured over the full suite, as before",
  [CHANGED_FILES]: `each changed Ruby file is held to ${THRESHOLDS_FILE} on its own; one below it sends the push to the full suite`,
  skip: `not measured at push (${PARTIAL_COVERAGE_SKIP_REASON})`,
  none: "not measured at push (selection is off)",
});

/**
 * Decide what the push-time RSpec run does. Exported for the Rails gate
 * runner (CodySwannGT/lisa#4613), which may call it instead of this CLI.
 * @param {object} input Inputs.
 * @param {string} input.cwd Working directory.
 * @param {NodeJS.ProcessEnv} input.env Environment.
 * @param {boolean} [input.fetch] Whether the map may be downloaded (default true).
 * @param {(line: string) => void} [input.out] Progress output.
 * @param {() => Date} [input.now] Clock.
 * @returns {RspecPlan} The plan.
 * @throws {Error} When `pushGate` in `.lisa.config.json` is invalid.
 */
export function planRspecRun({
  cwd,
  env,
  fetch = true,
  out = () => {},
  now = () => new Date(),
}) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]) ?? cwd;
  const config = readJson(join(root, ".lisa.config.json")) ?? {};
  const exists = file => existsSync(join(root, file));
  const settings = rspecSelectionSettings(config, isRailsProject(exists));
  const finish = (selection, coverage, changedRuby = []) => {
    const full = selection.kind === "full";
    return {
      kind: selection.kind,
      reason: selection.reason,
      specs: full ? [] : selection.specs.map(spec => spec.file),
      coverage: full ? "none" : coverage,
      lines: settings.enabled
        ? explainRspecSelection(
            selection,
            COVERAGE_NOTE[full ? "full" : coverage]
          )
        : [],
      changedRuby,
      selection,
    };
  };
  const fullRun = reason => finish(fullSuite(reason), "none");
  if (!settings.enabled) return fullRun("pushGate.affectedTests is false");
  if (env.CI || env.GITHUB_ACTIONS) {
    return fullRun("this is a CI run, and CI always runs every spec");
  }
  if (settings.coverage === "full") {
    return fullRun(
      'pushGate.affectedCoverage is "full", so coverage is measured over every spec'
    );
  }
  if (!exists(PARTIAL_COVERAGE_HELPER)) {
    return fullRun(
      `${PARTIAL_COVERAGE_HELPER} is not installed, so a partial run cannot keep the project's coverage minimums off the slice (run lisa to install it)`
    );
  }
  if (settings.coverage === CHANGED_FILES && !thresholdsOf(root)) {
    return fullRun(
      `there is no ${THRESHOLDS_FILE} with line or branch floors to hold the changed files to`
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
  const specFiles = specFilesIn(root);
  const selection = selectRailsSpecs({
    changed,
    map: loaded.map,
    alwaysRun: alwaysRunSpecs({
      specFiles,
      recorded: loaded.alwaysRun,
      read: file => readFileSync(join(root, file), "utf8"),
    }),
    exists,
    coverage: settings.coverage,
  });
  const changedRuby = changed
    .filter(
      entry =>
        entry.status !== "deleted" &&
        entry.path.endsWith(".rb") &&
        !entry.path.startsWith("spec/") &&
        exists(entry.path)
    )
    .map(entry => entry.path);
  return finish(selection, settings.coverage, changedRuby);
}

/**
 * The RSpec command for a plan: unchanged for a full run; for a partial run
 * the coverage hand-off is required and the selected specs are appended.
 * @param {object} input Inputs.
 * @param {RspecPlan} input.plan The plan.
 * @param {ReadonlyArray<string>} [input.command] The full RSpec command.
 * @returns {string[]} The command to run.
 */
export function rspecArgv({ plan, command = ["bundle", "exec", "rspec"] }) {
  if (plan.kind === "full") return [...command];
  return [
    ...command,
    "--require",
    `./${PARTIAL_COVERAGE_HELPER}`,
    ...plan.specs,
  ];
}

/**
 * Run a command with inherited output and return its exit code.
 * @param {string[]} argv Command.
 * @param {string} cwd Working directory.
 * @param {NodeJS.ProcessEnv} [env] Environment.
 * @returns {number} Exit code (1 for a signal or a spawn failure).
 */
function run(argv, cwd, env = process.env) {
  const child = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env,
    stdio: "inherit",
  });
  return typeof child.status === "number" ? child.status : 1;
}

/**
 * Hold each changed Ruby file to the floors after a partial run.
 *
 * A push is never stricter than whole-repo coverage (CodySwannGT/lisa#4600):
 * a file below its floor, a hand-off that could not keep the project's
 * minimums off the slice, or a run that left no resultset returns escalation
 * lines instead of failing, and the caller runs the full suite.
 * @param {object} input Inputs.
 * @param {string} input.root Repository root.
 * @param {string} input.coverageDir Where the hand-off wrote its status and resultset.
 * @param {RspecPlan} input.plan The plan.
 * @param {(line: string) => void} input.out Output.
 * @returns {string[]} Escalation lines; empty when the partial run decides the push.
 */
function checkChangedFiles({ root, coverageDir, plan, out }) {
  const status = readJson(join(coverageDir, "status.json"));
  if (status?.measuring === false) {
    out(
      "   Coverage: SimpleCov was not measuring this run, so there was no coverage to check."
    );
    return [];
  }
  if (typeof status?.escalate === "string") {
    return [railsFullSuiteEscalation(status.escalate)];
  }
  const resultset = readJson(join(coverageDir, ".resultset.json"));
  if (!status || !resultset) {
    return [
      railsFullSuiteEscalation("the partial run left no SimpleCov resultset"),
    ];
  }
  const verdict = changedRubyCoverage({
    resultset,
    root,
    files: plan.changedRuby,
    thresholds: thresholdsOf(root) ?? {},
    read: file => readFileSync(join(root, file), "utf8"),
  });
  if (verdict.shortfalls.length > 0) {
    return railsCoverageEscalation({
      files: plan.changedRuby,
      shortfalls: verdict.shortfalls,
    });
  }
  const outside = verdict.unmeasured.length
    ? `; ${verdict.unmeasured.length} are outside coverage`
    : "";
  out(
    `✅ affected specs: ${verdict.measured.length} changed Ruby file(s) meet the coverage floor${outside}`
  );
  return [];
}

/**
 * Whether the hand-off asked for the full suite because it could not run the
 * slice safely: its verdict replaces the slice's exit code, which then only
 * says the hand-off stopped the run.
 * @param {string} coverageDir Where the hand-off wrote its status.
 * @returns {boolean} True when the hand-off escalated.
 */
function handOffEscalated(coverageDir) {
  return (
    typeof readJson(join(coverageDir, "status.json"))?.escalate === "string"
  );
}

/**
 * `merge-maps --out <file> <map.json…>`: merge CI legs' maps into one file.
 * @param {string[]} argv Arguments after `merge-maps`.
 * @returns {number} Exit code.
 */
function mergeMapsCli(argv) {
  const at = argv.indexOf("--out");
  const target = at === -1 ? undefined : argv[at + 1];
  const inputs = argv.filter((_, index) => index !== at && index !== at + 1);
  if (!target || inputs.length === 0) {
    console.error(
      "usage: lisa-rspec-select.mjs merge-maps --out <file> <map.json…>"
    );
    return 2;
  }
  const merged = mergeMapDocuments(inputs.map(readJson));
  if (merged.metas.length === 0) {
    console.error("lisa-rspec-select: none of the inputs is a crystalball map");
    return 1;
  }
  const meta = { ...merged.metas[0] };
  meta.createdAt =
    merged.metas
      .map(entry => String(entry.createdAt ?? ""))
      .filter(Boolean)
      .sort()[0] ?? meta.createdAt;
  meta.legs = merged.metas.map(entry => entry.job ?? "");
  writeFileSync(
    target,
    `${JSON.stringify({ meta, map: merged.map, alwaysRun: merged.alwaysRun }, null, 2)}\n`
  );
  console.log(
    `crystalball map: merged ${merged.metas.length} leg(s), ${Object.keys(merged.map).length} spec file(s) -> ${target}`
  );
  return 0;
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
  if (argv[0] === "merge-maps") return mergeMapsCli(argv.slice(1));
  const env = deps.env ?? process.env;
  const out = deps.out ?? (line => console.log(line));
  const now = deps.now ?? (() => new Date());
  const separator = argv.indexOf("--");
  const own = separator === -1 ? [] : argv.slice(0, separator);
  const command = separator === -1 ? [] : argv.slice(separator + 1);
  if (command.length === 0) {
    console.error(
      "usage: lisa-rspec-select.mjs [--no-fetch] -- <rspec command…>"
    );
    return 2;
  }
  const cwd = deps.cwd ?? process.cwd();
  let plan;
  try {
    plan = planRspecRun({
      cwd,
      env,
      fetch: !own.includes("--no-fetch"),
      out,
      now,
    });
  } catch (error) {
    console.error(
      `🚫 affected specs: ${error.message} Fix pushGate in .lisa.config.json. Nothing ran.`
    );
    return 2;
  }
  if (env[SELECTION_REPORT_ENV] && plan.lines.length > 0) {
    try {
      writeFileSync(
        env[SELECTION_REPORT_ENV],
        `${JSON.stringify({ selection: plan.kind, reason: plan.reason, coverage: plan.coverage, tests: plan.specs.length })}\n`
      );
    } catch {
      // Without the report the runner reads nothing and reports as before.
    }
  }
  for (const line of plan.lines) out(line);
  return runRspecPlan({ plan, command, cwd, env, out });
}

/**
 * Run a plan from {@link planRspecRun}: the full command unchanged, or the
 * partial command with the coverage hand-off and, in `changed-files` mode,
 * the per-file coverage check. Exported for the Rails gate runner
 * (CodySwannGT/lisa#4613): a caller that runs a partial plan's specs any
 * other way leaves SimpleCov's project minimums armed against the slice and
 * skips the changed-file check.
 *
 * When the partial run cannot clear every changed file, the push escalates to
 * the full suite with whole-repo coverage (CodySwannGT/lisa#4600: a push is
 * never stricter than whole-repo coverage) and that run's exit code is the
 * verdict. `runFull` is how the caller runs its full suite, so the gate runner
 * can keep its parallel run for the escalation.
 * @param {object} input Inputs.
 * @param {RspecPlan} input.plan The plan.
 * @param {ReadonlyArray<string>} [input.command] The full RSpec command.
 * @param {string} input.cwd Working directory.
 * @param {NodeJS.ProcessEnv} [input.env] Environment.
 * @param {(line: string) => void} [input.out] Output.
 * @param {() => number} [input.runFull] Runs the full suite (default: `command` unchanged).
 * @returns {number} Exit code.
 */
export function runRspecPlan({
  plan,
  command = ["bundle", "exec", "rspec"],
  cwd,
  env = process.env,
  out = line => console.log(line),
  runFull = () => run([...command], cwd, env),
}) {
  if (plan.kind === "full") return runFull();
  const unmeasured =
    plan.specs.length === 0 && plan.coverage === CHANGED_FILES
      ? (plan.changedRuby ?? [])
      : [];
  if (plan.specs.length === 0 && unmeasured.length === 0) {
    out("   No spec can reach the changed files, so there is nothing to run.");
    return 0;
  }
  // No spec selected, but changed Ruby files are owed a coverage check: with
  // nothing run there is nothing to measure them by, and passing would let
  // their coverage go unchecked. Fail closed to the full suite.
  const escalation =
    unmeasured.length > 0
      ? [
          railsFullSuiteEscalation(
            `no selected spec runs ${unmeasured.join(", ")}, so the partial run could not measure ${unmeasured.length === 1 ? "its" : "their"} coverage`
          ),
        ]
      : runPartial({ plan, command, cwd, env, out });
  if (typeof escalation === "number") return escalation;
  return escalate({ escalation, env, out, runFull });
}

/**
 * Run a partial plan's specs with the coverage hand-off and, in
 * `changed-files` mode, check each changed Ruby file afterwards.
 * @param {object} input Inputs.
 * @param {RspecPlan} input.plan The plan.
 * @param {ReadonlyArray<string>} input.command The full RSpec command.
 * @param {string} input.cwd Working directory.
 * @param {NodeJS.ProcessEnv} input.env Environment.
 * @param {(line: string) => void} input.out Output.
 * @returns {number|string[]} The run's verdict, or escalation lines (empty
 *   when the partial run passed and decides the push).
 */
function runPartial({ plan, command, cwd, env, out }) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]) ?? cwd;
  const coverageDir = mkdtempSync(join(tmpdir(), "lisa-rspec-coverage-"));
  try {
    const code = run(rspecArgv({ plan, command }), cwd, {
      ...env,
      LISA_RSPEC_PARTIAL_COVERAGE_DIR: coverageDir,
    });
    if (plan.coverage !== CHANGED_FILES) return code;
    if (code !== 0 && !handOffEscalated(coverageDir)) return code;
    return checkChangedFiles({ root, coverageDir, plan, out });
  } finally {
    rmSync(coverageDir, { recursive: true, force: true });
  }
}

/**
 * Escalate a partial push to the full suite, or pass it when there is nothing
 * to escalate: print why, tell the gate runner the run became a full one, and
 * return the full run's verdict.
 * @param {object} input Inputs.
 * @param {string[]} input.escalation Escalation lines; empty passes the push.
 * @param {NodeJS.ProcessEnv} input.env Environment.
 * @param {(line: string) => void} input.out Output.
 * @param {() => number} input.runFull Runs the full suite.
 * @returns {number} Exit code.
 */
function escalate({ escalation, env, out, runFull }) {
  if (escalation.length === 0) return 0;
  for (const line of escalation) out(line);
  if (env[SELECTION_REPORT_ENV]) {
    try {
      writeFileSync(
        env[SELECTION_REPORT_ENV],
        `${JSON.stringify({ selection: "full", reason: escalation.join(" "), coverage: "none", tests: 0, escalated: true })}\n`
      );
    } catch {
      // Without the report the runner reads nothing and reports as before.
    }
  }
  return runFull();
}

if (invokedAsScript(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
