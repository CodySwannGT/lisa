#!/usr/bin/env node
/**
 * check-empty-subject-guards — refuse a guard that prints a success line when
 * its comparison had no subject (CodySwannGT/lisa#3888).
 *
 * ## The defect
 *
 * Not "the guard is wrong". The guard did not run against anything, and said
 * OK:
 *
 * ```
 * ✓ no leftover conflict markers in 0 tracked files
 * ```
 *
 * That line is a REQUIRED push gate reporting on bytes nobody read. The count
 * was in hand the whole time and the guard did not read it, so an empty
 * subject set and a satisfied comparison render identically. The same shape
 * has produced a type gate that compiled 0 of 1375 test files and reported
 * success, a gate runner that recorded PASSED off an exit code alone, and a
 * review gate that went green off a review that never started.
 *
 * The acceptance criterion is the one #3888 states: **a guard that emits a
 * success line must be able to say what it examined, and must fail closed when
 * that count is zero.** A subject count of zero is not a pass.
 *
 * ## Why this is measured by RUNNING the guards, not by reading them
 *
 * A static sweep would have to recognise "a subject collection" across thirty
 * hand-written scripts, and a heuristic that misses one reports a clean tree —
 * which is the very failure being swept for. Executing the guard asks the
 * question directly and cannot be satisfied by a shape.
 *
 * The subject-free input is an **empty git repository**: every guard here
 * enumerates something out of a tree, and a tree with nothing in it is the
 * cheapest honest way to hand one an empty subject set. Both the root argument
 * and the working directory point at it, so a guard that ignores its `--root`
 * and anchors on `process.cwd()` still sees the empty tree rather than this
 * repository.
 *
 * ## What counts as a finding
 *
 * Exit 0 **and** a success marker in the output. Both halves are load-bearing:
 *
 *  - Exit 0 alone is not a finding. A guard may legitimately have nothing to
 *    do, and two here say exactly that — `check-state-classification` reports
 *    `not-adopted` and `check-merge-driver-registration` reports "nothing to
 *    register". Neither claims a check was satisfied; both STATE that their
 *    subject was absent, which is the criterion met rather than violated.
 *  - A success marker alone is not a finding either: a guard is free to print
 *    a tick for the sub-checks that did pass on its way to a non-zero exit.
 *
 * So the finding is precisely "printed OK, and exited as though it meant it".
 * There is no allowlist and no roster of excuse words — the discriminator is
 * the guard's own verdict vocabulary.
 *
 * ## Declared blind spots
 *
 * Stated rather than hidden, in the manner of the sibling sweeps:
 *
 *  - A guard that declares no root override cannot be pointed at an empty
 *    tree, so it is COUNTED and NAMED in the report but not probed. That
 *    population is where an unmeasured instance would hide, which is why the
 *    count is printed rather than silently dropped: a guard leaving the probed
 *    population shows up as that number rising.
 *  - A guard whose subject set is not a tree — a queue read over the network,
 *    a process list — is out of reach of this input even when it is
 *    root-scoped. It will refuse for a reason unrelated to emptiness, and that
 *    refusal is accepted here.
 *  - Only the FIRST accepted probe form decides. A guard taking both `--root`
 *    and a positional root is probed once.
 *
 * ## Why it fails at zero probed
 *
 * An empty inspection and a clean tree print the same tick — the defect this
 * module exists for, applied to this module. The count of guards actually
 * probed is part of the report, and a count of zero is exit 2 rather than
 * exit 0. A directory that does not exist, a `--guards-root` pointed
 * somewhere wrong, and a discovery pattern that stopped matching all reach
 * that branch.
 *
 * Determinism: Node built-ins only, no network, no clock, no `Math.random`.
 * Children run under a deadline, so a hung guard is a throw rather than a
 * verdict. The discovery root is a parameter so the suite can point it at a
 * fixture tree holding a known offender.
 *
 * CLI:
 *   node scripts/check-empty-subject-guards.mjs [--json] [--guards-root <dir>]
 *
 * The flag is `--guards-root` and NOT `--root`, deliberately: `--root` is the
 * token this sweep reads out of other guards' headers to decide they are
 * probeable, and a sweep that probed itself would recurse.
 *
 * Exit codes (mirroring the sibling check-* scripts):
 *   0 — guards were probed and none reported success on an empty tree.
 *   1 — >=1 guard printed a success line and exited 0 having examined nothing.
 *   2 — operational error: unknown flag, unreadable root, `git` unavailable,
 *       or ZERO guards probed.
 *
 * @module scripts/check-empty-subject-guards
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { boundedSpawnSync } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * Directory names holding guard scripts, relative to the discovery root.
 *
 * `scripts` is this repository's own lane; `<stack>/copy-overwrite/scripts` is
 * the delivered lane, and it is derived by reading the top level rather than
 * listed, so a new stack directory joins the population on the day it appears.
 */
