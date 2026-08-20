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
 * ## Configuration
 *
 * `mutation.gate.json` (project-owned / create-only):
 * `{ "enabled": false, "since": "main" }`.
 * Overridable via env: `MUTATION_ENABLED=true|false`, `MUTATION_SINCE=<ref>`.
 * @module scripts/lisa-mutation
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
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
  scoped: "mutation-gate: scoped-run",
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
 * Hand the selected files to Stryker.
 * @param {string} cwd - Project root.
 * @param {readonly string[]} selected - Repository-relative paths.
 * @returns {number} Stryker's exit status.
 */
const runStryker = (cwd, selected) => {
  const bin = path.join(
    cwd,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "stryker.cmd" : "stryker"
  );
  const local = fs.existsSync(bin);
  const result = spawnSync(
    local ? bin : "npx",
    local
      ? ["run", "--mutate", selected.join(",")]
      : ["--yes", "stryker", "run", "--mutate", selected.join(",")],
    {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
      // What the run was scoped to, for a test-runner config that wants to
      // narrow with it. A project that ignores it loses nothing, and a project
      // that reads it can only ever REMOVE suites — which removes kills and
      // lowers the score — so no value of this can turn a failing gate green.
      env: { ...process.env, MUTATION_SCOPE: selected.join(",") },
    }
  );
  return result.status ?? 1;
};

/**
 * The whole gate, as one function so it can be driven from a test.
 * @param {string} [cwd] - Project root; defaults to the process working dir.
 * @returns {number} The exit code the caller should use.
 */
export const runGate = (cwd = process.cwd()) => {
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
    console.error(`⚠️  Could not compute changed files: ${error.message}`);
    return 0;
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
  return runStryker(cwd, scope.selected);
};

/**
 * CLI entry point.
 * @returns {void}
 */
export const runCli = () => {
  process.exit(runGate());
};

if (invokedAsScript(import.meta.url)) runCli();
