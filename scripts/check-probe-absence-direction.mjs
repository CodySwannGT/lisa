#!/usr/bin/env node
/**
 * check-probe-absence-direction — refuse a probe that spends a FAILURE as an
 * ABSENCE without saying which way the absence pushes the gate
 * (CodySwannGT/lisa#3848).
 *
 * ## The defect
 *
 * `gh pr view --repo OWNER/NAME --json url,state` with no positional argument
 * is a USAGE ERROR — `argument required when using the --repo flag`, exit 1 —
 * not a lookup that returned no rows. The work-item validator's pull-request
 * lookup passed exactly that combination and read the exit 1 as "this branch
 * has no pull request", so the two gates that need the pull request (the
 * `Work-Item:` line in its body, and the `[lisa-pr-link]` backlink) were never
 * checked at push on any branch. The concrete call was fixed in #3833; the
 * shape it is an instance of is what this file refuses.
 *
 * It was the fourth instrument in one working session to fail in the shape of a
 * fact about its subject — a search hitting its `--limit` read as a complete
 * result set, a jobs endpoint answering from the wrong attempt, an audit
 * printing nothing read as clean, and this. A fifth arrived inside the
 * diagnostic built to catch the other four.
 *
 * ## Direction is the property, not shape
 *
 * `if (result.status !== 0) return undefined;` is the same nine tokens whether
 * it is correct or catastrophic. What separates them is which way the failure
 * pushes the outcome:
 *
 *   fail-closed  the failure makes the gate STRICTER — no exemption granted,
 *                no range excluded, no allowance read. Losing the answer costs
 *                a false positive, never a missed one. A legitimate design.
 *   neutral      the failure changes no gate outcome — the value is reported,
 *                formatted, or logged, and no enforcement reads it.
 *   fail-open    the failure makes the gate LOOSER. This is the defect. There
 *                is no rationale that makes it acceptable, so the marker is
 *                accepted by the grammar and REFUSED by the check: writing it
 *                is how you say "I looked, and it is wrong", not how you
 *                register an exemption.
 *
 * Grepping for the pattern and filing every hit is therefore useless — the
 * population is large and mostly correct. What is missing is the direction, and
 * it has to be recorded AT THE LINE, because that is the only place a reviewer
 * later can check it against the code rather than against a table that has gone
 * stale. (One went stale inside #3848's own description: a call site classified
 * "neutral" was neutral only because #3833 had already landed. A classification
 * of call sites looks timeless and is not.)
 *
 * ## What counts as a finding
 *
 * A site is INSPECTED when all three hold:
 *
 *  1. A failure branch: `if (<failure condition>) return <absence>;` (on one
 *     line or two), or `catch { return <absence>; }`. A failure condition
 *     reads a child process's verdict — `.status !== 0`, `.error`, `!x.ok` —
 *     or is a `catch` clause, which is the same fact arriving as a throw.
 *  2. An ABSENCE value: `undefined`, `null`, `[]`, `{}`, `""`, `false`, `0`,
 *     `new Map()`, `new Set()`. These are the values a caller reads as a
 *     legitimate negative answer.
 *  3. The enclosing function actually ASKS SOMETHING EXTERNAL — it spawns a
 *     child, shells out, or fetches. A `JSON.parse` that throws is a malformed
 *     input, not a lookup that could not be performed, and including it would
 *     bury the findings that matter under hundreds that do not.
 *
 * An inspected site is a FINDING when it carries no direction marker, when its
 * marker has no rationale, or when its marker says `fail-open`.
 *
 * ## The marker
 *
 *   probe-direction: fail-closed — losing the ref skips the exclusion, so more
 *   commits are examined, never fewer.
 *
 * It may sit in the comment block above the failure branch, as a trailing
 * comment on the branch or its return, or in the enclosing function's JSDoc —
 * whichever is where a reader of that site would look. The rationale is not
 * decoration: `fail-closed` with no sentence saying what gets stricter is the
 * same unchecked assertion the marker exists to replace, so it is refused.
 *
 * ## Why it fails at zero inspected
 *
 * An empty inspection and a clean tree print the same tick, and this repository
 * has shipped guards that reported success while inert often enough to have a
 * rule about it. The count of sites actually parsed is part of the report and a
 * count of zero is exit 2, not exit 0 — a glob that matches nothing, a root
 * that does not exist, and a parser that silently stopped all reach that
 * branch. That is this check declining to commit its own defect.
 *
 * ## Declared blind spots
 *
 * Named rather than hidden, because "the sweep found nothing" and "the sweep
 * does not look there" are the two facts this whole file exists to keep apart.
 * They are printed on every run; see `BLIND_SPOTS`.
 *
 * Determinism: Node built-ins only, no network, no clock, no `Math.random`.
 * The scanned root is a parameter so the suite can point it at a fixture tree
 * holding a known offender.
 *
 * CLI:
 *   node scripts/check-probe-absence-direction.mjs [--json] [root]
 *
 * Exit codes (mirroring the sibling check-* scripts):
 *   0 — sites were inspected and every one declares a safe direction.
 *   1 — >=1 finding.
 *   2 — operational error: unknown flag, unreadable root, or ZERO sites
 *       inspected.
 *
 * @module scripts/check-probe-absence-direction
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * One refused site.
 * @typedef {object} ProbeFinding
 * @property {string} file - Repo-relative path.
 * @property {number} line - One-based line of the failure branch.
 * @property {string} shape - `catch` or `guarded return`.
 * @property {string} statement - The branch as written.
 * @property {string | undefined} direction - The marker's direction, if any.
 * @property {string} reason - Why the site is refused.
 */