const GUARD_DIRECTORY = "scripts";

/** The delivery lane a stack directory holds its guard scripts in. */
const DELIVERED_LANE = path.join("copy-overwrite", "scripts");

/** Guard scripts are named `check-*.mjs`; nothing else in those lanes is one. */
const GUARD_FILE = /^check-.+\.mjs$/;

/** Bytes of a guard's header scanned for its declared CLI. */
const HEADER_BYTES = 8000;

/** A guard's declared root override, in the order the probe tries them. */
const ROOT_FORMS = Object.freeze([
  { flag: "--root", token: "--root" },
  { flag: null, token: "[root]" },
  { flag: null, token: "[rootDir]" },
]);

/**
 * Verdict vocabulary: what a guard prints when it means "this check passed".
 *
 * Deliberately narrow. A guard reporting that its subject was ABSENT —
 * "not-adopted", "nothing to register" — is stating what it examined, which is
 * the criterion satisfied, so nothing here matches that wording.
 */
const SUCCESS_MARKERS = Object.freeze(["✓", "✔", "✅", "PASSED", "PASS"]);

/** Standalone `OK`, which is a verdict; `OKAY` inside a word is not. */
const OK_TOKEN = /(?:^|[^A-Za-z])OK(?:[^A-Za-z]|$)/;

/** Per-guard deadline. A guard that outlives it is a throw, not a verdict. */
const PROBE_BUDGET_MS = 60_000;

/** Usage error — distinguishes an invalid invocation (exit 2) from a finding. */
export class UsageError extends Error {}

/**
 * Does this output claim a check was satisfied?
 * @param {string} output Combined stdout and stderr of a probed guard.
 * @returns {boolean} True when the guard printed a success verdict.
 */
export function claimsSuccess(output) {
  if (SUCCESS_MARKERS.some(marker => output.includes(marker))) return true;
  return OK_TOKEN.test(output);
}

/**
 * The root override a guard declares in its own header, if any.
 *
 * Read from the header rather than from an arg parser because the header is
 * the guard's contract with its callers — a guard that stops documenting
 * `--root` has changed that contract, and dropping out of the probed
 * population is the correct consequence, made visible by the report's
 * not-probeable count.
 * @param {string} source The guard's source text.
 * @returns {{ flag: string|null }|undefined} The form, or undefined.
 */
export function declaredRootForm(source) {
  const header = source.slice(0, HEADER_BYTES);
  return ROOT_FORMS.find(form => header.includes(form.token));
}

/**
 * Every guard script under the discovery root, in a stable order.
 * @param {string} root Directory to discover guards under.
 * @returns {string[]} Paths relative to `root`, sorted.
 */
export function discoverGuards(root) {
  const lanes = [GUARD_DIRECTORY];
  for (const entry of readDirectory(root)) {
    if (entry === GUARD_DIRECTORY || entry.startsWith(".")) continue;
    const lane = path.join(entry, DELIVERED_LANE);
    if (readDirectory(path.join(root, lane)).length > 0) lanes.push(lane);
  }
  return lanes
    .flatMap(lane =>
      readDirectory(path.join(root, lane))
        .filter(name => GUARD_FILE.test(name))
        .map(name => path.join(lane, name))
    )
    .sort((a, b) => a.localeCompare(b));
}

/**
 * `readdirSync` that answers with an empty list instead of throwing.
 * @param {string} directory Directory to read.
 * @returns {string[]} Entry names, or `[]` when unreadable.
 */
