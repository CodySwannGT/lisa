#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
/**
 * Mutation-testing gate (StrykerJS) — opt-in, diff-only, shared by the pre-push
 * hook and CI.
 *
 * @remarks
 * ## What it does
 *
 * 1. Reads `mutation.gate.json`. Disabled (the default) prints a notice and
 *    exits 0, so pushes and CI are never slowed down until a project opts in.
 * 2. When enabled, it computes the files changed on this branch (vs the
 *    merge-base with the configured `since` ref), keeps the ones the project's
 *    **own Stryker `mutate` configuration** selects, and runs Stryker on only
 *    those. Mutation testing is slow; a full-repo run is never done here.
 * 3. The score threshold lives in `stryker.conf.*` (`thresholds.break`).
 *    Stryker exits non-zero below it, which fails the gate.
 *
 * ## Why eligibility is read from the project's config, not hardcoded
 *
 * This filter used to be `f.startsWith("src/") || f.startsWith("lib/")` with a
 * `.ts`/`.tsx` extension test. That happened to agree with the two
 * `stryker.conf.json` templates Lisa ships, and it disagreed with every other
 * layout in the world. The failure it produces is the worst-shaped one
 * available: a project whose sources live anywhere else gets a gate that
 * selects **no files, generates no mutants and exits 0 on every run** — a
 * control that reports green while proving nothing, which is the exact defect
 * class mutation testing is here to find.
 *
 * It was not hypothetical. Lisa's own mutate targets are `.mjs` guard scripts
 * outside `src/`, so adopting this gate in the repository that ships it was
 * impossible until the filter learned to read the config.
 *
 * Reading `mutate` also removes a second, quieter disagreement: `--mutate`
 * REPLACES the configured patterns, so a changed file that the hardcoded filter
 * accepted but the project's config excludes used to get mutated anyway.
 *
 * ## Empty is not the same as clean
 *
 * A diff-only gate that mutates nothing looks exactly like one that passed, so
 * the two are separated here rather than left to the reader:
 *
 * - **Nothing changed that this project mutates** — legitimate, and extremely
 *   common (a docs-only or workflow-only branch). Reported as
 *   `nothing-to-mutate`, in a block that states no mutant was generated and no
 *   score was computed. Exit 0.
 * - **The mutate configuration selects nothing in this repository at all** —
 *   a misconfigured gate, permanently inert, green forever. Reported as
 *   `inert-mutate-config` and it FAILS, exit 1. Distinguishing the two costs
 *   one `git ls-files`.
 *
 * ## A timeout is not a score
 *
 * Stryker can end a run two ways that share one exit code: a mutation score
 * under `thresholds.break`, and a wall-clock budget running out. Only the first
 * is a fact about the tests. The second is a fact about the machine, and it is
 * reached by owning slower hardware than whoever picked the budget — so
 * reporting it as a score tells the person least able to argue with it that
 * their tests are weak, when nothing was measured at all.
 *
 * Stryker's output is therefore kept as the run streams (see `runStryker`) and
 * read on failure: `dry-run-timeout` names the budget that ended it and says no
 * score exists, `score-below-break` names the two numbers, and `run-failed`
 * quotes Stryker's last lines and claims nothing. The budgets are named from
 * the project's Stryker config, or reported as Stryker's own defaults when the
 * config declares none — a budget nobody chose is unactionable until somebody
 * is told that is what it was.
 *
 * ## A timeout is not a kill either
 *
 * The other half of the same problem, and the one that survives a run
 * COMPLETING. **Stryker scores a timed-out mutant as KILLED**, so every score it
 * reports credits a bucket nothing demonstrably caught, and which mutants land
 * in that bucket depends on how busy the machine was. The consequence is
 * perverse in a way worth stating plainly: **a slower box yields a better
 * score.** A genuine regression can hide there too — a mutation that makes the
 * covering tests hang is scored identically to one they catch.
 *
 * One whole-list run measured 117 timeouts against 3,455 detected: 3.39% of
 * everything counted as detection, worth up to 2.00 score points.
 *
 * So every completed run now prints the count, the score as reported, and the
 * score recomputed with timeouts NOT credited — and the recomputed one is
 * judged against `thresholds.break`. That can only ever tighten: it is applied
 * on top of Stryker's own verdict, and nothing here can turn a red run green.
 * Raising `timeoutMS` is NOT the fix and is refused as one — it converts a
 * timeout into a slow pass and hides the identical gap.
 *
 * ## Configuration
 *
 * `mutation.gate.json` (project-owned / create-only):
 * `{ "enabled": false, "since": "main" }`.
 * Overridable via env: `MUTATION_ENABLED=true|false`, `MUTATION_SINCE=<ref>`.
 * `MUTATION_CAPTURE=0` turns the output capture off, trading the diagnosis
 * above for Stryker's TTY progress bar — and with it the timeout accounting,
 * which is read from the same transcript.
 * `MUTATION_TIMEOUT_SHARE_MAX=<percent>` moves the share ceiling for one run.
 *
 * `--all` mutates the project's whole `mutate` list instead of a diff. It is
 * the same gate, so the accounting above applies to it — which is the point:
 * the whole-list run is where the timeout bucket is large enough to matter, and
 * it used to be `stryker run` invoked directly, outside this script entirely.
 * @module scripts/lisa-mutation
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * Machine-readable outcome markers, one per way this gate can end.
 *
 * Printed verbatim so a human scrolling a CI log and a test asserting the gate
 * did not silently no-op read the same token. The distinction that matters is
 * between `nothingToMutate` and a real passing run: both exit 0, and only the
 * marker says which one happened.
 * @type {Readonly<Record<string, string>>}
 */
export const OUTCOMES = Object.freeze({
  disabled: "mutation-gate: disabled",
  noBase: "mutation-gate: no-diff-base",
  nothingToMutate: "mutation-gate: nothing-to-mutate",
  inertConfig: "mutation-gate: inert-mutate-config",
  unrepresentablePath: "mutation-gate: unrepresentable-path",
  diffFailed: "mutation-gate: diff-failed",
  scoped: "mutation-gate: scoped-run",
  wholeList: "mutation-gate: whole-list-run",
  dryRunTimeout: "mutation-gate: dry-run-timeout",
  scoreBelowBreak: "mutation-gate: score-below-break",
  runFailed: "mutation-gate: run-failed",
  timeoutAccounting: "mutation-gate: timeout-accounting",
  timeoutUnmeasured: "mutation-gate: timeout-share-unmeasured",
  timeoutShareExceeded: "mutation-gate: timeout-share-exceeded",
  inflatedByTimeouts: "mutation-gate: score-below-break-without-timeouts",
});

/**
 * Stryker config file names, in the order Stryker itself resolves them.
 *
 * Only the JSON family is parsed. A JavaScript config would have to be
 * imported, and importing a project's config to decide what to mutate is a much
 * larger promise than this script makes; the fallback below is used instead and
 * says so out loud rather than pretending to have read the file.
 * @type {readonly string[]}
 */
