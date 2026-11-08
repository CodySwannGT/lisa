#!/usr/bin/env node
/**
 * Deterministic detector for stale reusable-workflow inputs (issue #1423).
 *
 * Context: a caller workflow (e.g. a consumer repo's `.github/workflows/example-agent.yml`)
 * invokes one of Lisa's reusable workflows via `uses: <owner>/<repo>/.github/workflows/
 * reusable-*.yml@<ref>` and passes a `with:` block. GitHub hard-fails the run at
 * startup if that `with:` block names an input the reusable workflow's
 * `workflow_call.inputs` no longer declares (e.g. an early-generation caller still
 * passing `package_manager`, which `reusable-example.yml` never declared). Because
 * create-only workflow callers are never overwritten, an affected repo cannot
 * self-heal — the drift has to be found and reported (or migrated) instead.
 *
 * This script scans every workflow file directly under a project's
 * `.github/workflows/` for such callers, resolves each referenced reusable
 * workflow's declared inputs from a contracts root (defaults to this repo's own
 * `.github/workflows/`, the source of truth for the current contract), and reports
 * any caller `with:` key absent from the declared set as `stale`.
 *
 * It is intentionally NOT a general YAML parser. It does targeted,
 * indentation-aware line scanning of the two shapes it cares
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
 * Caller lines are read in every shape Lisa's pin step writes, including the
 * trailing `# v<version>` comment and quoted references (#4641). A `uses:` line
 * that names a Lisa reusable workflow but cannot be read is reported with
 * status `unparsed` rather than dropped, so a file the detector could not read
 * never counts as clean.
 *
 * Exit codes:
 *   0 — every Lisa caller was read and none has a stale input. This includes a
 *       project with no Lisa reusable-workflow callers at all; the summary line
 *       says so explicitly.
 *   1 — stale input(s) found in at least one caller, or at least one Lisa
 *       caller line could not be read (`unparsed`).
 *   2 — operational/usage error: unknown flag, a flag missing its value, a
 *       `--project` that isn't a directory, or a filesystem error while scanning.
 *
 * @module scripts/detect-stale-workflow-inputs
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  diffStaleKeys,
  extractCallerJobs,
  extractDeclaredInputs,
  findUnparsedLisaCallerLines,
  parseReusableReference,
} from "./lib/reusable-workflow-contract.mjs";

export {
  diffStaleKeys,
  extractCallerJobs,
  extractDeclaredInputs,
  findUnparsedLisaCallerLines,
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
 *   workflow file (e.g. `reusable-example.yml`).
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
 * Whether a parsed caller job calls one of Lisa's reusable workflows. Owner and
 * repository compare case-insensitively, as GitHub resolves them.
 *
 * @param {{ owner?: string | null, repo?: string | null }} job - a caller row.
 * @returns {boolean} true for a Lisa caller.
 */
function isLisaCaller(job) {
  return (
    job.owner?.toLowerCase() === LISA_OWNER &&
    job.repo?.toLowerCase() === LISA_REPO
  );
}

/**
 * Scan one caller workflow file and classify each of its reusable-workflow
 * jobs against the contracts root.
 *
 * @param {string} filePath - absolute path to the caller workflow file.
 * @param {string} contractsRoot - directory holding current reusable workflows.
 * @returns {{ reusableFile: string | null, ref: string | null, withKeys: string[], staleInputs: string[], status: "ok" | "stale" | "unknown-contract" | "unparsed", line?: number, text?: string }[]}
 *   one row per reusable-workflow job found in the file, plus one `unparsed`
 *   row per line naming a Lisa reusable workflow that the parser could not
 *   read.
 */
function scanCallerFile(filePath, contractsRoot) {
  const content = fs.readFileSync(filePath, "utf8");
  const jobs = extractCallerJobs(content);
  // Fail closed (#4641): a Lisa caller line the parser cannot read must be
  // reported, never silently counted as "nothing stale".
  const unparsed = findUnparsedLisaCallerLines(content).map(entry => ({
    line: entry.line,
    owner: null,
    ref: null,
    repo: null,
    reusableFile: null,
    staleInputs: [],
    status: "unparsed",
    text: entry.text,
    withKeys: [],
  }));
  const classified = jobs.map(job => {
    const declared = isLisaCaller(job)
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
  return [...classified, ...unparsed];
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
  const unparsed = results.filter(r => r.status === "unparsed").length;
  // An unparsed line is a caller the detector could NOT check, so it is
  // reported separately and never counted among the caller jobs scanned.
  const scanned = results.length - unparsed;
  return {
    contractsRoot: opts.contractsRoot,
    projects: opts.projects,
    results,
    schemaVersion: 1,
    summary: {
      ok: scanned - stale - unknownContract,
      scanned,
      stale,
      unknownContract,
      unparsed,
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
 * Render the summary line under the human-readable table.
 *
 * A project with no Lisa caller is stated outright, so a reader can tell
 * "nothing of Lisa's to check" apart from "checked and clean" (#4641) — also
 * when the project has third-party callers that were counted. Unreadable Lisa
 * caller lines get a hint naming the shape the detector needs.
 *
 * @param {{ scanned: number, stale: number, unknownContract: number, unparsed: number }} summary
 *   the report's summary counts.
 * @param {boolean} hasLisaCaller - whether any row is a Lisa caller, parsed or
 *   not.
 * @returns {string} the summary line.
 */
function summaryLine(summary, hasLisaCaller) {
  const noLisa = "no Lisa reusable-workflow callers found";
  if (summary.scanned === 0 && !hasLisaCaller) {
    return `${noLisa} — nothing to check`;
  }
  const counts = `${summary.stale} of ${summary.scanned} caller jobs have stale inputs (${summary.unknownContract} unresolvable contract(s))`;
  const unparsed =
    summary.unparsed > 0
      ? `; ${summary.unparsed} Lisa caller line(s) could not be read — each Lisa caller line must read \`uses: CodySwannGT/lisa/.github/workflows/<file>@<ref>\``
      : "";
  return `${counts}${unparsed}${hasLisaCaller ? "" : ` — ${noLisa}`}`;
}

/**
 * Render the human-readable markdown table + summary line.
 *
 * @param {{ results: ReadonlyArray<Record<string, unknown>>, summary: { scanned: number, stale: number, unknownContract: number, unparsed: number } }} report
 *   the report object.
 * @returns {string} the rendered table.
 */
function humanTable(report) {
  const header =
    "| project | file | reusable | stale inputs | status |\n" +
    "| --- | --- | --- | --- | --- |";
  const rows = report.results.map(
    r =>
      `| ${cell(r.project)} | ${cell(r.line === undefined ? r.file : `${r.file}:${r.line}`)} | ${cell(r.reusableFile)} | ${cell(r.staleInputs)} | ${cell(r.status)} |`
  );
  const hasLisaCaller = report.results.some(
    r => r.status === "unparsed" || isLisaCaller(r)
  );
  return `${[header, ...rows].join("\n")}\n${summaryLine(report.summary, hasLisaCaller)}`;
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
  out.write(`${json ? JSON.stringify(report, null, 2) : humanTable(report)}\n`);
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
 * @returns {number} the exit code (0 ok, 1 stale or unparsed found, 2 usage
 *   error).
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
  return results.some(r => r.status === "stale" || r.status === "unparsed")
    ? 1
    : 0;
}

if (invokedAsScript(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
