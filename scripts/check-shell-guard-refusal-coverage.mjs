#!/usr/bin/env node
/**
 * check-shell-guard-refusal-coverage — refuse a shell guard that tests EXECUTE
 * but never drive onto a refusal path (CodySwannGT/lisa#3190).
 *
 * ## What it does
 *
 * Runs the suites that can execute a shipped `.sh` guard with
 * {@link module:scripts/lib/shell-guard-trace} loaded, so every guard execution
 * and its exit status is recorded, then judges the trace with
 * {@link module:scripts/lib/shell-guard-refusal-coverage}. A guard the run
 * observed only ever exiting 0 is reported by name.
 *
 * The population is what RAN. That is the whole point: the roster this check
 * governs cannot be written down, because a written roster is what went stale
 * in CodySwannGT/lisa#2847 and what reads as covered in CodySwannGT/lisa#3190.
 * A new guard with a new driving test joins the population the moment its
 * suite runs it, with nothing edited here.
 *
 * ## Why it fails at zero observed
 *
 * A run that observed nothing and a clean tree would otherwise print the same
 * tick. A missing tracer, an unwritable trace file, a candidate filter that
 * matched no suite, and a vitest invocation that never started all reach that
 * branch — and every one of them is a control reporting success while inert,
 * which is the family this whole campaign has been closing. Zero observed is
 * exit 2, never exit 0.
 *
 * CLI:
 *   node scripts/check-shell-guard-refusal-coverage.mjs [--json] [--trace FILE]
 *
 *   --trace FILE   judge an existing trace instead of producing one. Use it in
 *                  CI when the full suite already ran with the tracer imported.
 *
 * Exit codes (mirroring the sibling check-* scripts):
 *   0 — every guard the run drove was observed refusing and allowing.
 *   1 — >=1 finding.
 *   2 — operational error: unknown flag, vitest could not run, or ZERO guards
 *       observed.
 *
 * @module scripts/check-shell-guard-refusal-coverage
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  formatReport,
  guardPopulation,
  judge,
  parseTrace,
  tracerIndex,
} from "./lib/shell-guard-refusal-coverage.mjs";

/** Wall-clock ceiling for the traced vitest run. */
const RUN_TIMEOUT_MS = 45 * 60_000;

/** Wall-clock ceiling for the one `git` call this script makes. */
const GIT_TIMEOUT_MS = 60_000;

/** Substrings whose presence means a module starts a child process. */
const CHILD_STARTS = Object.freeze([
  "spawnSync",
  "execFileSync",
  "execSync",
  "boundedSpawnSync",
  "boundedExecFileSync",
  "boundedBash",
]);

/**
 * Read one tracked file, tolerating a path git lists but the tree lacks.
 * @param {string} root - Repository root.
 * @param {string} file - Repository-relative path.
 * @returns {string} File text, or an empty string.
 */
function readOrEmpty(root, file) {
  try {
    return readFileSync(path.join(root, file), "utf8");
  } catch {
    return "";
  }
}

/**
 * The test files that could execute a shipped guard.
 *
 * A deliberate SUPERSET: a file is a candidate when its unit — itself plus the
 * `tests/` modules it transitively imports — both names something ending in
 * `.sh` and starts a child process. Over-inclusion costs runtime;
 * under-inclusion costs a guard silently leaving the population, which is the
 * failure this check exists to prevent.
 * @param {string} root - Repository root.
 * @returns {string[]} Repository-relative test file paths, sorted.
 */
