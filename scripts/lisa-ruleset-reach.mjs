#!/usr/bin/env node

/**
 * @file Report a branch ruleset that governs no branch in the repository.
 *
 * GitHub accepts a `conditions.ref_name.include` entry naming a branch that
 * does not exist. The entries are patterns, not references, so neither the API
 * nor any Lisa surface validates them against the repository's actual heads. A
 * ruleset can therefore be live, active, and matching nothing — and every
 * surface reads it as healthy:
 *
 * - `health/ruleset-inspection`'s `compareRulesets` holds the template against
 *   the live ruleset by string equality. Template says `refs/heads/dev`, live
 *   says `refs/heads/dev`, so it is not drifted. It is a template-conformance
 *   check and cannot be a governance-reach check.
 * - `cli/ui-github-repo-map`'s `mapRulesetRow` parses includes, but as a
 *   literal match on `~DEFAULT_BRANCH`, and its consumer ORs across rows. One
 *   governing row makes the whole answer green and masks every other row.
 *
 * Measured on this repository: a live ruleset included `refs/heads/dev` and
 * `refs/heads/staging` while `git ls-remote --heads` listed 82 heads and not
 * one of those two names. Harmless there only because `~DEFAULT_BRANCH` sat
 * beside them. Where nothing sits beside them — a shipped ruleset whose whole
 * include list is `["refs/heads/dev"]` — the gate governs nothing, and the
 * operator finds out at the moment they are blocked. Moving that discovery
 * earlier is the entire job of this module.
 *
 * ## Report only, and deliberately so
 *
 * Nothing here creates a branch, edits an include list, or disables a ruleset.
 * Every one of those is an automated actor LOOSENING a control it was not
 * asked to loosen: creating the branch manufactures the very ref the ruleset
 * was written to protect, and disabling the ruleset gives up a protection
 * somebody chose. What this owes the operator is the ruleset's name and the
 * patterns that matched nothing — which is precisely what nothing gave them.
 *
 * ## Three answers, never two
 *
 * `governs` / `zero-reach` / `undetermined`. The third is not a soft second.
 * An unreadable branch list, an unmodelled pattern, and a `~DEFAULT_BRANCH`
 * whose default branch could not be resolved all mean the same thing: this run
 * does not know. Collapsing that into `governs` reports a repository clean on
 * the strength of a read that never happened; collapsing it into `zero-reach`
 * sends an operator to investigate a ruleset that is probably fine, and a
 * report an operator learns to ignore protects nothing.
 *
 * Usage:
 *   lisa-ruleset-reach.mjs --rulesets=FILE [--branches=FILE]
 *                          [--default-branch=NAME] [--format=text|json]
 * @module lisa-ruleset-reach
 */

import { readFileSync } from "node:fs";

import { invokedAsScript } from "../all/copy-overwrite/scripts/lib/invoked-as-script.mjs";

/** GitHub's token for "every ref this target covers". */
const ALL_REFS = "~ALL";

/** GitHub's token for the repository's default branch. */
const DEFAULT_BRANCH_REF = "~DEFAULT_BRANCH";

/** The prefix a fully qualified branch pattern carries. */
const HEADS_PREFIX = "refs/heads/";

/** The only enforcement level that governs anything at merge time. */
const ACTIVE = "active";

/** The only ruleset target whose ref patterns name branches. */
const BRANCH_TARGET = "branch";

/**
 * Glob metacharacters this module does not model.
 *
 * Bracket expressions and brace alternation are legal fnmatch, and a wrong
 * expansion of either produces a false `zero-reach` — the one outcome that
 * costs an operator a trip to a ruleset that is fine. A pattern carrying one
 * is answered `undetermined` instead, which is what the third answer is for.
 */
const UNMODELLED_GLOB = /[[\]{}]/u;

/**
 * Every glob construct and regex metacharacter, in one alternation.
 *
 * One pass, deliberately. A chain of `.split().join()` calls needs a sentinel
 * to hold a half-translated token, and a sentinel is a string that can appear
 * in a branch name — so the translation would depend on what the repository
 * happens to have named a branch. Matching the longest construct first makes
 * the pass unambiguous without one.
 */
const GLOB_TOKEN = /\/\*\*\/|\*\*|\*|\?|[.+^$()|\\]/gu;

/** What each construct becomes in the anchored matcher. */
const GLOB_TRANSLATION = Object.freeze({
  "/**/": "/(?:.*/)?",
  "**": ".*",
  "*": "[^/]*",
  "?": "[^/]",
});

