#!/usr/bin/env node
/**
 * Deterministic gate against leftover merge-conflict markers in tracked files
 * (issue #2552).
 *
 * PR #2548 committed literal `<<<<<<< HEAD` conflict blocks into six generated
 * parity `SKILL.md` files and passed every gate on the way in:
 *
 *   - the parity push gate greps for the pin *value*, which was present inside
 *     the conflict block, so it read as current;
 *   - the test suite parses skill frontmatter, never the body;
 *   - `🧩 Plugin artifacts match source` compares the generated copies against
 *     `plugins/src`, and both sides were broken the *same* way, so they matched.
 *
 * Nothing in the loop read the bytes. This script does, and only that.
 *
 * Determinism guarantees (so the unit test is reproducible and CI is stable):
 *   - zero third-party dependencies (Node built-ins only),
 *   - no network access,
 *   - no `Date` / `Math.random`,
 *   - the file list comes from `git ls-files`, so the gate sees exactly what a
 *     push would carry — an untracked scratch file can never block a push.
 *
 * Detection deliberately requires the COMPLETE ordered marker triple
 * (`<<<<<<<` … `=======` … `>>>>>>>`), which is what git actually writes.
 * Content between the start and the separator is ignored, so the diff3 base
 * marker (`|||||||`) is accepted. A lone `<<<<<<<` line is NOT reported:
 * documentation that quotes one side of a conflict is legitimate content, and a
 * gate that fires on files it should not read is its own outage.
 *
 * CLI:
 *   node scripts/check-conflict-markers.mjs [--root <dir>] [--json]
 *
 * Exit codes (mirroring the sibling parity scripts):
 *   0 — no tracked file carries a conflict block.
 *   1 — ≥1 tracked file carries a conflict block.
 *   2 — operational/usage error: unknown flag, a flag missing its value,
 *       `--root` absent or not a git repository, or git being unavailable.
 *
 * @module scripts/check-conflict-markers
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** `<<<<<<<` alone, or followed by whitespace and a label (`<<<<<<< HEAD`). */
const START_RE = /^<{7}(?:[ \t].*)?$/;

/** The separator git writes between the two sides: exactly seven `=`. */
const SEPARATOR_RE = /^={7}$/;

/** `>>>>>>>` alone, or followed by whitespace and a label. */
const END_RE = /^>{7}(?:[ \t].*)?$/;

/** Files larger than this are skipped — no source file is this big. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Leading bytes probed for a NUL, which marks the file as binary. */
const BINARY_PROBE_BYTES = 8000;

/** Max bytes of `git ls-files` output (7k+ tracked paths is ~0.3 MB today). */
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Usage error — thrown by `parseArgs` / `listTrackedFiles` for an invalid
 * invocation so `main` can distinguish it (exit 2) from a finding (exit 1).
 */
export class UsageError extends Error {}

/**
 * Find every complete conflict block in `content`.
 *
 * A block is a `<<<<<<<` line, then a `=======` line, then a `>>>>>>>` line, in
 * that order. A second `<<<<<<<` abandons any partial block and starts a new
 * one, matching how git nests nothing and always re-opens.
 *
 * @param {string} content - full text of a file.
 * @returns {{ startLine: number, separatorLine: number, endLine: number }[]}
 *   one entry per complete block, with 1-based line numbers.
 */
export function findConflictBlocks(content) {
  const lines = String(content).split(/\r?\n/);
  const blocks = [];
  let startLine = -1;
  let separatorLine = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (START_RE.test(line)) {
      startLine = index + 1;
      separatorLine = -1;
      continue;
    }
    if (startLine === -1) {
      continue;
    }
    if (SEPARATOR_RE.test(line)) {
      if (separatorLine === -1) {
        separatorLine = index + 1;
      }
      continue;
    }
    if (END_RE.test(line)) {
      if (separatorLine !== -1) {
        blocks.push({ endLine: index + 1, separatorLine, startLine });
      }
      startLine = -1;
      separatorLine = -1;
    }
  }
  return blocks;
}

/**
 * True iff `buffer` looks binary (a NUL byte in its leading bytes) — the same
 * heuristic git uses to decide a blob is not text.
 *
 * @param {Buffer} buffer - the file contents.
 * @returns {boolean} whether the file should be skipped as binary.
 */
function isBinary(buffer) {
  return (
    buffer.indexOf(0, 0) !== -1 && buffer.indexOf(0, 0) < BINARY_PROBE_BYTES
  );
}

/**
 * List every tracked file in `root`, relative to it. Throws `UsageError` when
 * git is unavailable or `root` is not a repository.
 *
 * @param {string} root - the repository root.
 * @returns {string[]} tracked paths, relative to `root`.
 */