/**
 * A completed sweep.
 * @typedef {object} ProbeReport
 * @property {number} inspected - Absence-on-failure sites parsed.
 * @property {number} files - Files read.
 * @property {ProbeFinding[]} findings - Sites that are refused.
 */

/** Directories whose JavaScript Lisa authors, ships, or runs as enforcement. */
export const SCANNED_ROOTS = Object.freeze([
  "all",
  "cdk",
  "expo",
  "harper-fabric",
  "nestjs",
  "npm-package",
  "phaser",
  "plugins/src",
  "rails",
  "scripts",
  "typescript",
]);

/**
 * What this sweep does NOT look at, and why.
 *
 * Printed on every run. A reader who needs to know whether a surface is covered
 * must not have to infer it from an empty finding list — that inference is the
 * defect being refused, one level up.
 */
export const BLIND_SPOTS = Object.freeze([
  "src/** and tests/** — Lisa's own TypeScript. It is compiled and unit-tested here rather than executed inside a host's git hook, so a probe there fails in front of a suite, not in front of a gate.",
  "*.sh and workflow `run:` blocks — a shell probe conflating failure with absence is `check:pipeline-status-reads`' subject (#3090); duplicating it here would report one defect twice.",
  "generated plugin payloads (plugins/lisa*) — copies of plugins/src, where the annotation belongs; flagging both would ask for the same marker twice and let the copy drift into being the one that is fixed.",
  "absences delivered by ASSIGNMENT rather than `return` (`let x = null; try { x = probe(); } catch {}`) — detectable only with a real parser, so the sweep declares it rather than pretending the shape does not exist.",
]);

/** Directory names never descended into: nothing inside is authored here. */
const SKIPPED_DIRECTORIES = Object.freeze([
  "node_modules",
  "dist",
  ".git",
  "coverage",
]);

/** File extensions read as JavaScript. */
const JAVASCRIPT_EXTENSIONS = Object.freeze([".mjs", ".cjs", ".js"]);

/**
 * Values a caller reads as a legitimate negative answer.
 *
 * `false` and `0` are here for the same reason `null` is: `runProbe()` handing
 * back `false` because the command could not be started is indistinguishable,
 * at the call site, from it handing back `false` because the probe genuinely
 * said no.
 */
const ABSENCE_VALUES = Object.freeze([
  "undefined",
  "null",
  "[]",
  "{}",
  '""',
  "''",
  "false",
  "0",
  "new Map()",
  "new Set()",
]);

/** A `return` of an absence value and nothing else. */
const ABSENCE_RETURN =
  /^\s*return\s+(?<value>undefined|null|\[\]|\{\}|""|''|false|0|new Map\(\)|new Set\(\))\s*;?\s*$/u;

/**
 * Conditions that read a child process's verdict.
 *
 * Deliberately narrow. `if (!rows.length)` is an empty RESULT, which is the
 * honest absence this check exists to protect; only a verdict about whether the
 * command ran belongs here.
 */
const FAILURE_CONDITIONS = Object.freeze([
  /\.status\s*!==?\s*0/u,
  /\bstatus\s*!==?\s*0/u,
  /\.error\b/u,
  /!\s*\w+(?:\.\w+)*\.ok\b/u,
  /\.ok\s*===?\s*false/u,
]);