export const JSON_CONFIG_NAMES = Object.freeze([
  "stryker.conf.json",
  "stryker.config.json",
  ".stryker.conf.json",
  ".stryker.config.json",
]);

/**
 * Config file names this script can see but does not evaluate.
 * @type {readonly string[]}
 */
export const UNREADABLE_CONFIG_NAMES = Object.freeze([
  "stryker.conf.js",
  "stryker.conf.mjs",
  "stryker.conf.cjs",
  "stryker.config.js",
  "stryker.config.mjs",
  "stryker.config.cjs",
]);

/**
 * The patterns used when the project declares none.
 *
 * Deliberately the exact behaviour this script had before it learned to read
 * `mutate`: a project that was relying on the old hardcoded filter and has no
 * `mutate` key keeps the gate it had. It is a fallback, never a default — when
 * `mutate` is present it wins outright.
 * @type {readonly string[]}
 */
export const FALLBACK_MUTATE = Object.freeze([
  "src/**/*.ts",
  "src/**/*.tsx",
  "lib/**/*.ts",
  "lib/**/*.tsx",
  "!**/*.spec.ts",
  "!**/*.spec.tsx",
  "!**/*.test.ts",
  "!**/*.test.tsx",
  "!**/*.d.ts",
  "!**/*.stories.tsx",
]);

/**
 * A path in the one spelling every comparison here uses.
 * @param {string} file - Any path spelling.
 * @returns {string} POSIX separators, no leading `./`.
 */
export const normalizePath = file =>
  file.replaceAll("\\", "/").replace(/^\.\//u, "");

/**
 * A mutate entry with Stryker's optional mutation-range suffix removed.
 *
 * `src/a.ts:1-10` and `src/a.ts:1:5-2:10` name a file plus the lines within it
 * to mutate. The range is Stryker's business; for deciding whether a changed
 * file is in scope only the path part matters, and leaving the suffix on makes
 * the pattern match nothing.
 * @param {string} pattern - A raw `mutate` entry, negation already stripped.
 * @returns {string} The path-or-glob part.
 */
export const stripMutationRange = pattern =>
  pattern.replace(/:\d+(?::\d+)?(?:-\d+(?::\d+)?)?$/u, "");

/**
 * A glob compiled to an anchored regular expression.
 *
 * Supports the subset Stryker's own patterns use: `**` across directories, `*`
 * and `?` within a segment, and `{a,b}` alternation. A literal path — which is
 * what a hand-enumerated mutate list contains — is a glob that matches itself,
 * so it needs no special case.
 * @param {string} glob - The pattern.
 * @returns {RegExp} Anchored matcher over a normalized path.
 */
export const globToRegExp = glob => {
  let source = "^";
  let braceDepth = 0;
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      // `**/` spans whole segments INCLUDING none, so `**/x` matches `x`.
      const spansSegments = glob[index + 2] === "/";
      source += spansSegments ? "(?:[^/]*/)*" : "[^]*";
      index += spansSegments ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else if (char === "{") {
      braceDepth += 1;
      source += "(?:";
    } else if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
      source += ")";
    } else if (char === "," && braceDepth > 0) source += "|";
    else source += char.replaceAll(/[.+^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`${source}$`, "u");
};

/**
 * A `mutate` list split into what it selects and what it takes back out.
 * @param {readonly string[]} mutate - Raw `mutate` entries.
 * @returns {{include: RegExp[], exclude: RegExp[]}} Compiled matchers.
 */
export const compileMutatePatterns = mutate => {
  const compile = entry => globToRegExp(stripMutationRange(entry));
  return {
    include: mutate.filter(entry => !entry.startsWith("!")).map(compile),
    exclude: mutate
      .filter(entry => entry.startsWith("!"))
      .map(entry => compile(entry.slice(1))),
  };
};

/**
 * Whether a file is one this project mutates.
 * @param {string} file - Repository-relative path.
 * @param {{include: RegExp[], exclude: RegExp[]}} patterns - Compiled matchers.
 * @returns {boolean} True when at least one include and no exclude matches.
 */
export const isMutateTarget = (file, patterns) => {
  const candidate = normalizePath(file);
  if (!patterns.include.some(rule => rule.test(candidate))) return false;
  return !patterns.exclude.some(rule => rule.test(candidate));
};

/**
 * Read and parse a Stryker JSON config, or report why it could not be used.
 * @param {string} cwd - Project root.
 * @param {string} name - Config file name that exists.
 * @returns {{mutate: readonly string[], source: string}} Declaration and origin.
 */
const declarationFromJson = (cwd, name) => {
  try {
    const conf = JSON.parse(fs.readFileSync(path.join(cwd, name), "utf8"));
    if (Array.isArray(conf.mutate) && conf.mutate.length > 0) {
      return { mutate: conf.mutate, source: name };
    }
    return {
      mutate: FALLBACK_MUTATE,
      source: `Lisa's fallback patterns (${name} declares no "mutate")`,
    };
  } catch (error) {
    return {
      mutate: FALLBACK_MUTATE,
      source: `Lisa's fallback patterns (${name} could not be parsed: ${error.message})`,
    };
  }
};

/**
 * The project's mutate declaration, and where it came from.
 *
 * The provenance is returned rather than logged from in here because it is
 * printed on every run: a reader has to be able to tell "your config chose
 * these" from "no config was found, so the fallback did".
 * @param {string} cwd - Project root.
 * @returns {{mutate: readonly string[], source: string}} Declaration and origin.
 */
export const resolveMutateDeclaration = cwd => {
  const found = JSON_CONFIG_NAMES.find(name =>
    fs.existsSync(path.join(cwd, name))
  );
  if (found) return declarationFromJson(cwd, found);

  const unreadable = UNREADABLE_CONFIG_NAMES.find(name =>
    fs.existsSync(path.join(cwd, name))
  );
  return {
    mutate: FALLBACK_MUTATE,
    source: unreadable
      ? `Lisa's fallback patterns (${unreadable} is JavaScript, which this gate does not evaluate)`
      : "Lisa's fallback patterns (no Stryker config found)",
  };
};

/**
 * Stryker's per-mutant budget when a config declares none, in milliseconds.
 *
 * Restated here rather than read out of Stryker because the message these feed
 * has to NAME the number that ended the run, and a run ended by an inherited
 * default has no number written down anywhere in the project to name. Telling
 * an operator the budget was "whatever Stryker picked" is the same dead end as
 * telling them nothing.
 * @type {number}
 */
export const STRYKER_DEFAULT_TIMEOUT_MS = 5000;

/**
 * Stryker's dry-run budget when a config declares none, in minutes.
 * @type {number}
 */
export const STRYKER_DEFAULT_DRY_RUN_TIMEOUT_MINUTES = 5;

/**
 * The timeout options this gate can name in a failure message.
 * @type {readonly string[]}
 */
const TIMEOUT_KEYS = Object.freeze(["timeoutMS", "dryRunTimeoutMinutes"]);

/**
 * Stryker's defaults, keyed the way a Stryker config spells them.
 * @type {Readonly<Record<string, number>>}
 */
const TIMEOUT_DEFAULTS = Object.freeze({
  timeoutMS: STRYKER_DEFAULT_TIMEOUT_MS,
  dryRunTimeoutMinutes: STRYKER_DEFAULT_DRY_RUN_TIMEOUT_MINUTES,
});

/**
 * The project's Stryker JSON config, or null when there is none to read.
 * @param {string} cwd - Project root.
 * @returns {object|null} The parsed config.
 */
const readJsonConfig = cwd => {
  const found = JSON_CONFIG_NAMES.find(name =>
    fs.existsSync(path.join(cwd, name))
  );
  if (!found) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, found), "utf8"));
  } catch {
    return null;
  }
};