/**
 * Translate one fnmatch branch pattern into an anchored regular expression.
 *
 * `*` stops at a path separator and `**` crosses it, matching how GitHub
 * documents ruleset ref patterns. A `/` `**` `/` run additionally collapses to
 * nothing, so `releases/` `**` `/*` covers `releases/v1` as well as
 * `releases/v1/hotfix` — the reading an author who wrote that pattern intends,
 * and the one whose absence would report a governing ruleset as reaching
 * nothing.
 * @param {string} glob The pattern, without its `refs/heads/` prefix.
 * @returns {RegExp} An anchored matcher.
 */
export function globToRegExp(glob) {
  const pattern = glob.replace(
    GLOB_TOKEN,
    token => GLOB_TRANSLATION[token] ?? `\\${token}`
  );
  return new RegExp(`^${pattern}$`, "u");
}

/**
 * Whether one include/exclude entry matches one branch.
 * @param {string} pattern One `conditions.ref_name` entry.
 * @param {string} branch One branch name, unqualified.
 * @param {string|undefined} defaultBranch The repository's default branch.
 * @returns {boolean|null} The verdict, or null when it cannot be determined.
 */
export function refPatternMatches(pattern, branch, defaultBranch) {
  if (typeof pattern !== "string" || pattern.length === 0) return null;
  if (pattern === ALL_REFS) return true;
  if (pattern === DEFAULT_BRANCH_REF) {
    return defaultBranch === undefined ? null : branch === defaultBranch;
  }
  // Any other `~` token is one GitHub added and this module has never seen.
  // Guessing at it in either direction is a claim this run cannot support.
  if (pattern.startsWith("~")) return null;
  if (!pattern.startsWith(HEADS_PREFIX)) return null;
  const glob = pattern.slice(HEADS_PREFIX.length);
  return UNMODELLED_GLOB.test(glob) ? null : globToRegExp(glob).test(branch);
}

/**
 * Whether any entry matches, preserving "cannot tell" over "no".
 * @param {readonly string[]} patterns The entries to test.
 * @param {string} branch One branch name.
 * @param {string|undefined} defaultBranch The repository's default branch.
 * @returns {boolean|null} True on a match, null when any entry is unmodelled.
 */
function anyMatches(patterns, branch, defaultBranch) {
  const verdicts = patterns.map(pattern =>
    refPatternMatches(pattern, branch, defaultBranch)
  );
  if (verdicts.includes(true)) return true;
  return verdicts.includes(null) ? null : false;
}

/**
 * Read one ruleset's include and exclude entries.
 * @param {object} ruleset One detailed ruleset payload.
 * @returns {{include: unknown[], exclude: unknown[]}|null} The entries, or null
 *   when the conditions could not be read as a ref-name condition.
 */
function refConditions(ruleset) {
  const conditions = ruleset.conditions;
  if (conditions === null || typeof conditions !== "object") return null;
  const refName = conditions.ref_name;
  if (refName === null || typeof refName !== "object") return null;
  const include = refName.include;
  const exclude = refName.exclude;
  if (!Array.isArray(include)) return null;
  if (exclude !== undefined && !Array.isArray(exclude)) return null;
  return { include, exclude: Array.isArray(exclude) ? exclude : [] };
}

/**
 * Build one classification answer.
 * @param {string} name The ruleset name.
 * @param {string} verdict One of the reach verdicts.
 * @param {readonly string[]} patterns The include patterns, when read.
 * @param {readonly string[]} matched The branches governed, when known.
 * @param {string} reason Why, for every verdict but `governs`.
 * @returns {{name: string, verdict: string, patterns: readonly string[],
 *   matched: readonly string[], reason: string}} The answer.
 */
function answer(name, verdict, patterns, matched, reason) {
  return { name, verdict, patterns, matched, reason };
}

/**
 * Classify a ruleset on its own shape alone, before any branch is consulted.
 *
 * A disabled ruleset governing nothing is a decision somebody made, not a
 * defect, and a tag-target ruleset's ref patterns name tags — comparing either
 * against a branch list would manufacture a finding.
 * @param {object} ruleset One detailed ruleset payload.
 * @param {string} name The ruleset's validated name.
 * @returns {object|null} A terminal answer, or null to keep going.
 */
function shapeVerdict(ruleset, name) {
  const target = ruleset.target ?? BRANCH_TARGET;
  if (typeof target !== "string") {
    return answer(name, "undetermined", [], [], "its target could not be read");
  }
  if (target !== BRANCH_TARGET) {
    return answer(name, "not-branch-target", [], [], `its target is ${target}`);
  }
  if (typeof ruleset.enforcement !== "string") {
    return answer(
      name,
      "undetermined",
      [],
      [],
      "its enforcement could not be read"
    );
  }
  return ruleset.enforcement === ACTIVE
    ? null
    : answer(
        name,
        "inactive",
        [],
        [],
        `its enforcement is ${ruleset.enforcement}`
      );
}