/** Evidence that the enclosing function asks something outside this process. */
const EXTERNAL_PROBES = Object.freeze([
  /\b(?:spawnSync|spawn|execSync|execFileSync|execFile)\s*\(/u,
  /\b(?:boundedSpawnSync|boundedChildOutput)\s*\(/u,
  /\bfetch\w*\s*\(/u,
  /\ballowFailure\b/u,
  /\b(?:run|git|gh|probe|capture|exec)\s*\(/u,
]);

/** Where a function whose body holds the branch may begin. */
const FUNCTION_STARTS = Object.freeze([
  /^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/u,
  /^\s*(?:export\s+)?(?:const|let)\s+\w+\s*=\s*(?:async\s*)?(?:function\b|\()/u,
  /^\s{0,4}(?:async\s+)?\w+\s*\([^)]*\)\s*\{/u,
]);

/**
 * Whether any pattern in a set matches.
 *
 * The sets are written as several small regexes rather than one alternation
 * because a 58-point regex is unreviewable, and an unreviewable matcher in a
 * check about unreviewable assumptions would be its own joke.
 * @param {readonly RegExp[]} patterns - Patterns to try.
 * @param {string} text - Text to match.
 * @returns {boolean} True when one matches.
 */
function matchesAny(patterns, text) {
  return patterns.some(pattern => pattern.test(text));
}

/** The marker, its direction, and the rationale that has to follow it. */
const DIRECTION_MARKER =
  /probe-direction:\s*(?<direction>fail-closed|fail-open|neutral)\s*(?<rationale>.*)$/u;

/** Directions that may stand. `fail-open` is the defect, so it is not here. */
export const PERMITTED_DIRECTIONS = Object.freeze(["fail-closed", "neutral"]);

/** Shortest rationale accepted. A word is not a reason. */
const MINIMUM_RATIONALE = 12;

/**
 * Whether a line is comment-only.
 * @param {string} line - Source line.
 * @returns {boolean} True for `//`, `/*`, `*` and `*\/` lines.
 */
function isCommentLine(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*")
  );
}

/**
 * The contiguous comment block immediately above a line.
 * @param {readonly string[]} lines - File lines.
 * @param {number} index - Zero-based line the block sits above.
 * @returns {string[]} The block, or an empty array.
 */
function commentBlockAbove(lines, index) {
  const block = [];
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const line = lines[cursor];
    if (line.trim() === "") continue;
    if (!isCommentLine(line)) break;
    block.push(line);
  }
  return block;
}

/**
 * The line index where the function holding a branch begins.
 * @param {readonly string[]} lines - File lines.
 * @param {number} index - Zero-based branch line.
 * @returns {number} Zero-based start line, or 0 when none is recognised.
 */
export function enclosingFunctionStart(lines, index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (matchesAny(FUNCTION_STARTS, lines[cursor])) return cursor;
  }
  return 0;
}

/**
 * Whether the code leading up to a branch asks something external.
 * @param {readonly string[]} lines - File lines.
 * @param {number} start - Zero-based function start.
 * @param {number} index - Zero-based branch line.
 * @returns {boolean} True when the branch reports on an external lookup.
 */
export function probesSomethingExternal(lines, start, index) {
  return matchesAny(EXTERNAL_PROBES, lines.slice(start, index + 1).join("\n"));
}

/**
 * Every line a direction marker for this branch may legitimately appear on.
 *
 * Three places, because three different shapes read naturally in three
 * different spots: a one-line guard wants a trailing or preceding comment, a
 * `catch` inside a small helper wants the helper's JSDoc, and a branch buried
 * in a long function wants the comment right above it.
 * @param {readonly string[]} lines - File lines.
 * @param {{branch: number, end: number}} site - Zero-based branch and last line.
 * @returns {string[]} Candidate lines holding the marker.
 */
export function annotationWindow(lines, site) {
  const start = enclosingFunctionStart(lines, site.branch);
  return [
    ...commentBlockAbove(lines, site.branch),
    ...commentBlockAbove(lines, start),
    ...lines.slice(site.branch, site.end + 1),
  ];
}

/**
 * Read the direction marker out of a window.
 * @param {readonly string[]} window - Candidate lines.
 * @returns {{direction: string, rationale: string} | undefined} The marker.
 */
export function readDirection(window) {
  for (const line of window) {
    const match = DIRECTION_MARKER.exec(line);
    if (!match) continue;
    return {
      direction: match.groups.direction,
      rationale: match.groups.rationale.replace(/^[\s—–-]+/u, "").trim(),
    };
  }
  return undefined;
}

/**
 * Why a marker is unacceptable, or undefined when it stands.
 * @param {{direction: string, rationale: string} | undefined} marker - Marker.
 * @returns {string | undefined} The refusal reason.
 */
export function refusalFor(marker) {
  if (!marker) {
    return "no `probe-direction:` marker — a failure spent as an absence has to say which way the absence pushes the gate";
  }
  if (!PERMITTED_DIRECTIONS.includes(marker.direction)) {
    return "marked `fail-open` — a failure that makes a gate LOOSER is the defect itself; restructure the probe so a caller cannot spend the failure as an answer";
  }
  if (marker.rationale.length < MINIMUM_RATIONALE) {
    return `marked \`${marker.direction}\` with no rationale — say what gets stricter (or what reads the value) so the claim can be checked against the code`;
  }
  return undefined;
}

/**
 * The next line that is neither blank nor comment-only.
 *
 * A `catch` whose return is separated from it by the very marker this check
 * demands must still be RECOGNISED as a catch. Requiring the return on the
 * literally-next line would mean annotating a site removed it from the
 * population — the check would go green because it had stopped looking, which
 * is the defect it exists to refuse, committed by the remedy.
 * @param {readonly string[]} lines - File lines.
 * @param {number} index - Zero-based line to search after.
 * @returns {number} Zero-based index, or -1 at end of file.
 */
export function nextCodeLine(lines, index) {
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (lines[cursor].trim() === "") continue;
    if (isCommentLine(lines[cursor])) continue;
    return cursor;
  }
  return -1;
}

/**
 * Locate the absence-yielding failure branches in one file's lines.
 * @param {readonly string[]} lines - File lines.
 * @returns {{branch: number, end: number, shape: string, statement: string}[]} Sites.
 */
export function absenceBranches(lines) {
  const sites = [];
  lines.forEach((line, index) => {
    // A comment that QUOTES the shape is not the shape. This check's own
    // header documents `catch { return null; }` in prose, and reading that as a
    // call site is the same category error the check exists to refuse — a
    // string about a thing taken for the thing.
    if (isCommentLine(line)) return;
    const inline =
      /^\s*(?:\}\s*)?if\s*\((?<condition>.+)\)\s*return\s+\S+/u.exec(line);
    if (inline && matchesAny(FAILURE_CONDITIONS, inline.groups.condition)) {
      const value = /return\s+(?<value>.+?)\s*;?\s*$/u.exec(line)?.groups.value;
      if (ABSENCE_VALUES.includes(value)) {
        sites.push({
          branch: index,
          end: index,
          shape: "guarded return",
          statement: line.trim(),
        });
      }
      return;
    }
    const returnAt = nextCodeLine(lines, index);
    const next = returnAt === -1 ? "" : lines[returnAt];
    if (!ABSENCE_RETURN.test(next)) return;
    if (
      /^\s*if\s*\(.+\)\s*$/u.test(line) &&
      matchesAny(FAILURE_CONDITIONS, line)
    ) {
      sites.push({
        branch: index,
        end: returnAt,
        shape: "guarded return",
        statement: `${line.trim()} ${next.trim()}`,
      });
      return;
    }
    if (/catch\s*(?:\([^)]*\))?\s*\{\s*$/u.test(line)) {
      sites.push({
        branch: index,
        end: returnAt,
        shape: "catch",
        statement: `${line.trim()} ${next.trim()}`,
      });
    }
  });
  return [...sites, ...inlineCatchBranches(lines)];
}

