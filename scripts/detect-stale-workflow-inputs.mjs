#!/usr/bin/env node
/**
 * Deterministic detector for stale reusable-workflow inputs (issue #1423).
 *
 * Context: a caller workflow (e.g. a consumer repo's `.github/workflows/claude.yml`)
 * invokes one of Lisa's reusable workflows via `uses: <owner>/<repo>/.github/workflows/
 * reusable-*.yml@<ref>` and passes a `with:` block. GitHub hard-fails the run at
 * startup if that `with:` block names an input the reusable workflow's
 * `workflow_call.inputs` no longer declares (e.g. an early-generation caller still
 * passing `package_manager`, which `reusable-claude.yml` never declared). Because
 * `claude.yml` is a create-only file Lisa never overwrites, an affected repo can
 * never self-heal — the drift has to be found and reported (or migrated) instead.
 *
 * This script scans every workflow file directly under a project's
 * `.github/workflows/` for such callers, resolves each referenced reusable
 * workflow's declared inputs from a contracts root (defaults to this repo's own
 * `.github/workflows/`, the source of truth for the current contract), and reports
 * any caller `with:` key absent from the declared set as `stale`.
 *
 * It is intentionally NOT a general YAML parser — like `migrate-deploy-order.sh`,
 * it does targeted, indentation-aware line scanning of the two shapes it cares
 * about (`uses:` + sibling `with:`, and `workflow_call: inputs:`). That is
 * sufficient for Lisa-authored workflow files, which have a stable, predictable
 * structure, and keeps the detector dependency-free (Node built-ins only, no
 * network access — mirrors `scripts/plugin-parity-drift.mjs`'s determinism goals).
 *
 * It never edits a caller file — it only reports, so `lisa-update-projects` (or
 * CI) can decide SAFE/REVIEW/migrate from the result.
 *
 * CLI:
 *   node scripts/detect-stale-workflow-inputs.mjs [--project <dir>]... [--contracts-root <dir>] [--json]
 *
 * Exit codes:
 *   0 — no stale inputs found (includes the case of zero callers scanned).
 *   1 — stale input(s) found in at least one caller.
 *   2 — operational/usage error: unknown flag, a flag missing its value, a
 *       `--project` that isn't a directory, or a filesystem error while scanning.
 *
 * @module scripts/detect-stale-workflow-inputs
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  diffStaleKeys,
  extractCallerJobs,
  extractDeclaredInputs,
  parseReusableReference,
} from "./lib/reusable-workflow-contract.mjs";

export {
  diffStaleKeys,
  extractCallerJobs,
  extractDeclaredInputs,
  parseReusableReference,
};

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const LISA_OWNER = "codyswanngt";
const LISA_REPO = "lisa";

/**
 * Usage error — thrown by `parseArgs` for an invalid invocation so `main` can
 * distinguish it (exit 2) from a drift result (exit 1).
 */
export class UsageError extends Error {}

/**
 * True iff `target` is an existing directory.
 *
 * @param {string} target - filesystem path.
 * @returns {boolean} whether `target` resolves to a directory.
 */
function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve a reusable workflow's declared inputs from the contracts root.
 *
 * @param {string} contractsRoot - directory holding the current reusable
 *   workflow files (basename-addressed).
 * @param {string} reusableFile - basename of the referenced reusable
 *   workflow file (e.g. `reusable-claude.yml`).
 * @returns {string[] | null} declared inputs, or `null` if the contract file
 *   isn't present under `contractsRoot` (unresolvable, not necessarily stale).
 */
function resolveContractInputs(contractsRoot, reusableFile) {
  const contractPath = path.join(contractsRoot, reusableFile);
  if (!fs.existsSync(contractPath)) {
    return null;
  }
  return extractDeclaredInputs(fs.readFileSync(contractPath, "utf8"));
}

/**
 * Scan one caller workflow file and classify each of its reusable-workflow
 * jobs against the contracts root.
 *
 * @param {string} filePath - absolute path to the caller workflow file.
 * @param {string} contractsRoot - directory holding current reusable workflows.
 * @returns {{ reusableFile: string, ref: string, withKeys: string[], staleInputs: string[], status: "ok" | "stale" | "unknown-contract" }[]}
 *   one row per reusable-workflow job found in the file.
 */
function scanCallerFile(filePath, contractsRoot) {
  const jobs = extractCallerJobs(fs.readFileSync(filePath, "utf8"));
  return jobs.map(job => {
    const isLisaContract =
      job.owner?.toLowerCase() === LISA_OWNER &&
      job.repo?.toLowerCase() === LISA_REPO;
    const declared = isLisaContract
      ? resolveContractInputs(contractsRoot, job.reusableFile)
      : null;
    if (declared === null) {
      return { ...job, staleInputs: [], status: "unknown-contract" };
    }
    const staleInputs = diffStaleKeys(job.withKeys, declared);
    return {
      ...job,
      staleInputs,
      status: staleInputs.length > 0 ? "stale" : "ok",
    };
  });
}

