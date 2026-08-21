#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file Name every gate family that runs at the commit-msg moment.
 *
 * ## The defect this removes
 *
 * More than one INDEPENDENT gate family bites at `commit-msg`, and until this
 * file existed only one of them introduced itself. `lisa-work-item.mjs` prints
 * a five-gate checklist on any traceability refusal — deliberately scoped to
 * the traceability contract, which is the only contract it owns. At the same
 * moment the hook also runs commitlint and an AI co-authorship check, and
 * neither said so until it fired. An operator could satisfy every requirement
 * the checklist named and still be refused, twice, for reasons nothing had
 * mentioned. Measured: two sessions in one day each cleared the named gates and
 * were bounced by the co-authorship trailer.
 *
 * ## Why it is a third file rather than a sixth line
 *
 * The obvious fix — append the co-authorship gate to `gateSummary` — was
 * rejected upstream and the reasoning is worth keeping. `gateSummary` lives in
 * `lisa-work-item.mjs`, which does not own the co-authorship check, cannot
 * verify it, and cannot know whether a given host project installs it. A
 * checklist that confidently names a gate a project does not have is worse than
 * one that stays silent, for the same reason the traceability checklist reads
 * role names from the resolved contract instead of hardcoding Lisa's defaults.
 * And folding an unrelated family into a list headed "All five gates" makes the
 * count wrong in a new direction, which is the precise defect that list exists
 * to remove.
 *
 * So this module is owned by neither check. It answers one question — what runs
 * at commit-msg in THIS project — and both families call it on refusal.
 *
 * ## Why the answer is read off the hook rather than declared
 *
 * The families are detected from the INVOCATIONS in the project's own
 * `commit-msg` hook: `validate-commit`, `commitlint --edit`, the co-authorship
 * `grep`. That is the file that is doing the refusing, so it is the only
 * honest authority on what a commit here must survive.
 *
 * A marker comment the hook declares would read more cleanly and was the first
 * design. It fails on the case that matters: a host that deletes a block keeps
 * whatever the block was declared to be somewhere else, and an installed hook
 * predating the marker declares nothing at all — so the summary would either
 * name a gate that no longer runs or name none of them. Detecting the call
 * degrades the right way in both directions.
 *
 * Every candidate hook path is read and the results unioned, because "the
 * commit-msg hook" is not one path: husky 8 points git straight at
 * `.husky/commit-msg`, husky 9 interposes `.husky/_/commit-msg`, and a project
 * using neither has `.git/hooks/commit-msg`. Reading only the one git invoked
 * would answer "no families" for the husky 9 shim, which contains no gate at
 * all.
 *
 * Usage:
 *   lisa-commit-msg-gates.mjs list [--hook <path>] [--refused <family-id>]
 *
 * Always exits 0. This runs only on a refusal that has already decided to fail
 * the commit; it must never be the reason a commit is refused, and it must
 * never turn a refusal into a crash.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * The gate families that can run at `commit-msg`, in the order the hook runs
 * them — which is the order an operator meets them, one refusal at a time.
 *
 * `detect` matches the ENFORCING invocation, never prose. The co-authorship
 * block in particular carries a long comment that names the trailer it checks
 * for; a project that deleted the check and left the comment would still be
 * told the gate runs, which is the failure this whole file exists to remove.
 *
 * `id` is the registry gate id where the registry has one. `ai-coauthorship`
 * has none — no declaration in `.lisa.config.json` governs it — and that is
 * recorded here rather than papered over with an invented name.
 */
export const FAMILIES = Object.freeze([
  Object.freeze({
    id: "traceability",
    title: "Work-Item traceability",
    detect: /validate-commit/,
    requirement:
      "Every commit message carries one matching `Work-Item:` trailer for a live tracker item. Its own refusal prints the full five-gate checklist.",
  }),
  Object.freeze({
    id: "commit-conformance",
    title: "Conventional commit format",
    detect: /commitlint[\s\S]{0,40}--edit/,
    requirement:
      "The subject reads `<type>(<optional scope>): <subject>`, and the body obeys the project's commitlint rules.",
  }),
  Object.freeze({
    id: "ai-coauthorship",
    title: "AI co-authorship",
    detect: /grep[^\n]{0,20}-Eiq[^\n]{0,10}"Co-authored-by:/i,
    requirement:
      "The message carries a `Co-authored-by:` trailer naming a supported coding agent — Claude, Codex, or OpenCode. OpenCode also needs `AI-Agent`, `AI-Model` and `AI-Effort` trailers.",
  }),
]);