function listTrackedFiles(root) {
  let stdout;
  try {
    stdout = execFileSync("git", ["-C", root, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    throw new UsageError(
      `could not list tracked files in ${root}: ${error.message}`
    );
  }
  return stdout.split("\0").filter(entry => entry !== "");
}

/**
 * Scan one tracked file. Missing (staged-deleted), oversized, and binary files
 * are skipped rather than reported.
 *
 * @param {string} root - the repository root.
 * @param {string} file - a tracked path relative to `root`.
 * @returns {{ file: string, blocks: ReadonlyArray<Record<string, number>> } | null}
 *   the finding, or `null` when the file is clean or skipped.
 */
function scanFile(root, file) {
  const absolute = path.join(root, file);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
    return null;
  }
  let buffer;
  try {
    buffer = fs.readFileSync(absolute);
  } catch {
    return null;
  }
  if (isBinary(buffer)) {
    return null;
  }
  const blocks = findConflictBlocks(buffer.toString("utf8"));
  return blocks.length === 0 ? null : { blocks, file };
}

/**
 * Assemble the machine-readable report.
 *
 * @param {ReadonlyArray<{ file: string, blocks: ReadonlyArray<Record<string, number>> }>} results
 *   the conflicted files, sorted by path.
 * @param {{ root: string, scanned: number }} opts - resolved options + scan size.
 * @returns {Record<string, unknown>} the report object.
 */
export function buildReport(results, opts) {
  return {
    results,
    root: opts.root,
    schemaVersion: 1,
    summary: {
      clean: opts.scanned - results.length,
      conflicted: results.length,
      scanned: opts.scanned,
    },
  };
}

/**
 * Render the human-readable report.
 *
 * @param {{ results: ReadonlyArray<{ file: string, blocks: ReadonlyArray<Record<string, number>> }>, summary: { scanned: number, conflicted: number } }} report
 *   the report object.
 * @returns {string} the rendered report.
 */
function humanReport(report) {
  if (report.summary.conflicted === 0) {
    return `✓ no leftover conflict markers in ${report.summary.scanned} tracked files`;
  }
  const lines = report.results.flatMap(result => [
    `✗ ${result.file}`,
    ...result.blocks.map(
      block =>
        `    - conflict block opens at line ${block.startLine}, separator at line ${block.separatorLine}, closes at line ${block.endLine}`
    ),
  ]);
  return [
    ...lines,
    "",
    `${report.summary.conflicted} of ${report.summary.scanned} tracked files carry leftover conflict markers`,
  ].join("\n");
}

/**
 * Parse argv into resolved options. Throws `UsageError` on a bad invocation.
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @returns {{ root: string, json: boolean }} options.
 */
export function parseArgs(argv) {
  let root = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--root") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError("--root requires a value");
      }
      root = next;
      i += 1;
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  return { json, root: path.resolve(root ?? REPO_ROOT) };
}

/**
 * Run the gate. Returns the process exit code (does not call `exit`).
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @param {{ stdout?: { write(s: string): void }, stderr?: { write(s: string): void } }} [io]
 *   injectable streams (defaults to process streams).
 * @returns {number} the exit code (0 clean, 1 markers found, 2 usage error).
 */
export function main(argv, io = {}) {
  const out = io.stdout ?? process.stdout;
  const err = io.stderr ?? process.stderr;
  let opts;
  let files;
  try {
    opts = parseArgs(argv);
    if (!fs.existsSync(opts.root) || !fs.statSync(opts.root).isDirectory()) {
      throw new UsageError(`--root is not a directory: ${opts.root}`);
    }
    files = listTrackedFiles(opts.root);
  } catch (error) {
    err.write(`error: ${error.message}\n`);
    return 2;
  }
  let results;
  try {
    results = files
      .map(file => scanFile(opts.root, file))
      .filter(result => result !== null)
      .sort((a, b) => a.file.localeCompare(b.file));
  } catch (error) {
    err.write(`error: failed to scan tracked files: ${error.message}\n`);
    return 2;
  }
  const report = buildReport(results, {
    root: opts.root,
    scanned: files.length,
  });
  out.write(
    `${opts.json ? JSON.stringify(report, null, 2) : humanReport(report)}\n`
  );
  return results.length === 0 ? 0 : 1;
}

if (invokedAsScript(import.meta.url)) {
  // exitCode (not process.exit): when stdout is a pipe, writes are async and
  // process.exit() truncates the report mid-flush.
  process.exitCode = main(process.argv.slice(2));
}