/**
 * The timeout budgets in force, and which of them nobody chose.
 *
 * `inherited` is the load-bearing half. A budget the project wrote down is a
 * decision an operator can go and change; a budget that arrived by omission is
 * Stryker's opinion about a machine it has never seen, and the failure it
 * produces is unactionable until somebody is told that is what happened.
 * @param {string} [cwd] - Project root; defaults to the process working dir.
 * @returns {{timeoutMS: number, dryRunTimeoutMinutes: number,
 *   inherited: string[]}} The budgets, and the keys taken from Stryker.
 */
export const resolveTimeoutBudgets = (cwd = process.cwd()) => {
  const conf = readJsonConfig(cwd);
  const declared = key => {
    const value = conf?.[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : null;
  };
  return {
    ...Object.fromEntries(
      TIMEOUT_KEYS.map(key => [key, declared(key) ?? TIMEOUT_DEFAULTS[key]])
    ),
    inherited: TIMEOUT_KEYS.filter(key => declared(key) === null),
  };
};

/**
 * Stryker's wording when the un-mutated run blows its wall-clock budget.
 * @type {string}
 */
const DRY_RUN_TIMEOUT_SIGNATURE = "Initial test run timed out!";

/**
 * Stryker's wording when a completed run scored under `thresholds.break`.
 * @type {RegExp}
 */
const BREAK_THRESHOLD_PATTERN =
  /Final mutation score ([\d.]+) under breaking threshold ([\d.]+)/u;

/**
 * The progress reporter's tally: `12/40 tested (3 survived, 2 timed out)`.
 *
 * Emitted every ten seconds by the append-only reporter, which is the one that
 * runs whenever stdout is not a terminal — including under the capture below.
 * @type {RegExp}
 */
const TIMED_OUT_MUTANTS_PATTERN = /\(\d+ survived, (\d+) timed out\)/gu;

/**
 * One escape character, kept out of the pattern literals below.
 *
 * A regular-expression literal containing a control character is refused by the
 * shipped ruleset (`no-control-regex`) and it is right to: an unexplained
 * control byte in a pattern is nearly always a mistake. This one is not — the
 * clear-text reporter colours its score cells with chalk, and `FORCE_COLOR` in
 * CI turns that on even under a pipe — so the escape is named once, here, and
 * the pattern is assembled from it.
 * @type {string}
 */
const ESCAPE = String.fromCharCode(27);

/** Chalk's SGR sequences, so a coloured table row can still be read. */
const ANSI_PATTERN = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "gu");

/**
 * The clear-text reporter's `All files` row.
 *
 * ```
 * All files  |  59.03 |  77.09 |  3338 |  117 |  1027 |  1371 |  191 |
 * ```
 *
 * Seven cells after the name: total score, covered score, then the five counts.
 * Only the counts are read — the two scores are RECOMPUTED here rather than
 * taken, because the whole point is that the printed one credits a bucket
 * nothing demonstrably caught.
 *
 * The row is absent from a run whose reporters do not include `clear-text`, and
 * from one where `skipFull` is set and every file scored 100. Both are reported
 * as "not measured" rather than guessed at; see {@link parseMutantTally}.
 *
 * It is found by a prefix test over already-split lines rather than by an
 * anchored pattern over the whole transcript. That is the shipped ruleset's
 * rule and it is the right one here twice over: this is a parser reading a
 * multi-megabyte transcript inside a git hook, so a pattern that can backtrack
 * is a hazard, and a single expression covering seven cells was over the
 * complexity ceiling anyway.
 * @type {string}
 */
const ALL_FILES_ROW_PREFIX = "All files";

/** One count cell, which is a bare non-negative integer or nothing useful. */
const COUNT_CELL_PATTERN = /^\d+$/u;

/**
 * Where each count sits once the row is split on its separators.
 *
 * `name | total | covered | killed | timeout | survived | no cov | errors |`,
 * so the counts start at index 3. Named rather than inlined because reading
 * the wrong column would produce a plausible number for the wrong quantity,
 * which is the failure this whole file is about.
 * @type {Readonly<Record<string, number>>}
 */
const COUNT_COLUMNS = Object.freeze({
  killed: 3,
  timedOut: 4,
  survived: 5,
  noCoverage: 6,
  errors: 7,
});

/**
 * The mutant counts a completed run reported, or null when it reported none.
 *
 * Null is a real answer and is treated as one everywhere below. A gate that
 * could not read a tally must say the timeout share was NOT measured, never
 * assume it was zero — "I do not know" turned into "it was fine" is the one
 * mistake the rest of this file is organised around not making.
 * @param {string|null|undefined} output - Stryker's combined output.
 * @returns {{killed: number, timedOut: number, survived: number,
 *   noCoverage: number, errors: number}|null} The counts, or null.
 */
export const parseMutantTally = output => {
  if (typeof output !== "string" || output.length === 0) return null;
  const row = output
    .replaceAll(ANSI_PATTERN, "")
    .split("\n")
    .find(line => line.startsWith(ALL_FILES_ROW_PREFIX));
  if (row === undefined) return null;
  const cells = row.split("|").map(cell => cell.trim());
  const counts = Object.entries(COUNT_COLUMNS).map(([name, column]) => [
    name,
    cells[column] ?? "",
  ]);
  // Every count cell has to be a count. A short row, a reformatted table or a
  // line that merely starts with the same words all land here, and reading
  // `Number("")` as a zero would turn any of them into a clean tally.
  if (!counts.every(([, cell]) => COUNT_CELL_PATTERN.test(cell))) return null;
  return Object.freeze(
    Object.fromEntries(counts.map(([name, cell]) => [name, Number(cell)]))
  );
};

/**
 * A percentage, or NaN when there is nothing to take a percentage of.
 * @param {number} part - Numerator.
 * @param {number} whole - Denominator.
 * @returns {number} `part/whole` as a percentage.
 */
const percent = (part, whole) =>
  whole === 0 ? Number.NaN : (part / whole) * 100;