function readDirectory(directory) {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

/**
 * Run one guard against a subject-free tree.
 * @param {string} script Absolute path to the guard.
 * @param {{ flag: string|null }} form The declared root form.
 * @param {string} empty Absolute path to the empty repository.
 * @returns {{ status: number|null, output: string }} Exit status and output.
 */
function probe(script, form, empty) {
  const args = form.flag ? [script, form.flag, empty] : [script, empty];
  const result = boundedSpawnSync(process.execPath, args, {
    cwd: empty,
    encoding: "utf8",
    timeout: PROBE_BUDGET_MS,
  });
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status,
  };
}

/**
 * Create a git repository with no tracked files.
 * @returns {string} Absolute path to the repository.
 * @throws {UsageError} When `git` is unavailable or `init` fails.
 */
export function createEmptyRepository() {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-3888-"));
  const result = boundedSpawnSync("git", ["init", "-q", directory], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    rmSync(directory, { force: true, recursive: true });
    throw new UsageError(
      `git init failed in ${directory}: ${result.stderr ?? result.error?.message ?? "unknown"}`
    );
  }
  return directory;
}

/**
 * Probe every root-scoped guard under `root` against an empty repository.
 * @param {string} root Directory to discover guards under.
 * @returns {{ probed: number, findings: object[], notProbeable: string[] }} Report.
 */
export function sweep(root) {
  const report = { findings: [], notProbeable: [], probed: 0 };
  const guards = discoverGuards(root);
  const empty = createEmptyRepository();
  try {
    for (const relative of guards) {
      const absolute = path.join(root, relative);
      const form = declaredRootForm(readFileSync(absolute, "utf8"));
      if (!form) {
        report.notProbeable.push(relative);
        continue;
      }
      report.probed += 1;
      const { status, output } = probe(absolute, form, empty);
      if (status === 0 && claimsSuccess(output)) {
        report.findings.push({
          guard: relative,
          verdict: firstVerdictLine(output),
        });
      }
    }
  } finally {
    rmSync(empty, { force: true, recursive: true });
  }
  return report;
}

/**
 * The first output line carrying a success marker, for the report.
 * @param {string} output Combined output of a probed guard.
 * @returns {string} That line, trimmed.
 */
function firstVerdictLine(output) {
  const lines = output.split("\n");
  return (lines.find(line => claimsSuccess(line)) ?? lines[0] ?? "").trim();
}

/**
 * Render the human-readable report.
 * @param {{ probed: number, findings: object[], notProbeable: string[] }} report Result.
 * @returns {string} The report text.
 */
export function formatReport(report) {
  const lines = [
    `check:empty-subject-guards — probed ${report.probed} root-scoped guard(s) ` +
      `against an empty repository; ${report.notProbeable.length} guard(s) ` +
      `declare no root override and were not probed.`,
  ];
  if (report.probed === 0) {
    lines.push(
      "  ✖ ZERO guards probed. A sweep that ran nothing cannot report a clean tree; treating this as a failure, not an all-clear."
    );
    return lines.join("\n");
  }
  for (const finding of report.findings) {
    lines.push(
      `  ✖ ${finding.guard} — exited 0 and printed a success line having examined nothing:`,
      `      ${finding.verdict}`
    );
  }
  if (report.findings.length === 0) {
    lines.push(
      "  ✔ Every probed guard refused, or stated that its subject was absent."
    );
    return lines.join("\n");
  }
  lines.push(
    "",
    "Fix: read the subject count before rendering the verdict. An enumeration",
    "that produced nothing is an operational failure of the scan (exit 2), not",
    'a clean result — the wording the sibling guards use is "a scan of nothing',
    'is not a pass". A guard that legitimately has nothing to do says THAT',
    "instead, in the manner of `not-adopted`, rather than printing a tick."
  );
  return lines.join("\n");
}

/**
 * CLI entry point.
 * @returns {void}
 */
export function main() {
  const args = process.argv.slice(2);
  let root = ".";
  let json = false;
  try {
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "--json") json = true;
      else if (arg === "--guards-root") {
        const value = args[index + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new UsageError("--guards-root requires a value");
        }
        root = value;
        index += 1;
      } else throw new UsageError(`unknown argument: ${arg}`);
    }
    const report = sweep(path.resolve(root));
    console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
    if (report.probed === 0) process.exitCode = 2;
    else if (report.findings.length > 0) process.exitCode = 1;
  } catch (error) {
    console.error(`check:empty-subject-guards: ${error.message}`);
    process.exitCode = 2;
  }
}

if (invokedAsScript(import.meta.url)) {
  main();
}