/**
 * The `catch { return null; }` form, whose return shares the catch's line.
 * @param {readonly string[]} lines - File lines.
 * @returns {{branch: number, end: number, shape: string, statement: string}[]} Sites.
 */
function inlineCatchBranches(lines) {
  const sites = [];
  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    const match =
      /catch\s*(?:\([^)]*\))?\s*\{\s*return\s+(?<value>.+?)\s*;?\s*\}/u.exec(
        line
      );
    if (!match || !ABSENCE_VALUES.includes(match.groups.value)) return;
    sites.push({
      branch: index,
      end: index,
      shape: "catch",
      statement: line.trim(),
    });
  });
  return sites;
}

/**
 * Inspect one file.
 * @param {string} text - File contents.
 * @param {string} file - Repo-relative path, for reporting.
 * @returns {ProbeReport} Result for this file.
 */
export function inspectSource(text, file) {
  const lines = text.split("\n");
  const result = { inspected: 0, findings: [] };
  for (const site of absenceBranches(lines)) {
    const start = enclosingFunctionStart(lines, site.branch);
    if (!probesSomethingExternal(lines, start, site.branch)) continue;
    result.inspected += 1;
    const marker = readDirection(annotationWindow(lines, site));
    const refusal = refusalFor(marker);
    if (!refusal) continue;
    result.findings.push({
      file,
      line: site.branch + 1,
      shape: site.shape,
      statement: site.statement,
      direction: marker?.direction,
      reason: refusal,
    });
  }
  return result;
}