/**
 * The score as reported, and the score with timeouts NOT credited.
 *
 * ## Why the second number exists
 *
 * Stryker scores a timed-out mutant as KILLED. A mutant whose covering tests
 * exceed the per-mutant budget is therefore counted as detected, identically to
 * one an assertion caught — and which bucket a mutant lands in depends on how
 * busy the machine was. The perverse consequence is that **a slower box yields
 * a better score**, and a genuine regression can hide inside the timeout
 * bucket: a mutation that makes the covering tests hang scores exactly like one
 * they catch.
 *
 * `withoutTimeouts` reclassifies every timeout as survived. That is the worst
 * case rather than the truth — some timeouts are genuine infinite loops the
 * mutation correctly introduced — and it is deliberately the worst case,
 * because it is the only one of the two that cannot be inflated by the clock.
 * A gate may be pessimistic about what it proved; it may not be optimistic.
 *
 * Errors are excluded from every denominator, which is Stryker's own
 * arithmetic: a compile or runtime error produced no verdict about the mutant.
 * @param {{killed: number, timedOut: number, survived: number,
 *   noCoverage: number}} tally - From {@link parseMutantTally}.
 * @returns {{detected: number, total: number, reported: number,
 *   withoutTimeouts: number, reportedCovered: number,
 *   coveredWithoutTimeouts: number, timedOutShare: number}} The accounting.
 */
export const timeoutAccounting = tally => {
  const detected = tally.killed + tally.timedOut;
  const total = detected + tally.survived + tally.noCoverage;
  const covered = detected + tally.survived;
  return Object.freeze({
    detected,
    total,
    reported: percent(detected, total),
    withoutTimeouts: percent(tally.killed, total),
    reportedCovered: percent(detected, covered),
    coveredWithoutTimeouts: percent(tally.killed, covered),
    timedOutShare: percent(tally.timedOut, detected),
  });
};

/**
 * Largest share of DETECTED mutants that may have been decided by the clock.
 *
 * A bound on how load-dependent the score is allowed to be, not a performance
 * budget and not an aspiration. One whole-list run measured 117 timeouts
 * against 3,455 detected — **3.39%**, worth up to 2.00 score points — on a box
 * at one-minute load 40-77. 5% leaves room above that measurement and still
 * refuses a run where a twentieth of the evidence is a stopwatch reading.
 *
 * It lives here rather than in a config file on purpose. `stryker.conf.json`'s
 * `thresholds` are governed by the threshold ratchet; this is not, so putting
 * it beside them would create a number that looks governed and is not. As a
 * constant, raising it is a code change that gets reviewed.
 * `MUTATION_TIMEOUT_SHARE_MAX` exists for a one-off run, not for a project's
 * standing configuration.
 * @type {number}
 */
export const DEFAULT_TIMEOUT_SHARE_CEILING_PCT = 5;

/**
 * Detected mutants needed before the share above means anything.
 *
 * A share is a ratio, and a ratio over a handful of mutants is noise. The
 * diff-only gate routinely runs over a single changed guard: at 8 detected
 * mutants one timeout is 12.5%, which would fail a push for a reason that is
 * entirely about the machine — the exact false red this gate's own "a timeout
 * is not a score" section exists to prevent. Below this many detected mutants
 * the share is REPORTED and not enforced, and the report says which.
 *
 * The score recomputed without timeouts is enforced at every size, because it
 * is not a ratio over a small sample — it is the same score, computed honestly.
 * @type {number}
 */
export const MIN_DETECTED_FOR_SHARE = 50;

/**
 * The share ceiling in force.
 * @returns {number} The ceiling, as a percentage.
 */
export const resolveTimeoutShareCeiling = () => {
  const raw = process.env.MUTATION_TIMEOUT_SHARE_MAX;
  if (raw === undefined) return DEFAULT_TIMEOUT_SHARE_CEILING_PCT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_TIMEOUT_SHARE_CEILING_PCT;
};

/**
 * The break threshold the project declared, or null when it declared none.
 *
 * Null is not zero. Stryker's own default is to have no breaking threshold at
 * all, and a project with none has not asked for a floor — inventing one here
 * would fail a gate against a number nobody chose.
 * @param {string} cwd - Project root.
 * @returns {number|null} `thresholds.break`, or null.
 */