/**
 * List every `.yml`/`.yaml` file directly under `<root>/.github/workflows`
 * (non-recursive — GitHub Actions never nests workflow files deeper).
 *
 * @param {string} root - a project root directory.
 * @returns {string[]} absolute file paths, sorted.
 */
function collectWorkflowFiles(root) {
  const dir = path.join(root, ".github", "workflows");
  if (!isDirectory(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map(entry => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Render a filesystem path relative to `root` using POSIX separators.
 *
 * @param {string} absPath - an absolute path.
 * @param {string} root - the root to relativize against.
 * @returns {string} a stable, display-friendly relative path.
 */
function displayPath(absPath, root) {
  return path.relative(root, absPath).split(path.sep).join("/");
}

/**
 * Assemble the machine-readable report.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} results - per-job results.
 * @param {{ projects: readonly string[], contractsRoot: string }} opts - options.
 * @returns {Record<string, unknown>} the report object.
 */
export function buildReport(results, opts) {
  const stale = results.filter(r => r.status === "stale").length;
  const unknownContract = results.filter(
    r => r.status === "unknown-contract"
  ).length;
  return {
    contractsRoot: opts.contractsRoot,
    projects: opts.projects,
    results,
    schemaVersion: 1,
    summary: {
      ok: results.length - stale - unknownContract,
      scanned: results.length,
      stale,
      unknownContract,
    },
  };
}

/**
 * Sanitize a value for a markdown-table cell.
 *
 * @param {string | readonly string[] | null | undefined} value - raw cell value.
 * @returns {string} a table-safe string (`-` for null/undefined/empty array).
 */
function cell(value) {
  if (value === null || value === undefined) {
    return "-";
  }
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  return text === "" ? "-" : text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

/**
 * Render the human-readable markdown table + summary line.
 *
 * @param {{ results: ReadonlyArray<Record<string, unknown>>, summary: { scanned: number, stale: number, unknownContract: number } }} report
 *   the report object.
 * @returns {string} the rendered table.
 */
function humanTable(report) {
  const header =
    "| project | file | reusable | stale inputs | status |\n" +
    "| --- | --- | --- | --- | --- |";
  const rows = report.results.map(
    r =>
      `| ${cell(r.project)} | ${cell(r.file)} | ${cell(r.reusableFile)} | ${cell(r.staleInputs)} | ${cell(r.status)} |`
  );
  const summary = `\n${report.summary.stale} of ${report.summary.scanned} caller jobs have stale inputs (${report.summary.unknownContract} unresolvable contract(s))`;
  return [header, ...rows].join("\n") + summary;
}

/**
 * Render a report to the chosen stream.
 *
 * @param {{ write(s: string): void }} out - the output stream.
 * @param {Record<string, unknown>} report - the report object.
 * @param {boolean} json - whether to emit JSON instead of the human table.
 * @returns {void}
 */
function emitReport(out, report, json) {
  out.write(
    (json ? JSON.stringify(report, null, 2) : humanTable(report)) + "\n"
  );
}

/**
 * Parse argv into resolved options. Throws `UsageError` on a bad invocation.
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @returns {{ projects: string[], contractsRoot: string, json: boolean }} options.
 */
export function parseArgs(argv) {
  const projects = [];
  let contractsRoot = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--project") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError("--project requires a value");
      }
      projects.push(next);
      i += 1;
    } else if (arg === "--contracts-root") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError("--contracts-root requires a value");
      }
      contractsRoot = next;
      i += 1;
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  const resolvedProjects = projects.length > 0 ? projects : [process.cwd()];
  return {
    contractsRoot: path.resolve(
      contractsRoot ?? path.join(REPO_ROOT, ".github", "workflows")
    ),
    json,
    projects: resolvedProjects.map(p => path.resolve(p)),
  };
}

/**
 * Run the detector. Returns the process exit code (does not call `exit`).
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @param {{ stdout?: { write(s: string): void }, stderr?: { write(s: string): void } }} [io]
 *   injectable streams (defaults to process streams).
 * @returns {number} the exit code (0 ok, 1 stale found, 2 usage error).
 */
export function main(argv, io = {}) {
  const out = io.stdout ?? process.stdout;
  const err = io.stderr ?? process.stderr;
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    err.write(`error: ${error.message}\n`);
    return 2;
  }
  const missing = opts.projects.filter(p => !isDirectory(p));
  if (missing.length > 0) {
    err.write(`error: --project is not a directory: ${missing.join(", ")}\n`);
    return 2;
  }
  let results;
  try {
    results = opts.projects.flatMap(project => {
      const files = collectWorkflowFiles(project);
      return files.flatMap(file =>
        scanCallerFile(file, opts.contractsRoot).map(job => ({
          file: displayPath(file, project),
          project,
          ...job,
        }))
      );
    });
  } catch (error) {
    err.write(`error: failed to scan workflow files: ${error.message}\n`);
    return 2;
  }
  const report = buildReport(results, opts);
  emitReport(out, report, opts.json);
  return results.some(r => r.status === "stale") ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(main(process.argv.slice(2)));
}