export function candidateSuites(root) {
  const tracked = execFileSync("git", ["ls-files", "-z", "tests"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: GIT_TIMEOUT_MS,
  })
    .split("\0")
    .filter(file => file.endsWith(".ts"));
  const text = new Map(tracked.map(file => [file, readOrEmpty(root, file)]));

  /**
   * Every `tests/` module one file reaches, itself included.
   * @param {string} file - Repository-relative path.
   * @param {Set<string>} seen - Modules already walked.
   * @returns {string[]} Repository-relative module paths.
   */
  const unit = (file, seen) => {
    if (seen.has(file)) return [];
    seen.add(file);
    const source = text.get(file) ?? "";
    const imports = [...source.matchAll(/from\s+"(\.[^"]+)"/gu)]
      .map(hit =>
        path.join(path.dirname(file), hit[1] ?? "").replace(/\.js$/u, ".ts")
      )
      .filter(candidate => text.has(candidate));
    return [file, ...imports.flatMap(next => unit(next, seen))];
  };

  return tracked
    .filter(file => file.endsWith(".test.ts"))
    .filter(file => {
      const sources = unit(file, new Set()).map(part => text.get(part) ?? "");
      return (
        sources.some(source => source.includes(".sh")) &&
        sources.some(source => CHILD_STARTS.some(call => source.includes(call)))
      );
    })
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Run the candidate suites with the tracer imported and return the raw trace.
 * @param {string} root - Repository root.
 * @param {ReturnType<typeof guardPopulation>} population - Tracked guards.
 * @returns {{trace: string, suites: number, ok: boolean, detail: string}} Result.
 */
function produceTrace(root, population) {
  const suites = candidateSuites(root);
  const workspace = mkdtempSync(path.join(tmpdir(), "lisa-guard-trace-"));
  const tracePath = path.join(workspace, "trace.jsonl");
  const indexPath = path.join(workspace, "index.json");
  writeFileSync(tracePath, "");
  writeFileSync(indexPath, JSON.stringify(tracerIndex(population)));
  const tracer = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "lib",
    "shell-guard-trace.mjs"
  );
  const result = spawnSync(
    path.join(root, "node_modules", ".bin", "vitest"),
    ["run", "--reporter=dot", ...suites],
    {
      cwd: root,
      encoding: "utf8",
      timeout: RUN_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        LISA_SHELL_GUARD_TRACE: tracePath,
        LISA_SHELL_GUARD_INDEX: indexPath,
        NODE_OPTIONS:
          `${process.env["NODE_OPTIONS"] ?? ""} --import=${tracer}`.trim(),
      },
    }
  );
  const detail =
    result.signal !== null
      ? `vitest was KILLED (${result.signal}) rather than completing`
      : `vitest exited ${String(result.status)}`;
  return {
    trace: readOrEmpty(workspace, "trace.jsonl"),
    suites: suites.length,
    ok: result.signal === null && result.status !== null,
    detail,
  };
}

/**
 * CLI entry point.
 * @returns {void}
 */
export function main() {
  const args = process.argv.slice(2);
  const known = new Set(["--json", "--trace"]);
  const unknown = args.find(
    (arg, at) =>
      arg.startsWith("--") && !known.has(arg) && args[at - 1] !== "--trace"
  );
  if (unknown) {
    console.error(
      `check:shell-guard-refusal-coverage: unknown flag ${unknown}`
    );
    process.exitCode = 2;
    return;
  }
  const root = process.cwd();
  const population = guardPopulation(root);
  const at = args.indexOf("--trace");
  const supplied = at === -1 ? undefined : args[at + 1];
  const produced =
    supplied === undefined
      ? produceTrace(root, population)
      : { trace: readOrEmpty(root, supplied), suites: 0, ok: true, detail: "" };
  if (!produced.ok) {
    console.error(`check:shell-guard-refusal-coverage: ${produced.detail}`);
    process.exitCode = 2;
    return;
  }
  const report = judge({ population, observed: parseTrace(produced.trace) });
  console.log(
    args.includes("--json")
      ? JSON.stringify(report, (_key, value) =>
          value instanceof Set ? [...value] : value
        )
      : formatReport(report)
  );
  if (report.driven === 0) process.exitCode = 2;
  else if (report.findings.length > 0) process.exitCode = 1;
}

if (invokedAsScript(import.meta.url)) {
  main();
}