export const resolveBreakThreshold = cwd => {
  const value = readJsonConfig(cwd)?.thresholds?.break;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/** Decimal places every score in the accounting block is printed to. */
const SCORE_PRECISION = 2;

/**
 * One score, printed the way Stryker prints one.
 * @param {number} value - A percentage.
 * @returns {string} Two decimal places, or `n/a`.
 */
const score = value =>
  Number.isFinite(value) ? value.toFixed(SCORE_PRECISION) : "n/a";

/**
 * The block every completed run prints, whatever its verdict.
 *
 * This is the reporting half of the fix. Before it, the timeout bucket was
 * credited and unmeasured: a reader could not tell how much of the number in
 * front of them came from an assertion and how much from a stopwatch.
 * @param {{killed: number, timedOut: number}} tally - The counts.
 * @param {{detected: number, reported: number, withoutTimeouts: number,
 *   reportedCovered: number, coveredWithoutTimeouts: number,
 *   timedOutShare: number}} accounting - From {@link timeoutAccounting}.
 * @param {number} ceiling - The share ceiling in force.
 * @returns {string} The block.
 */
const accountingBlock = (tally, accounting, ceiling) => {
  const sampleNote =
    accounting.detected < MIN_DETECTED_FOR_SHARE
      ? `, NOT enforced below ${MIN_DETECTED_FOR_SHARE} detected mutants — too small a sample to be a ratio`
      : "";
  return (
    `🕒 ${OUTCOMES.timeoutAccounting}\n` +
    `   ${tally.timedOut} of ${accounting.detected} detected mutant(s) were decided by the per-mutant\n` +
    "   clock rather than by an assertion. Stryker scores those as KILLED.\n" +
    `   score   as reported ${score(accounting.reported)}  |  without crediting timeouts ${score(accounting.withoutTimeouts)}\n` +
    `   covered as reported ${score(accounting.reportedCovered)}  |  without crediting timeouts ${score(accounting.coveredWithoutTimeouts)}\n` +
    `   timed-out share of detected: ${score(accounting.timedOutShare)}% (ceiling ${ceiling}%${sampleNote})`
  );
};

/**
 * The block printed when a run could not be accounted for at all.
 * @returns {string} The block.
 */
const unmeasuredBlock = () =>
  `⚠️  ${OUTCOMES.timeoutUnmeasured}\n` +
  "   No `All files` row was found in Stryker's output, so the timed-out share of\n" +
  "   this score was NOT measured. That is not a claim it was zero: Stryker scores\n" +
  "   a timed-out mutant as KILLED, so an unmeasured share is an unknown amount of\n" +
  "   this score decided by the clock.\n" +
  '   Add "clear-text" to `reporters` in your Stryker config to measure it, or set\n' +
  "   MUTATION_CAPTURE=0 to say out loud that this run is not being accounted for.";

/**
 * Judge a completed run on what it can prove, rather than on what it counted.
 *
 * Two verdicts, and neither can turn a red run green — both are checks the gate
 * applies IN ADDITION to Stryker's own, on a run Stryker already judged:
 *
 * - the score recomputed without crediting timeouts is under the project's
 *   `thresholds.break`, so the run cleared the floor only because the clock
 *   helped it;
 * - the timed-out share of detected mutants is over the ceiling, so the score is
 *   more a property of the machine than of the tests, whatever its value.
 * @param {{killed: number, timedOut: number}} tally - The counts.
 * @param {number|null} breakThreshold - `thresholds.break`, or null.
 * @param {number} ceiling - The share ceiling in force.
 * @returns {{failed: boolean, measured: boolean, message: string}} The block,
 *   whether a tally was read, and whether it fails.
 */
export const judgeTimeoutAccounting = (tally, breakThreshold, ceiling) => {
  const accounting = timeoutAccounting(tally);
  const report = accountingBlock(tally, accounting, ceiling);

  if (
    breakThreshold !== null &&
    Number.isFinite(accounting.withoutTimeouts) &&
    accounting.withoutTimeouts < breakThreshold
  ) {
    return {
      failed: true,
      measured: true,
      message:
        `${report}\n❌ ${OUTCOMES.inflatedByTimeouts}\n` +
        `   Without crediting the ${tally.timedOut} timed-out mutant(s), this run scores\n` +
        `   ${score(accounting.withoutTimeouts)} against a break threshold of ${breakThreshold}. It cleared the floor\n` +
        "   ONLY because Stryker counts a timeout as a kill, and which mutants time out\n" +
        "   is a property of how busy this machine was — so a slower box would have\n" +
        "   scored HIGHER. Nothing here demonstrably caught those mutants.\n" +
        "   Strengthen the tests covering them, or find out why they hang. Do NOT raise\n" +
        '   "timeoutMS": that converts a timeout into a slow pass and hides the same gap.',
    };
  }

  if (
    accounting.detected >= MIN_DETECTED_FOR_SHARE &&
    Number.isFinite(accounting.timedOutShare) &&
    accounting.timedOutShare > ceiling
  ) {
    return {
      failed: true,
      measured: true,
      message:
        `${report}\n❌ ${OUTCOMES.timeoutShareExceeded}\n` +
        `   ${score(accounting.timedOutShare)}% of what this run counted as DETECTED was decided by the\n` +
        `   per-mutant clock, over a ceiling of ${ceiling}%. The score above is reported\n` +
        "   rather than relied on: too much of it is a fact about this machine.\n" +
        "   Investigate the mutants that hang, or run this where it is not contended.",
    };
  }

  return { failed: false, measured: true, message: report };
};

/**
 * The whole accounting step, from a captured transcript to a verdict.
 * @param {string|null} output - Stryker's combined output, or null.
 * @param {string} cwd - Project root.
 * @returns {{failed: boolean, measured: boolean, message: string}} The block,
 *   whether a tally was read, and whether it fails.
 */
export const accountForTimeouts = (output, cwd) => {
  const tally = parseMutantTally(output);
  if (tally === null)
    return { failed: false, measured: false, message: unmeasuredBlock() };
  return judgeTimeoutAccounting(
    tally,
    resolveBreakThreshold(cwd),
    resolveTimeoutShareCeiling()
  );
};

/**
 * How many of Stryker's last lines an unrecognised failure quotes back.
 * @type {number}
 */
const MAX_TAIL_LINES = 5;

/**
 * Longest tail line quoted back, so one enormous line cannot flood a hook.
 * @type {number}
 */
const MAX_TAIL_WIDTH = 200;

/**
 * The last lines that carry anything, for a failure nothing else recognised.
 * @param {string} output - Stryker's combined output.
 * @returns {string[]} Up to `MAX_TAIL_LINES` quoted lines, oldest first.
 */
const tailOf = output => {
  const lines = output
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .slice(-MAX_TAIL_LINES)
    .map(line => `   | ${line.slice(0, MAX_TAIL_WIDTH)}`);
  return lines.length > 0 ? lines : ["   | (Stryker printed nothing)"];
};

/**
 * How many mutants the clock decided.
 *
 * The clear-text table is preferred and the progress line is the fallback,
 * because they are not the same quantity: the table is the run's FINAL count
 * and the progress line is a running tally printed every ten seconds, which
 * stops wherever the last tick landed. Reading the running one when the final
 * one is available under-reports, and this number goes into a message about how
 * much of a score the clock decided.
 * @param {string} output - Stryker's combined output.
 * @returns {number} The count, or 0 when neither surface reported one.
 */
const timedOutMutants = output => {
  const tally = parseMutantTally(output);
  if (tally !== null) return tally.timedOut;
  const tallies = [...output.matchAll(TIMED_OUT_MUTANTS_PATTERN)];
  return tallies.length === 0 ? 0 : Number(tallies[tallies.length - 1][1]);
};

/**
 * A clause saying a budget was nobody's decision, when that is true of it.
 * @param {{inherited: string[]}} budgets - From `resolveTimeoutBudgets`.
 * @param {string} key - The option to describe.
 * @returns {string} The clause, or `""` when the project declared the value.
 */
const inheritedNote = (budgets, key) =>
  budgets.inherited.includes(key)
    ? ` (Stryker's own default — no "${key}" in your Stryker config)`
    : "";

/**
 * The block printed when a dry run ran out of wall clock.
 * @param {{dryRunTimeoutMinutes: number, inherited: string[]}} budgets - The
 *   budgets in force.
 * @returns {{outcome: string, message: string}} The marker and the block.
 */
const dryRunTimeoutVerdict = budgets => ({
  outcome: OUTCOMES.dryRunTimeout,
  message:
    `❌ ${OUTCOMES.dryRunTimeout}\n` +
    "   Stryker's initial, UN-MUTATED test run exceeded its wall-clock budget of\n" +
    `   ${budgets.dryRunTimeoutMinutes} minute(s)` +
    `${inheritedNote(budgets, "dryRunTimeoutMinutes")} and was killed.\n` +
    "   NO mutant was generated and NO score was computed. This is a TIMEOUT, not\n" +
    "   a mutation score below thresholds.break, and it says nothing at all about\n" +
    "   your tests.\n" +
    '   Raise "dryRunTimeoutMinutes" in your Stryker config if the suite simply\n' +
    "   needs longer on this machine; investigate a hang if it does not.",
});

/**
 * The block printed when a completed run scored under `thresholds.break`.
 * @param {readonly string[]} broke - `[, score, threshold]` from Stryker.
 * @param {string} output - Stryker's combined output.
 * @param {{timeoutMS: number, inherited: string[]}} budgets - Budgets in force.
 * @returns {{outcome: string, message: string}} The marker and the block.
 */
const scoreBelowBreakVerdict = (broke, output, budgets) => {
  const timedOut = timedOutMutants(output);
  const clockNote =
    timedOut > 0
      ? `\n   ${timedOut} mutant(s) also hit the per-mutant budget of ` +
        `${budgets.timeoutMS}ms${inheritedNote(budgets, "timeoutMS")}.\n` +
        "   Stryker scores a timed-out mutant as KILLED, so that part of the score\n" +
        "   above was decided by the clock rather than by an assertion."
      : "";
  const verdict =
    `❌ ${OUTCOMES.scoreBelowBreak}\n` +
    `   Stryker ran to completion and scored ${broke[1]} against a break\n` +
    `   threshold of ${broke[2]}. This one IS a verdict about your tests.`;
  return {
    outcome: OUTCOMES.scoreBelowBreak,
    message: `${verdict}${clockNote}`,
  };
};

/**
 * The block printed when nothing in the transcript was recognised.
 * @param {string|null} output - Stryker's combined output, or null.
 * @param {{timeoutMS: number, dryRunTimeoutMinutes: number,
 *   inherited: string[]}} budgets - The budgets in force.
 * @returns {{outcome: string, message: string}} The marker and the block.
 */
const runFailedVerdict = (output, budgets) => {
  if (output === null) {
    return {
      outcome: OUTCOMES.runFailed,
      message:
        `❌ ${OUTCOMES.runFailed}\n` +
        "   Stryker's output could not be captured on this machine, so this gate\n" +
        "   cannot say WHICH failure it was — read Stryker's own output above.\n" +
        `   Budgets in force: dryRunTimeoutMinutes=${budgets.dryRunTimeoutMinutes}` +
        `${inheritedNote(budgets, "dryRunTimeoutMinutes")}, ` +
        `timeoutMS=${budgets.timeoutMS}${inheritedNote(budgets, "timeoutMS")}.\n` +
        "   Nothing here claims your mutation score was below thresholds.break.",
    };
  }
  const tail = tailOf(output).join("\n");
  return {
    outcome: OUTCOMES.runFailed,
    message:
      `❌ ${OUTCOMES.runFailed}\n` +
      "   Stryker exited nonzero without reporting a timeout and without reporting a\n" +
      "   score under thresholds.break, so this gate does NOT claim your tests are\n" +
      `   weak. Its last lines were:\n${tail}`,
  };
};

/**
 * Say WHY Stryker failed, from Stryker's own output.
 *
 * ## The defect this exists to close
 *
 * A dry run killed by its wall-clock budget and a suite whose tests are
 * genuinely weak leave the gate in the same place: one nonzero exit. Reported
 * as a mutation score, the first one is false twice over — no score was
 * computed, and no test is weak — and it is told to the operator LEAST able to
 * argue with it, because the way to hit it is to own a slower machine than the
 * person who picked the budget.
 *
 * So a timeout is reported as a timeout with the budget that ended it named,
 * and the word "score" appears only where a score was actually measured.
 * @param {string|null|undefined} output - Stryker's combined output, or null
 *   when this machine could not capture it.
 * @param {{timeoutMS: number, dryRunTimeoutMinutes: number,
 *   inherited: string[]}} budgets - From `resolveTimeoutBudgets`.
 * @returns {{outcome: string, message: string}} The marker and the block.
 */
export const classifyStrykerFailure = (output, budgets) => {
  if (typeof output !== "string" || output.length === 0) {
    return runFailedVerdict(null, budgets);
  }
  if (output.includes(DRY_RUN_TIMEOUT_SIGNATURE)) {
    return dryRunTimeoutVerdict(budgets);
  }
  const broke = BREAK_THRESHOLD_PATTERN.exec(output);
  if (broke) return scoreBelowBreakVerdict(broke, output, budgets);
  return runFailedVerdict(output, budgets);
};

/**
 * Read the project-owned gate switch.
 * @param {string} cwd - Project root.
 * @returns {{enabled?: boolean, since?: string}} The gate file, or the default.
 */
export const readGate = cwd => {
  const gatePath = path.join(cwd, "mutation.gate.json");
  if (!fs.existsSync(gatePath)) return { enabled: false, since: "main" };
  try {
    const parsed = JSON.parse(fs.readFileSync(gatePath, "utf8"));
    // `null` and `[1,2]` are both valid JSON and neither is a gate. Returning
    // them would make the caller read `.enabled` off a non-object and die with
    // a TypeError that says nothing about the file that caused it.
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      console.error(
        "⚠️  mutation.gate.json is not a JSON object; using the disabled default."
      );
      return { enabled: false, since: "main" };
    }
    return parsed;
  } catch (error) {
    console.error(`⚠️  Could not parse mutation.gate.json: ${error.message}`);
    return { enabled: false, since: "main" };
  }
};