/**
 * Classify the repository state the patterns are about to be tested against.
 * @param {string} name The ruleset's validated name.
 * @param {readonly string[]} patterns The include patterns.
 * @param {readonly string[]|undefined} branches Every branch, or undefined.
 * @param {string|undefined} defaultBranch The default branch name.
 * @returns {object|null} A terminal answer, or null to keep going.
 */
function inputVerdict(name, patterns, branches, defaultBranch) {
  if (!Array.isArray(branches)) {
    return answer(
      name,
      "undetermined",
      patterns,
      [],
      "the repository's branches were not read"
    );
  }
  if (branches.length === 0) {
    return answer(
      name,
      "undetermined",
      patterns,
      [],
      "no branch was readable, which is not the same as a repository with none"
    );
  }
  // A default branch absent from the branch list means the list this run holds
  // is not the repository's. Testing `~DEFAULT_BRANCH` against it would answer
  // "matches nothing" from an input already known to be wrong.
  return defaultBranch === undefined || branches.includes(defaultBranch)
    ? null
    : answer(
        name,
        "undetermined",
        patterns,
        [],
        "the default branch is missing from the branch list this run read"
      );
}

/**
 * The branches one include/exclude pair actually governs.
 * @param {object} input The patterns and repository state.
 * @param {readonly string[]} input.patterns Include entries.
 * @param {readonly unknown[]} input.exclude Exclude entries.
 * @param {readonly string[]} input.branches Every branch the repository has.
 * @param {string|undefined} input.defaultBranch The default branch name.
 * @returns {{matched: readonly string[]}|{reason: string}} The governed
 *   branches, or why this run cannot tell.
 */
function governedBranches({ patterns, exclude, branches, defaultBranch }) {
  const included = branches.map(branch => ({
    branch,
    verdict: anyMatches(patterns, branch, defaultBranch),
  }));
  if (included.some(entry => entry.verdict === null)) {
    return {
      reason: "an include entry uses a pattern this check does not model",
    };
  }
  const candidates = included
    .filter(entry => entry.verdict === true)
    .map(entry => ({
      branch: entry.branch,
      verdict: anyMatches(exclude, entry.branch, defaultBranch),
    }));
  if (candidates.some(entry => entry.verdict === null)) {
    return {
      reason: "an exclude entry uses a pattern this check does not model",
    };
  }
  return {
    matched: candidates
      .filter(entry => entry.verdict === false)
      .map(entry => entry.branch),
  };
}

/**
 * Classify what one ruleset actually governs.
 * @param {object} input The ruleset and the repository state to test it
 *   against.
 * @param {object} input.ruleset One detailed ruleset payload.
 * @param {readonly string[]|undefined} input.branches Every branch the
 *   repository has. `undefined` means unread, which is never "none".
 * @param {string|undefined} input.defaultBranch The default branch name.
 * @returns {{name: string, verdict: string, patterns: readonly string[],
 *   matched: readonly string[], reason: string}} The classification.
 */
export function rulesetReach({ ruleset, branches, defaultBranch }) {
  if (ruleset === null || typeof ruleset !== "object") {
    return answer("", "undetermined", [], [], "the ruleset was not an object");
  }
  const name = typeof ruleset.name === "string" ? ruleset.name : "";
  if (name.length === 0) {
    return answer(
      "",
      "undetermined",
      [],
      [],
      "the ruleset payload has no name"
    );
  }
  const shape = shapeVerdict(ruleset, name);
  if (shape !== null) return shape;
  const conditions = refConditions(ruleset);
  if (conditions === null) {
    return answer(
      name,
      "undetermined",
      [],
      [],
      "its ref-name conditions could not be read"
    );
  }
  const patterns = conditions.include.filter(one => typeof one === "string");
  if (patterns.length !== conditions.include.length) {
    return answer(
      name,
      "undetermined",
      patterns,
      [],
      "an include entry was not a string"
    );
  }
  const inputs = inputVerdict(name, patterns, branches, defaultBranch);
  if (inputs !== null) return inputs;
  const governed = governedBranches({
    patterns,
    exclude: conditions.exclude,
    branches,
    defaultBranch,
  });
  if (governed.matched === undefined) {
    return answer(name, "undetermined", patterns, [], governed.reason);
  }
  return governed.matched.length === 0
    ? answer(
        name,
        "zero-reach",
        patterns,
        [],
        "no branch in this repository matches its include patterns"
      )
    : answer(name, "governs", patterns, governed.matched, "");
}

