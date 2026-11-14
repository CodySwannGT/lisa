// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Run only the tests a change can affect, at push (CodySwannGT/lisa#4600).
 *
 * The push gate used to run the whole unit suite for any change, a one-line
 * edit included. This module decides, from the files a branch changed and the
 * test-to-file access map CI records (CodySwannGT/lisa#4593), which test files
 * can see the change. Everything here is a pure function of its inputs; the
 * effects (git, the map download, spawning the suite) live in
 * `scripts/lisa-affected-tests.mjs`.
 *
 * The rule it never breaks: when the selection could be wrong it runs the
 * FULL suite and says why. A missing, stale or unreadable map, a changed file
 * the map has never seen, a change to shared test machinery or tool config,
 * running in CI — each one is a reason to run everything, never a reason to
 * run nothing.
 *
 * It is off unless `pushGate.affectedTests` is true. A TypeScript project gets
 * it, and `affectedCoverage: "changed-files"`, by default
 * (`lib/push-gate-defaults.mjs`, CodySwannGT/lisa#4611); this module only ever
 * sees the config with those defaults already applied.
 * `pushGate.affectedCoverage` says what a partial run does about the
 * coverage-adequacy gate at push:
 *
 * - `full` (default): coverage-adequacy declared at push keeps the full,
 *   coverage-measured suite, so selection only speeds up test-correctness
 *   where coverage-adequacy is not declared at push.
 * - `changed-files`: the selected tests run with coverage on, and each changed
 *   source file is held to the project's thresholds on its own. When every
 *   one meets them the partial run passes; when one does not, the push is
 *   never failed on that alone: it escalates to the full suite with
 *   whole-repo coverage, as `full` runs it, and that verdict decides.
 * - `skip`: the selected tests run without coverage and coverage-adequacy
 *   reports SKIPPED, "partial selection — enforced by CI".
 *
 * CI's own run of the suites is untouched, so merge protection is unchanged.
 * @module affected-tests
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The `pushGate` key that switches selection on. */
export const AFFECTED_TESTS_KEY = "affectedTests";

/** The `pushGate` key that says how a partial run treats coverage. */
export const AFFECTED_COVERAGE_KEY = "affectedCoverage";

/** Every coverage mode, default first. */
export const COVERAGE_MODES = Object.freeze(["full", "changed-files", "skip"]);

/** The environment variable through which the gate runner asks for a report. */
export const SELECTION_REPORT_ENV = "LISA_SELECTION_REPORT";

/** Overrides the seven-day map age limit. */
export const MAX_AGE_ENV = "LISA_ACCESS_MAP_MAX_AGE_DAYS";

/** How old a map may be before it counts as stale. */
export const DEFAULT_MAX_AGE_DAYS = 7;

/** The SKIPPED reason coverage-adequacy reports in `skip` mode. */
export const PARTIAL_COVERAGE_SKIP_REASON =
  "partial selection — enforced by CI";

/**
 * Changes that make any selection untrustworthy, so the full suite runs.
 *
 * One exported list so the TypeScript and Rails host templates (#4611,
 * #4612) reuse it instead of restating it. Each entry names, in plain words,
 * why a change to it reaches tests no map can point at.
 */
export const FULL_SUITE_TRIGGERS = Object.freeze([
  {
    pattern: /(^|\/)package\.json$/,
    reason: "package.json changed (dependencies or scripts)",
  },
  {
    pattern:
      /(^|\/)(bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Gemfile\.lock)$/,
    reason: "a lockfile changed (installed dependencies)",
  },
  {
    pattern: /(^|\/)vitest\.(config[^/]*\.[cm]?[jt]s|thresholds\.json)$/,
    reason: "the Vitest configuration changed",
  },
  {
    pattern: /(^|\/)tsconfig[^/]*\.json$/,
    reason: "the TypeScript configuration changed",
  },
  {
    pattern: /(^|\/)eslint[^/]*\.config\.[cm]?[jt]s$/,
    reason: "the ESLint configuration changed",
  },
  {
    pattern: /(^|\/)vite\.config[^/]*\.[cm]?[jt]s$/,
    reason: "the Vite configuration changed",
  },
  {
    pattern: /^tests\/(helpers|support|fixtures|integration\/support)\//,
    reason: "shared test helpers, support code or fixtures changed",
  },
  {
    // Any test root, in a host's own layout (CodySwannGT/lisa#4611): a shared
    // helper is read by tests the map may not have seen import it directly.
    pattern:
      /(^|\/)(tests?|__tests__|specs?)\/(.+\/)?(__fixtures__|fixtures|helpers|support|setup)\//,
    reason: "shared test helpers, support code, setup or fixtures changed",
  },
  {
    pattern: /(^|\/)__fixtures__\//,
    reason: "shared test fixtures changed",
  },
  {
    pattern: /^src\/configs\/vitest\//,
    reason: "the shipped Vitest presets changed",
  },
  {
    pattern:
      /(^|\/)scripts\/(lisa-affected-tests\.mjs|lib\/affected-tests\.mjs|lib\/test-access-map[^/]*\.mjs|lib\/push-gate-defaults\.mjs|fetch-test-access-map\.mjs)$/,
    reason: "the test-selection machinery itself changed",
  },
]);

/** A file Vitest, Jest or RSpec would collect as a test. */
const TEST_FILE = /(^|\/)[^/]+(\.(test|spec)\.[cm]?[jt]sx?|_spec\.rb)$/;

/**
 * Read and validate the selection settings from a parsed `.lisa.config.json`.
 *
 * A wrong type is refused rather than defaulted: a typo must not silently
 * switch selection on, or silently move coverage enforcement off the push.
 * @param {Record<string, unknown>|null|undefined} config Parsed config.
 * @returns {{enabled: boolean, coverage: "full"|"changed-files"|"skip"}} Settings.
 * @throws {Error} When `pushGate`, `affectedTests` or `affectedCoverage` is invalid.
 */
export function affectedTestsSettings(config) {
  const block = config?.pushGate;
  if (block === undefined) return { enabled: false, coverage: "full" };
  if (block === null || typeof block !== "object" || Array.isArray(block)) {
    throw new Error(
      `pushGate is ${JSON.stringify(block)}; expected an object such as ` +
        `{ "${AFFECTED_TESTS_KEY}": true }.`
    );
  }
  const enabled = block[AFFECTED_TESTS_KEY] ?? false;
  if (typeof enabled !== "boolean") {
    throw new Error(
      `pushGate.${AFFECTED_TESTS_KEY} is ${JSON.stringify(enabled)}; expected true or false.`
    );
  }
  const coverage = block[AFFECTED_COVERAGE_KEY] ?? COVERAGE_MODES[0];
  if (!COVERAGE_MODES.includes(coverage)) {
    throw new Error(
      `pushGate.${AFFECTED_COVERAGE_KEY} is ${JSON.stringify(coverage)}; ` +
        `expected one of ${COVERAGE_MODES.map(mode => `"${mode}"`).join(", ")}.`
    );
  }
  return { enabled, coverage };
}

/**
 * Whether `gates["coverage-adequacy"]` is declared (and not `off`) at push.
 * @param {Record<string, unknown>|null|undefined} gates The gates block.
 * @returns {boolean} True when the push gate must prove coverage.
 */
export function coverageDeclaredAtPush(gates) {
  const gate = gates?.["coverage-adequacy"];
  if (!gate || typeof gate !== "object") return false;
  const atPush = gate.push;
  const level = atPush && typeof atPush === "object" ? atPush.level : atPush;
  return typeof level === "string" && level !== "off";
}

/**
 * The first trigger any changed file fires, or null.
 * @param {ReadonlyArray<string>} changed Repository-relative changed paths.
 * @param {ReadonlyArray<{pattern: RegExp, reason: string}>} [extra] The project's recorded triggers.
 * @returns {{file: string, reason: string}|null} The trigger.
 */
export function firedTrigger(changed, extra = []) {
  const triggers = [...FULL_SUITE_TRIGGERS, ...extra];
  for (const file of changed) {
    const trigger = triggers.find(entry => entry.pattern.test(file));
    if (trigger) return { file, reason: trigger.reason };
  }
  return null;
}

/** Why a trigger recorded from the project's resolved Vitest config fires. */
export const RECORDED_TRIGGER_REASON =
  "a file the project's Vitest config names as a full-rerun trigger, setup file or global setup changed";

/**
 * The project's own triggers, recorded with the map from its resolved Vitest
 * config (`forceRerunTriggers`, `setupFiles`, `globalSetup`), as matchers.
 *
 * The host's merged config is only known to Vitest, so the recorder writes
 * these repository-relative globs into the map's metadata and the selector
 * honours them here. A missing or malformed list adds nothing: the built-in
 * triggers still apply.
 * @param {{triggers?: unknown}|null|undefined} meta The map's meta.json.
 * @returns {Array<{pattern: RegExp, reason: string}>} Extra triggers.
 */
export function recordedTriggers(meta) {
  const globs = Array.isArray(meta?.triggers) ? meta.triggers : [];
  return globs
    .filter(glob => typeof glob === "string" && glob !== "")
    .flatMap(expandBraces)
    .map(glob => ({
      // A trailing `/**` (Vitest writes `**/package.json/**`) matches the
      // path itself or anything under it.
      pattern: glob.endsWith("/**")
        ? new RegExp(
            globToRegExp(glob.slice(0, -3)).source.replace(/\$$/, "(?:/.*)?$")
          )
        : globToRegExp(glob),
      reason: `${RECORDED_TRIGGER_REASON} (${glob})`,
    }));
}

/**
 * Expand `{a,b}` alternatives, as Vitest's own trigger globs use them.
 * @param {string} glob A glob.
 * @returns {string[]} One glob per alternative.
 */
export function expandBraces(glob) {
  const match = /\{([^{}]*)\}/.exec(glob);
  if (!match) return [glob];
  const [whole, body] = match;
  return body
    .split(",")
    .flatMap(choice =>
      expandBraces(
        glob.slice(0, match.index) +
          choice +
          glob.slice(match.index + whole.length)
      )
    );
}

/**
 * Whether a test command can be narrowed: it must be a `vitest run`.
 *
 * Jest stacks (Expo) and anything else run unchanged with a printed reason,
 * never with a rewrite the runner would misread (CodySwannGT/lisa#4519).
 * @param {ReadonlyArray<string>} argv The test command.
 * @returns {boolean} True for a `vitest run` command.
 */
export function narrowable(argv) {
  return argv.some(
    (arg, index) => /(^|\/)vitest$/.test(arg) && argv[index + 1] === "run"
  );
}

/**
 * A glob as written in a test command's `--exclude` (`**`, `*`, `?`).
 * @param {string} glob The glob.
 * @returns {RegExp} An anchored matcher for repository-relative paths.
 */
export function globToRegExp(glob) {
  const source = glob
    .replace(/^\.\//, "")
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map(part => {
      if (part === "**/") return "(?:.*/)?";
      if (part === "**") return ".*";
      if (part === "*") return "[^/]*";
      if (part === "?") return "[^/]";
      return part.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${source}$`);
}

/**
 * The `--exclude` globs a test command passes, as matchers.
 * @param {ReadonlyArray<string>} argv The test command.
 * @returns {RegExp[]} Matchers.
 */
export function excludedBy(argv) {
  return argv.flatMap((arg, index) => {
    if (arg.startsWith("--exclude=")) {
      return [globToRegExp(arg.slice("--exclude=".length))];
    }
    if (arg === "--exclude" && argv[index + 1] !== undefined) {
      return [globToRegExp(argv[index + 1])];
    }
    return [];
  });
}

/**
 * Whether the map describes the tree this push builds on.
 *
 * Stale means: recorded for a base that is not the merge-base or an ancestor
 * of it, or recorded longer ago than the age limit. A map with no creation
 * time cannot be aged, so it is stale too.
 * @param {object} input Inputs.
 * @param {{baseSha?: string, createdAt?: string}|null} input.meta The map's meta.json.
 * @param {string} input.mergeBase The merge-base of this branch.
 * @param {(ancestor: string, descendant: string) => boolean} input.isAncestor Git ancestry.
 * @param {Date} input.now The current time.
 * @param {number} input.maxAgeDays The age limit.
 * @returns {string|null} Why the map cannot be used, or null when it can.
 */
export function staleMapReason({
  meta,
  mergeBase,
  isAncestor,
  now,
  maxAgeDays,
}) {
  const base = typeof meta?.baseSha === "string" ? meta.baseSha : "";
  if (base === "")
    return "stale map: it does not say which commit it was recorded for";
  if (base !== mergeBase && !isAncestor(base, mergeBase)) {
    return `stale map: it was recorded for ${base.slice(0, 12)}, which is not this branch's base or an ancestor of it`;
  }
  const created = Date.parse(String(meta?.createdAt ?? ""));
  if (Number.isNaN(created)) {
    return "stale map: it does not say when it was recorded";
  }
  const ageDays = (now.getTime() - created) / 86_400_000;
  if (ageDays > maxAgeDays) {
    return `stale map: it is ${ageDays.toFixed(1)} days old, and the limit is ${maxAgeDays}`;
  }
  return null;
}

/**
 * Which repository files each test file read, inverted: file -> test files.
 * @param {Readonly<Record<string, ReadonlyArray<string>>>} map The access map.
 * @returns {Map<string, Set<string>>} Readers per file.
 */
export function readersByFile(map) {
  const readers = new Map();
  for (const [test, files] of Object.entries(map)) {
    for (const file of [test, ...files]) {
      const set = readers.get(file) ?? new Set();
      set.add(test);
      readers.set(file, set);
    }
  }
  return readers;
}

/**
 * @typedef {object} ChangedFile
 * @property {string} path Repository-relative path.
 * @property {"added"|"modified"|"deleted"} status What the branch did to it.
 * @property {boolean} existedAtMapBase Whether it existed when the map was recorded.
 */

/**
 * @typedef {object} Selection
 * @property {"full"|"partial"} kind Which run to do.
 * @property {string} [reason] Why the full suite runs (kind `full`).
 * @property {Array<{file: string, reason: string}>} tests Test files to run, with why.
 * @property {string[]} related Changed files handed to the runner's import-graph selection.
 * @property {string[]} unread Changed files no unit test read when the map was recorded.
 */

/**
 * Choose the tests a change can affect, or say why everything must run.
 * @param {object} input Inputs.
 * @param {ReadonlyArray<ChangedFile>} input.changed Changed files.
 * @param {Readonly<Record<string, ReadonlyArray<string>>>} input.map The access map.
 * @param {ReadonlyArray<RegExp>} input.excluded Paths the test command excludes.
 * @param {(file: string) => boolean} input.exists Whether a file is in the working tree.
 * @param {ReadonlyArray<{pattern: RegExp, reason: string}>} [input.triggers] The project's recorded triggers.
 * @returns {Selection} The selection.
 */
export function selectAffectedTests({
  changed,
  map,
  excluded,
  exists,
  triggers = [],
}) {
  const runnable = file =>
    TEST_FILE.test(file) &&
    !excluded.some(pattern => pattern.test(file)) &&
    exists(file);
  const trigger = firedTrigger(
    changed.map(entry => entry.path),
    triggers
  );
  if (trigger) {
    return full(`${trigger.reason} (${trigger.file})`);
  }
  const readers = readersByFile(map);
  const chosen = new Map();
  const choose = (file, reason) => {
    if (runnable(file) && !chosen.has(file)) chosen.set(file, reason);
  };
  const related = [];
  const unread = [];
  for (const entry of changed) {
    if (TEST_FILE.test(entry.path)) {
      if (entry.status !== "deleted") choose(entry.path, "changed test");
      continue;
    }
    const testsReading = readers.get(entry.path);
    if (testsReading) {
      for (const test of testsReading) choose(test, `map: ${entry.path}`);
    } else if (entry.status !== "deleted" && !entry.existedAtMapBase) {
      return full(
        `unmapped file: ${entry.path} is new since the map was recorded, so no map entry can say which tests read it`
      );
    } else {
      unread.push(entry.path);
    }
    if (entry.status !== "deleted") related.push(entry.path);
  }
  return {
    kind: "partial",
    tests: [...chosen].map(([file, reason]) => ({ file, reason })),
    related,
    unread,
  };
}

/**
 * A full-suite selection.
 * @param {string} reason Why.
 * @returns {Selection} The selection.
 */
function full(reason) {
  return { kind: "full", reason, tests: [], related: [], unread: [] };
}

/**
 * Whether a test command measures coverage (`--coverage` or `--coverage.enabled`).
 * @param {ReadonlyArray<string>} argv The test command.
 * @returns {boolean} True when coverage is on.
 */
export function measuresCoverage(argv) {
  return argv.some(
    arg => arg === "--coverage" || arg === "--coverage.enabled=true"
  );
}

/**
 * The full test command rewritten to run only the selection.
 *
 * `vitest run …` becomes `vitest related --run … <files>`: Vitest adds every
 * test whose import graph reaches a changed file, and an explicitly passed
 * test file is always run. Only the Vitest invocation is touched; whatever
 * launches it (`bun run lisa-test-run -- --adapter vitest --`) is kept.
 * @param {object} input Inputs.
 * @param {ReadonlyArray<string>} input.argv The full test command.
 * @param {Selection} input.selection A partial selection.
 * @param {"on"|"off"} input.coverage Whether this run measures coverage.
 * @param {string} [input.coverageDir] Where a coverage-on run writes its summary.
 * @returns {string[]} The partial command.
 * @throws {Error} When the command has no `vitest run` to rewrite.
 */
export function partialArgv({ argv, selection, coverage, coverageDir }) {
  const at = argv.findIndex(
    (arg, index) => /(^|\/)vitest$/.test(arg) && argv[index + 1] === "run"
  );
  if (at === -1) {
    throw new Error("the test command has no `vitest run` to narrow");
  }
  const rest = argv
    .slice(at + 2)
    .filter(arg => arg !== "--coverage" && !arg.startsWith("--coverage."));
  const coverageArgs =
    coverage === "on"
      ? [
          "--coverage.enabled=true",
          "--coverage.reporter=json-summary",
          `--coverage.reportsDirectory=${coverageDir}`,
          "--coverage.thresholds.statements=0",
          "--coverage.thresholds.branches=0",
          "--coverage.thresholds.functions=0",
          "--coverage.thresholds.lines=0",
        ]
      : ["--coverage.enabled=false"];
  return [
    ...argv.slice(0, at + 1),
    "related",
    "--run",
    ...rest,
    ...coverageArgs,
    ...selection.related,
    ...selection.tests.map(test => test.file),
  ];
}

/** Coverage metrics checked per changed file, in report order. */
const METRICS = Object.freeze(["statements", "branches", "functions", "lines"]);

/**
 * Check each changed source file against the project's thresholds on its own.
 *
 * A file absent from the summary is outside the coverage population (a test,
 * a document, an excluded path) and is listed as not measured. A metric with
 * nothing to measure (`"Unknown"`, e.g. a type-only module) cannot fall short.
 * @param {object} input Inputs.
 * @param {Record<string, Record<string, {pct: number|string}>>} input.summary Vitest's json-summary, keyed by absolute path.
 * @param {string} input.root Repository root, absolute.
 * @param {ReadonlyArray<string>} input.files Changed, existing, non-test files.
 * @param {Record<string, number>} input.thresholds Minimum percentage per metric.
 * @returns {{shortfalls: string[], measured: string[], unmeasured: string[]}} The verdict.
 */
export function changedFileCoverage({ summary, root, files, thresholds }) {
  const shortfalls = [];
  const measured = [];
  const unmeasured = [];
  for (const file of files) {
    // Exact first; then by suffix, because Vitest may key on the real path of
    // a root reached through a symlink (`/tmp` on macOS, a linked worktree).
    const key = Object.hasOwn(summary, `${root}/${file}`)
      ? `${root}/${file}`
      : Object.keys(summary).find(candidate => candidate.endsWith(`/${file}`));
    const entry = key === undefined ? undefined : summary[key];
    if (!entry) {
      unmeasured.push(file);
      continue;
    }
    measured.push(file);
    for (const metric of METRICS) {
      const floor = thresholds[metric];
      const pct = entry[metric]?.pct;
      if (typeof floor !== "number" || typeof pct !== "number") continue;
      if (pct < floor) {
        shortfalls.push(`${file}: ${metric} ${pct}% is below ${floor}%`);
      }
    }
  }
  return { shortfalls, measured, unmeasured };
}

/**
 * The line that sends a partial push run to the full suite.
 *
 * A push is never stricter than whole-repo coverage (CodySwannGT/lisa#4600):
 * before selection, a push failed coverage only when the whole suite's
 * coverage did. So a partial run that cannot clear every changed file on its
 * own does not fail the push; it runs the full suite with whole-repo coverage,
 * exactly as `affectedCoverage: "full"` does, and that run's verdict decides.
 * @param {string} subject Who is speaking ("affected tests", "affected specs").
 * @param {string} because Why the partial run could not decide the push.
 * @returns {string} One plain-language line.
 */
export function fullSuiteEscalation(subject, because) {
  return `↪️  ${subject}: ${because}, so the full suite is running now with whole-repo coverage, and that run decides this push.`;
}

/**
 * One escalation line per changed file below its floor, naming every metric
 * it misses. Shortfalls are matched to a file by its exact `file: ` prefix,
 * the form {@link changedFileCoverage} and the Rails check both write.
 * @param {object} input Inputs.
 * @param {string} input.subject Who is speaking.
 * @param {ReadonlyArray<string>} input.files Changed files, in report order.
 * @param {ReadonlyArray<string>} input.shortfalls The verdict's shortfalls.
 * @returns {string[]} Lines; empty when every file meets its floor.
 */
export function coverageEscalationLines({ subject, files, shortfalls }) {
  return files.flatMap(file => {
    const prefix = `${file}: `;
    const misses = shortfalls
      .filter(line => line.startsWith(prefix))
      .map(line => line.slice(prefix.length));
    return misses.length === 0
      ? []
      : [
          fullSuiteEscalation(
            subject,
            `${file} is below its coverage floor on its own (${misses.join("; ")})`
          ),
        ];
  });
}

/**
 * The lines that explain a selection before the suite runs.
 * @param {Selection} selection The selection.
 * @param {string} coverageNote What this run does about coverage.
 * @returns {string[]} Plain-language lines.
 */
export function explainSelection(selection, coverageNote) {
  if (selection.kind === "full") {
    return [`🎯 affected tests: Running the full suite: ${selection.reason}`];
  }
  return [
    `🎯 affected tests: running ${selection.tests.length} test file(s) the change can reach, plus whatever Vitest's import graph adds.`,
    ...selection.tests.map(test => `   ${test.file}  (${test.reason})`),
    ...(selection.related.length
      ? [
          "   Changed files handed to Vitest's import-graph selection:",
          ...selection.related.map(file => `     ${file}`),
        ]
      : []),
    ...(selection.unread.length
      ? [
          "   No unit test read these when the map was recorded:",
          ...selection.unread.map(file => `     ${file}`),
        ]
      : []),
    `   Coverage: ${coverageNote}`,
    "   CI still runs every test before merge.",
  ];
}

/**
 * The channel through which a test command tells the gate runner what it ran.
 *
 * The runner opens one per run and calls `before(command)` just before it
 * executes a command, which points `LISA_SELECTION_REPORT` at a fresh file
 * for that command. `read(command)` returns what the command wrote, or null
 * when it wrote nothing (an older command, or one with selection off), which
 * the runner then reports exactly as before.
 * @param {NodeJS.ProcessEnv} [env] The environment the commands inherit.
 * @returns {{before: (command: string) => void, read: (command: string) => any, close: () => void}} The channel.
 */
export function openSelectionReports(env = process.env) {
  const dir = mkdtempSync(join(tmpdir(), "lisa-selection-"));
  const fileFor = command =>
    join(
      dir,
      `${createHash("sha256").update(command).digest("hex").slice(0, 16)}.json`
    );
  return {
    before(command) {
      const file = fileFor(command);
      rmSync(file, { force: true });
      env[SELECTION_REPORT_ENV] = file;
    },
    read(command) {
      try {
        return JSON.parse(readFileSync(fileFor(command), "utf8"));
      } catch {
        return null;
      }
    },
    close() {
      delete env[SELECTION_REPORT_ENV];
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Whether a gate's verdict is SKIPPED because its command ran a partial
 * selection with coverage switched off (`pushGate.affectedCoverage: "skip"`).
 * Only coverage-adequacy: test-correctness keeps the run's own verdict.
 * @param {{id: string}} gate The gate.
 * @param {{selection?: string, coverage?: string}|null} report What the command reported.
 * @returns {boolean} True when coverage-adequacy is left to CI.
 */
export function coverageLeftToCi(gate, report) {
  return (
    gate.id === "coverage-adequacy" &&
    report?.selection === "partial" &&
    report?.coverage === "skip"
  );
}