/**
 * A boolean environment override, or undefined when unset.
 * @param {string} name - Variable name.
 * @returns {boolean | undefined} The override.
 */
export const envFlag = name => {
  const value = process.env[name];
  if (value === undefined) return undefined;
  return value === "true" || value === "1";
};

/**
 * Run git, returning trimmed stdout.
 *
 * stderr is discarded on purpose: the merge-base probes below try candidate
 * refs that are EXPECTED not to exist, and the caller decides what a failure
 * means.
 * @param {string} cwd - Project root.
 * @param {readonly string[]} args - Git arguments.
 * @returns {string} Trimmed stdout.
 */
const git = (cwd, args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

/**
 * The merge-base to diff against, preferring the remote ref.
 *
 * CI checks out detached, so `origin/<ref>` is tried first and the local name
 * second.
 * @param {string} cwd - Project root.
 * @param {string} since - Configured base ref.
 * @returns {string} The merge-base sha, or `""` when none resolves.
 */
export const resolveDiffBase = (cwd, since) => {
  for (const ref of [`origin/${since}`, since]) {
    try {
      const resolved = git(cwd, ["merge-base", ref, "HEAD"]);
      if (resolved) return resolved;
    } catch {
      /* try the next candidate */
    }
  }
  return "";
};

/**
 * How many tracked files the project's patterns select.
 *
 * This is the difference between "this branch changed nothing we mutate" and
 * "this gate can never mutate anything". Both produce an empty selection; only
 * one of them is a defect, and without this probe the defect is invisible
 * forever.
 * @param {string} cwd - Project root.
 * @param {{include: RegExp[], exclude: RegExp[]}} patterns - Compiled matchers.
 * @returns {number} How many tracked files the patterns select.
 */
export const countMutateTargetsInRepo = (cwd, patterns) => {
  try {
    return git(cwd, ["ls-files"])
      .split("\n")
      .filter(file => file && isMutateTarget(file, patterns)).length;
  } catch {
    // An unreadable index is not evidence of an inert config, so report a
    // target and let the run proceed. Failing here would block pushes for a
    // reason that has nothing to do with mutation testing.
    return 1;
  }
};

/**
 * Files changed on this branch that this project mutates.
 * @param {string} cwd - Project root.
 * @param {string} base - Merge-base sha.
 * @param {{include: RegExp[], exclude: RegExp[]}} patterns - Compiled matchers.
 * @returns {{changed: number, selected: string[]}} Totals and selection.
 */
export const selectChangedTargets = (cwd, base, patterns) => {
  const changed = git(cwd, [
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
    `${base}...HEAD`,
  ])
    .split("\n")
    .map(file => file.trim())
    .filter(Boolean);
  return {
    changed: changed.length,
    selected: changed
      .filter(file => isMutateTarget(file, patterns))
      .filter(file => fs.existsSync(path.join(cwd, file))),
  };
};

/**
 * How much of Stryker's transcript is kept. Every signature read above is near
 * the end of it, and a large mutation run prints megabytes.
 * @type {number}
 */
const CAPTURE_TAIL_BYTES = 256 * 1024;

/**
 * Whether this machine can tee Stryker's output without changing its verdict.
 *
 * Probed rather than assumed: on a shell with no `tee` the wrapper below writes
 * no status file, and a gate that cannot read a status file must not guess one.
 * `MUTATION_CAPTURE=0` opts out and buys back Stryker's TTY progress bar, at
 * the cost of the diagnosis.
 * @returns {boolean} Whether to take the capturing path.
 */
const captureAvailable = () => {
  if (process.env.MUTATION_CAPTURE === "0") return false;
  if (process.platform === "win32") return false;
  const probe = spawnSync("sh", ["-c", "command -v tee"], { stdio: "ignore" });
  return !probe.error && probe.status === 0;
};

/**
 * The Stryker entry point to run, local install preferred.
 * @param {string} cwd - Project root.
 * @returns {{file: string, args: string[]}} Program and its leading arguments.
 */
const strykerEntry = cwd => {
  const bin = path.join(
    cwd,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "stryker.cmd" : "stryker"
  );
  return fs.existsSync(bin)
    ? { file: bin, args: ["run"] }
    : { file: "npx", args: ["--yes", "stryker", "run"] };
};

/**
 * Read back what the wrapper recorded, keeping only the tail of the log.
 *
 * Fail closed on the status: an unreadable status is not a zero. Turning "I do
 * not know" into "it passed" is the one mistake a gate may never make.
 * @param {string} statusPath - File the wrapper wrote the exit code into.
 * @param {string} logPath - File the wrapper tee'd the output into.
 * @returns {{code: number, output: string|null}} The recorded answer.
 */
const readCaptured = (statusPath, logPath) => {
  let output = null;
  try {
    output = fs.readFileSync(logPath, "utf8").slice(-CAPTURE_TAIL_BYTES);
  } catch {
    output = null;
  }
  try {
    const code = Number.parseInt(
      fs.readFileSync(statusPath, "utf8").trim(),
      10
    );
    return { code: Number.isInteger(code) ? code : 1, output };
  } catch {
    return { code: 1, output };
  }
};

/**
 * Run Stryker with stdio inherited, capturing nothing.
 * @param {string} cwd - Project root.
 * @param {{file: string, args: string[]}} entry - Program and arguments.
 * @param {NodeJS.ProcessEnv} env - Environment for the child.
 * @returns {{code: number, output: null}} Exit status.
 */
const runStrykerPlain = (cwd, entry, env) => {
  const result = spawnSync(entry.file, entry.args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env,
  });
  return { code: result.status ?? 1, output: null };
};