/**
 * Classify every ruleset a repository holds.
 * @param {object} input The repository state.
 * @param {readonly object[]} input.rulesets Detailed ruleset payloads.
 * @param {readonly string[]|undefined} input.branches Every branch, or
 *   undefined when they were not read.
 * @param {string|undefined} input.defaultBranch The default branch name.
 * @returns {{zeroReach: object[], undetermined: object[], governing: object[]}}
 *   The classification, grouped by what an operator has to act on.
 */
export function sweepRulesetReach({ rulesets, branches, defaultBranch }) {
  const classified = (Array.isArray(rulesets) ? rulesets : []).map(ruleset =>
    rulesetReach({ ruleset, branches, defaultBranch })
  );
  return {
    zeroReach: classified.filter(item => item.verdict === "zero-reach"),
    undetermined: classified.filter(item => item.verdict === "undetermined"),
    governing: classified.filter(item => item.verdict === "governs"),
  };
}

/** The heading a zero-reach report opens with, matched on by its tests. */
export const ZERO_REACH_HEADING =
  "RULESETS THAT GOVERN NO BRANCH — these are active and match nothing, so what they require is not required anywhere:";

/**
 * Render the operator-facing report for one sweep.
 *
 * Empty when there is nothing to say. A sweep that found every ruleset
 * governing something prints NOTHING, which is what keeps the report worth
 * reading on the run where it does print.
 * @param {{zeroReach: readonly object[], undetermined: readonly object[]}} sweep
 *   One sweep.
 * @returns {string} The report, or the empty string.
 */
export function renderReachReport(sweep) {
  const zero =
    sweep.zeroReach.length === 0
      ? []
      : [
          ZERO_REACH_HEADING,
          ...sweep.zeroReach.map(
            item =>
              `  ruleset '${item.name}' matches no branch; its include patterns are: ${item.patterns.join(", ")}`
          ),
          "",
          "  Lisa changed nothing above: creating the branch and disabling the ruleset would both LOOSEN a control nobody asked to loosen.",
          "  Either point the ruleset at a branch this repository has, or retire it deliberately.",
        ];
  const unknown = sweep.undetermined.map(
    item =>
      `  ruleset '${item.name === "" ? "(unnamed)" : item.name}' was NOT checked for reach — ${item.reason}. This is not a clean result.`
  );
  const lines = [...zero, ...unknown];
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/**
 * Read one file, answering undefined rather than throwing.
 * @param {string} file The path to read.
 * @returns {string|undefined} The contents, or undefined when unreadable.
 */
function readTextOrUndefined(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Parse a JSON array of strings, answering undefined rather than throwing.
 * @param {string} text The candidate JSON.
 * @returns {string[]|undefined} The names, or undefined when unparseable.
 */
function parseJsonNames(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed)
      ? parsed.filter(entry => typeof entry === "string")
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read newline- or JSON-delimited branch names from one file.
 * @param {string|undefined} file The file path, when one was given.
 * @returns {string[]|undefined} The names, or undefined when unread.
 */
function readBranchFile(file) {
  if (file === undefined) return undefined;
  const text = readTextOrUndefined(file);
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) return parseJsonNames(trimmed);
  return trimmed.length === 0 ? [] : trimmed.split("\n").map(one => one.trim());
}

/** Read the flags, sweep, and print the report. */
function main() {
  const flag = name => {
    const found = process.argv.find(one => one.startsWith(`--${name}=`));
    return found === undefined ? undefined : found.slice(name.length + 3);
  };
  const rulesetFile = flag("rulesets");
  if (rulesetFile === undefined) {
    throw new Error("--rulesets=FILE is required");
  }
  const defaultBranch = flag("default-branch");
  const sweep = sweepRulesetReach({
    rulesets: JSON.parse(readFileSync(rulesetFile, "utf8")),
    branches: readBranchFile(flag("branches")),
    defaultBranch:
      defaultBranch === undefined || defaultBranch === ""
        ? undefined
        : defaultBranch,
  });
  process.stdout.write(
    flag("format") === "json"
      ? `${JSON.stringify(sweep, null, 2)}\n`
      : renderReachReport(sweep)
  );
}

// Not `import.meta.url === process.argv[1]`: Node resolves the module URL
// through realpath while argv[1] keeps whatever spelling the caller typed, so
// on a symlinked path — a macOS temp dir, a git worktree — they differ and
// main() never runs, printing nothing and exiting 0.
if (invokedAsScript(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