/**
 * Every JavaScript file under a directory.
 * @param {string} absolute - Directory to walk.
 * @param {string} repoRoot - Root the reported paths are relative to.
 * @returns {{absolute: string, relative: string}[]} Files in walk order.
 */
export function collectFiles(absolute, repoRoot) {
  const files = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.includes(entry.name)) continue;
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(child, repoRoot));
      continue;
    }
    if (!JAVASCRIPT_EXTENSIONS.includes(path.extname(entry.name))) continue;
    files.push({ absolute: child, relative: path.relative(repoRoot, child) });
  }
  return files;
}

/**
 * Run the sweep over a tree.
 * @param {string} repoRoot - Absolute path of the tree to inspect.
 * @param {readonly string[]} [roots] - Sub-directories to scan.
 * @returns {ProbeReport} Report.
 */
export function sweep(repoRoot, roots = SCANNED_ROOTS) {
  const report = { inspected: 0, files: 0, findings: [] };
  for (const root of roots) {
    const absolute = path.join(repoRoot, root);
    try {
      if (!statSync(absolute).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const file of collectFiles(absolute, repoRoot)) {
      report.files += 1;
      const result = inspectSource(
        readFileSync(file.absolute, "utf8"),
        file.relative
      );
      report.inspected += result.inspected;
      report.findings.push(...result.findings);
    }
  }
  report.findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) || left.line - right.line
  );
  return report;
}

/**
 * Render the human-readable report.
 * @param {ProbeReport} report - Result.
 * @returns {string} The report text.
 */
export function formatReport(report) {
  const lines = [
    `check:probe-absence-direction — inspected ${report.inspected} absence-on-failure site(s) across ${report.files} file(s).`,
    "  Not audited by this sweep:",
    ...BLIND_SPOTS.map(spot => `    · ${spot}`),
  ];
  if (report.inspected === 0) {
    lines.push(
      "  ✖ ZERO sites inspected. A sweep that parsed nothing cannot report a clean tree; treating this as a failure, not an all-clear."
    );
    return lines.join("\n");
  }
  for (const finding of report.findings) {
    lines.push(
      `  ✖ ${finding.file}:${finding.line} (${finding.shape})`,
      `      ${finding.statement}`,
      `      ${finding.reason}.`
    );
  }
  if (report.findings.length === 0) {
    lines.push(
      "  ✔ Every probe that spends a failure as an absence declares which way the absence pushes the gate."
    );
    return lines.join("\n");
  }
  lines.push(
    "",
    "Fix: record the direction at the line, in the comment above the branch, on the branch itself, or in the enclosing function's JSDoc —",
    "  // probe-direction: fail-closed — an unresolvable ref excludes nothing, so the range examined grows rather than shrinks.",
    "  // probe-direction: neutral — the value is printed in the report; no gate reads it.",
    "`fail-open` is not an exemption. If the failure makes a gate looser, the probe has to stop being able to hand a failure back as an answer:",
    "return a three-state result (found / absent / could-not-ask), or let the failure throw."
  );
  return lines.join("\n");
}

/**
 * CLI entry point.
 * @returns {void}
 */
export function main() {
  const args = process.argv.slice(2);
  const unknown = args.find(arg => arg.startsWith("--") && arg !== "--json");
  if (unknown) {
    console.error(`check:probe-absence-direction: unknown flag ${unknown}`);
    process.exitCode = 2;
    return;
  }
  const json = args.includes("--json");
  const repoRoot = path.resolve(args.find(arg => !arg.startsWith("--")) ?? ".");
  const report = sweep(repoRoot);
  console.log(
    json
      ? JSON.stringify({ ...report, blindSpots: BLIND_SPOTS }, null, 2)
      : formatReport(report)
  );
  if (report.inspected === 0) process.exitCode = 2;
  else if (report.findings.length > 0) process.exitCode = 1;
}

if (invokedAsScript(import.meta.url)) {
  main();
}