/**
 * The shell wrapper that runs the program while keeping a copy of its output.
 *
 * A CONSTANT, with no interpolation of any kind, and that is the invariant
 * rather than a stylistic preference. `$1` and `$2` are the two scratch paths;
 * `shift 2` leaves `"$@"` holding exactly the program's own arguments, and `$0`
 * is untouched by shift. Every expansion is quoted, so nothing is word-split
 * and nothing is re-read as syntax.
 *
 * Exported so the invariant is testable. It used to be a template literal with
 * the two scratch paths single-quoted into it, directly beneath a doc comment
 * promising that every path travelled as argv — a promise nothing checked, and
 * one the code did not keep. Both paths derive from `TMPDIR`, so a `TMPDIR`
 * containing a single quote closed the quote and handed the rest to the shell.
 * @type {string}
 */
export const CAPTURE_WRAPPER =
  'status="$1"\n' +
  'log="$2"\n' +
  "shift 2\n" +
  '{ "$0" "$@"\n' +
  'echo $? > "$status"\n' +
  '} 2>&1 | tee "$log"\n';

/**
 * Run Stryker, streaming its output AND keeping a copy to diagnose it from.
 *
 * The program and every path argument travel as argv through `"$0" "$@"`
 * rather than being interpolated into the script. Interpolating them would put
 * a filename through the shell's word splitting, which is how a path with a
 * space becomes two paths that do not exist — and Stryker would then mutate
 * neither, find nothing, and exit 0.
 *
 * That promise used to cover only Stryker's own arguments. The two scratch
 * paths were single-quoted straight into the script text, and both derive from
 * `mkdtempSync(path.join(os.tmpdir(), …))`, so both carry `TMPDIR` — attacker-
 * adjacent on a shared machine and merely hostile on a normal one. A `TMPDIR`
 * containing a single quote closed the quote and handed the rest of the path to
 * the shell as syntax. They now arrive as `$1` and `$2` and are shifted off
 * before `"$@"` is expanded, so the doc comment above describes the code.
 *
 * The exit code comes from a status file written INSIDE the pipeline, never
 * from the pipeline itself: a pipeline reports `tee`'s status, which is
 * essentially always zero, and reading it would report every failing gate as
 * passing.
 * @param {string} cwd - Project root.
 * @param {{file: string, args: string[]}} entry - Program and arguments.
 * @param {NodeJS.ProcessEnv} env - Environment for the child.
 * @returns {{code: number, output: string|null}|null} The answer, or null when
 *   a scratch directory could not be made and the caller should fall back.
 */
const runStrykerCaptured = (cwd, entry, env) => {
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-mutation-"));
  } catch {
    return null;
  }
  const logPath = path.join(dir, "stryker.log");
  const statusPath = path.join(dir, "status");
  try {
    const child = spawnSync(
      "sh",
      ["-c", CAPTURE_WRAPPER, entry.file, statusPath, logPath, ...entry.args],
      {
        cwd,
        stdio: "inherit",
        env,
      }
    );
    if (child.error) return { code: 1, output: null };
    return readCaptured(statusPath, logPath);
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
};

/**
 * Hand the selected files to Stryker.
 *
 * `selected` empty means the WHOLE LIST: `--mutate` is omitted entirely so the
 * project's committed patterns stand, which is what `--all` asks for. It is not
 * reachable by accident — an empty diff selection is reported as
 * `nothing-to-mutate` and returns long before here.
 * @param {string} cwd - Project root.
 * @param {readonly string[]} selected - Repository-relative paths, or empty for
 *   the project's own `mutate` patterns.
 * @returns {{code: number, output: string|null}} Stryker's status, and its
 *   output when this machine could keep a copy.
 */
const runStryker = (cwd, selected) => {
  const scope = selected.join(",");
  const base = strykerEntry(cwd);
  const entry = {
    file: base.file,
    args: scope === "" ? base.args : [...base.args, "--mutate", scope],
  };
  const env = {
    ...process.env,
    // What the run was scoped to, for a test-runner config that wants to
    // narrow with it. A project that ignores it loses nothing, and a project
    // that reads it can only ever REMOVE suites — which removes kills and
    // lowers the score — so no value of this can turn a failing gate green.
    MUTATION_SCOPE: scope,
  };
  if (!captureAvailable()) return runStrykerPlain(cwd, entry, env);
  return (
    runStrykerCaptured(cwd, entry, env) ?? runStrykerPlain(cwd, entry, env)
  );
};