/**
 * Where a `commit-msg` hook can live, cwd-relative.
 *
 * git runs hooks from the repository root, so relative paths are the right
 * spelling and they keep this readable in the diagnostics a test asserts on.
 */
const HOOK_NAME = "commit-msg";
const HOOK_CANDIDATES = Object.freeze([
  join(".husky", HOOK_NAME),
  join(".husky", "_", HOOK_NAME),
  join(".git", "hooks", HOOK_NAME),
]);

/**
 * Read every commit-msg hook this project has.
 * @param {string | null} explicitPath - A hook path the caller knows, or null.
 * @returns {string[]} Hook sources; empty when none can be read.
 */
export function readHookSources(explicitPath) {
  const paths = explicitPath
    ? [explicitPath, ...HOOK_CANDIDATES]
    : [...HOOK_CANDIDATES];
  const seen = new Set();
  const sources = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    if (!existsSync(path)) continue;
    try {
      sources.push(readFileSync(path, "utf8"));
    } catch {
      // Unreadable is the same as absent for this purpose. A permissions error
      // on one candidate must not cost the operator the families the others
      // would have named.
    }
  }
  return sources;
}

/**
 * Which families any of these hook sources actually installs.
 * @param {string[]} sources - Hook sources.
 * @returns {object[]} Families present, in registry order.
 */
export function detectFamilies(sources) {
  return FAMILIES.filter(family =>
    sources.some(source => family.detect.test(source))
  );
}

/**
 * Wrap one requirement to a readable width under a hanging indent.
 * @param {string} text - The requirement sentence.
 * @param {number} width - Column to wrap at.
 * @returns {string[]} Wrapped lines, without the indent.
 */
function wrap(text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length > 0 && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
      continue;
    }
    line = line.length === 0 ? word : `${line} ${word}`;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** Width the requirement sentences wrap at, under a five-space indent. */
const WRAP_WIDTH = 68;

/**
 * The operator-facing summary.
 *
 * It says the count, says that clearing one proves nothing about the rest, and
 * marks the family that just refused — which is the question an operator
 * reading a wall of hook output actually has. It names ONLY the families
 * detected, so a project that installs one of them is never told it has three.
 * @param {object[]} families - Families this project installs.
 * @param {string | null} refusedId - Family that refused this commit, if known.
 * @returns {string} The summary, or "" when nothing was detected.
 */
export function summary(families, refusedId) {
  if (families.length === 0) return "";
  const plural = families.length === 1 ? "family runs" : "families run";
  const lines = [
    "",
    "──────────────────────────────────────────────────────────────",
    `${families.length} gate ${plural} at the commit-msg moment in this project, and a`,
    "commit must satisfy every one of them. The first refusal stops the",
    "commit, so clearing this one proves nothing about the others.",
    "",
  ];
  families.forEach((family, index) => {
    const mark = family.id === refusedId ? "  ← refused this commit" : "";
    lines.push(`  ${index + 1}. ${family.title}${mark}`);
    for (const wrapped of wrap(family.requirement, WRAP_WIDTH)) {
      lines.push(`     ${wrapped}`);
    }
  });
  lines.push(
    "",
    "Read off what this project's commit-msg hook actually runs, so a",
    "family it does not install is never named here.",
    "──────────────────────────────────────────────────────────────"
  );
  return lines.join("\n");
}

/**
 * Read a `--flag value` pair out of an argument list.
 * @param {string[]} argv - Arguments.
 * @param {string} flag - Flag to read, including its leading dashes.
 * @returns {string | null} The value, or null when absent.
 */
function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0 || index + 1 >= argv.length) return null;
  return argv[index + 1];
}

/**
 * Print the summary for this project.
 *
 * Never throws and never exits non-zero: see the file remarks. The caller is a
 * hook that has already decided to refuse, and a diagnostic that can fail is a
 * diagnostic that turns a clear refusal into a stack trace.
 * @param {string[]} [argv] - Arguments after the command name.
 */
export function runCli(argv = process.argv.slice(2)) {
  try {
    const families = detectFamilies(readHookSources(flagValue(argv, "--hook")));
    const text = summary(families, flagValue(argv, "--refused"));
    if (text.length > 0) process.stdout.write(`${text}\n`);
  } catch {
    // Silence is the correct degradation. The refusal the caller is about to
    // print is the message that matters.
  }
}

if (invokedAsScript(import.meta.url)) {
  runCli();
}