/**
 * The argument that mutates the project's whole `mutate` list, not a diff.
 *
 * The whole-list run used to be `stryker run` invoked directly, which meant it
 * bypassed this gate entirely — and with it the timeout accounting, on the one
 * run big enough for the timeout bucket to be worth anything. It is the same
 * gate either way now; only the scope differs.
 * @type {string}
 */
export const WHOLE_LIST_FLAG = "--all";

/**
 * Report a completed Stryker run, and decide what its status should be.
 *
 * ## The two things a completed run is judged on
 *
 * Stryker's own verdict stands and is never overturned — nothing here can make
 * a failing run pass. What is added is the accounting that Stryker does not do:
 * it scores a timed-out mutant as KILLED, so part of every score it reports was
 * decided by how busy the machine was rather than by an assertion. That part is
 * measured, printed, and — when it is what carried the run over the floor —
 * failed on. See {@link timeoutAccounting}.
 * @param {string} cwd - Project root.
 * @param {{code: number, output: string|null}} result - From `runStryker`.
 * @returns {number} The exit code the caller should use.
 */
const reportRun = (cwd, result) => {
  const accounting = accountForTimeouts(result.output, cwd);
  if (result.code !== 0) {
    // Stryker's own verdict stands; what is added is WHICH failure it was. The
    // gate used to end here on a bare status, and the hook above it then had to
    // guess — which it did, out loud, as "mutation score below threshold", for
    // dry runs that never computed a score at all.
    console.error(
      classifyStrykerFailure(result.output, resolveTimeoutBudgets(cwd)).message
    );
    // A failure that produced no table produced no score either — a dry run
    // killed by the clock is the common case — so the unmeasured warning would
    // be noise on top of a failure that has already explained itself. A failure
    // that DID produce one still gets the honest recomputation: a run under the
    // floor is under it by more than Stryker said.
    if (accounting.measured) console.error(accounting.message);
    return result.code;
  }
  if (accounting.failed) {
    console.error(accounting.message);
    return 1;
  }
  console.log(accounting.message);
  return 0;
};

/**
 * The whole gate, as one function so it can be driven from a test.
 * @param {string} [cwd] - Project root; defaults to the process working dir.
 * @param {readonly string[]} [argv] - Arguments after the script name.
 * @returns {number} The exit code the caller should use.
 */
export const runGate = (cwd = process.cwd(), argv = []) => {
  const gate = readGate(cwd);
  const enabled = envFlag("MUTATION_ENABLED") ?? gate.enabled === true;
  const since = process.env.MUTATION_SINCE || gate.since || "main";

  if (!enabled) {
    console.log(
      `⚪ ${OUTCOMES.disabled} — mutation.gate.json says "enabled": false. Skipping.\n` +
        '   Flip "enabled": true (and tune thresholds.break in stryker.conf.json) to turn it on.'
    );
    return 0;
  }

  const declaration = resolveMutateDeclaration(cwd);
  const patterns = compileMutatePatterns(declaration.mutate);

  if (countMutateTargetsInRepo(cwd, patterns) === 0) {
    console.error(
      `❌ ${OUTCOMES.inertConfig}\n` +
        `   The mutate patterns from ${declaration.source} select NO tracked file\n` +
        "   in this repository, so this gate can never generate a mutant and would\n" +
        "   report success on every run forever. That is not a pass — it is a gate\n" +
        "   that is switched on and wired to nothing.\n" +
        "   Fix the `mutate` patterns in your Stryker config, or turn the gate off."
    );
    return 1;
  }

  if (argv.includes(WHOLE_LIST_FLAG)) {
    console.log(
      `🧬 ${OUTCOMES.wholeList} — Stryker over every pattern in ` +
        `${declaration.source}, with no diff scoping.`
    );
    return reportRun(cwd, runStryker(cwd, []));
  }

  const base = resolveDiffBase(cwd, since);
  if (!base) {
    console.log(
      `⚪ ${OUTCOMES.noBase} — no merge-base against "${since}" (shallow clone or\n` +
        "   unknown ref). Skipping rather than mutating the whole repository.\n" +
        "   Nothing was measured; this is not a mutation score."
    );
    return 0;
  }

  let scope;
  try {
    scope = selectChangedTargets(cwd, base, patterns);
  } catch (error) {
    // Was a warning and an exit 0, with no outcome marker — the only exit in
    // this module shaped that way. Both halves were wrong in the same
    // direction. A git prerequisite that failed AFTER a merge-base resolved is
    // an anomaly, not a clean tree, and reporting it as a pass is the silent
    // green this whole file exists to refuse. The marker matters just as much:
    // a test asserting the gate did not no-op could not observe this path at
    // all, so the one exit that lied was also the one exit nothing could see.
    //
    // The genuinely-cannot-measure cases are already handled above and keep
    // their exit 0: a disabled gate, and a merge-base that does not resolve.
    console.error(
      `❌ ${OUTCOMES.diffFailed}\n` +
        `   Could not compute the files changed vs ${since}: ${error.message}\n` +
        "   NO mutant was generated and NO score was computed. Nothing was measured,\n" +
        "   so nothing passed."
    );
    return 1;
  }

  if (scope.selected.length === 0) {
    console.log(
      `⚪ ${OUTCOMES.nothingToMutate}\n` +
        `   ${scope.changed} file(s) changed vs ${since}; 0 of them are mutate targets\n` +
        `   under the patterns from ${declaration.source}.\n` +
        "   NO mutant was generated and NO score was computed. Nothing was measured,\n" +
        "   so nothing passed — do not read this as evidence about your tests."
    );
    return 0;
  }

  // `--mutate` is one comma-separated argument, so a path containing a comma
  // reaches Stryker as two paths that do not exist. It would mutate neither,
  // find nothing, and exit 0 — the silent-green shape again, arriving through a
  // filename. Refusing is the safe direction: a push blocked by a name nobody
  // can act on is loud, and a gate that quietly measured nothing is not.
  const unrepresentable = scope.selected.filter(file => file.includes(","));
  if (unrepresentable.length > 0) {
    const listed = unrepresentable.map(file => `   • ${file}`).join("\n");
    console.error(
      `❌ ${OUTCOMES.unrepresentablePath}\n` +
        "   Stryker takes --mutate as ONE comma-separated argument, so these paths\n" +
        "   cannot be passed to it without being split into paths that do not exist:\n" +
        `${listed}\n` +
        "   Rename them, or exclude them in your Stryker config."
    );
    return 1;
  }

  console.log(
    `🧬 ${OUTCOMES.scoped} — Stryker on ${scope.selected.length} of ` +
      `${scope.changed} changed file(s), selected by ${declaration.source}:`
  );
  for (const file of scope.selected) console.log(`   • ${file}`);

  return reportRun(cwd, runStryker(cwd, scope.selected));
};

/**
 * CLI entry point.
 * @returns {void}
 */
export const runCli = () => {
  process.exit(runGate(process.cwd(), process.argv.slice(2)));
};

if (invokedAsScript(import.meta.url)) runCli();
