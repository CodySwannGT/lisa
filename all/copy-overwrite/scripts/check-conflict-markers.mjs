#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
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
 * The bytes come from the same place as the list. `git ls-files` names what a
 * push carries, and the working tree is only where those bytes usually happen
 * to be; where the two disagree the INDEX wins, because that is what a commit
 * would take. A file matching its index is still read straight off the
 * filesystem, so a clean tree costs one extra git call in total.
 *
 * Marker width is read from each block's opening run rather than fixed at
 * seven. Seven is only git's default — `conflict-marker-size` changes it.
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
 * `--root` defaults to the CURRENT WORKING DIRECTORY, deliberately, and not to
 * a path derived from this file's own location. This script is a copy-overwrite
 * template: it is installed at `scripts/` in a consumer, lives at
 * `all/copy-overwrite/scripts/` in Lisa itself, and ships inside the package at
 * `node_modules/@codyswann/lisa/all/copy-overwrite/scripts/`. A location-derived
 * default resolves to a DIFFERENT directory on each of those three, and the
 * failure is silent in the worst direction — `git ls-files` inside a
 * subdirectory succeeds and lists only what is under it, so the gate reports
 * "no leftover conflict markers in 40 tracked files" having never looked at the
 * project. Anchoring on the cwd makes every caller correct with no flag to drop.
 *
 * Exit codes (mirroring the sibling parity scripts):
 *   0 — no tracked file carries a conflict block.
 *   1 — ≥1 tracked file carries a conflict block.
 *   2 — operational/usage error: unknown flag, a flag missing its value,
 *       `--root` absent or not a git repository, git being unavailable, or
 *       ZERO tracked files enumerated.
 *
 * ## Zero tracked files is exit 2, not a green tick (issue #3888)
 *
 * The cwd anchoring above closes the case where the enumeration is scoped to a
 * SUBDIRECTORY. It does not close the case where the enumeration returns
 * NOTHING, and that case reported `✓ no leftover conflict markers in 0 tracked
 * files` and exit 0 — a required push gate printing a success line for a
 * comparison that had no subject. The count was in hand the whole time and
 * nothing read it.
 *
 * An empty enumeration is not a clean repository: it is a repository whose
 * files this gate never saw. A push carries commits, and a commit carries a
 * tracked file, so zero here means the scan was mis-scoped, `git` answered
 * from somewhere else, or the repository is not the one being pushed. Each of
 * those is an operational failure of the scan, which is exit 2 — the same
 * stance `check-workflow-package-paths` takes with the same words.
 *
 * @module all/copy-overwrite/scripts/check-conflict-markers
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { boundedExecFileSync, isChildTimeout } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * `<<<<<<<` alone, or followed by whitespace and a label (`<<<<<<< HEAD`).
 *
 * Seven or MORE, with the run captured. Seven is only git's default: the
 * `conflict-marker-size` attribute changes it, and a real merge under
 * `* conflict-marker-size=32` writes 32-character markers, which an
 * exactly-seven matcher reads straight past. Measured on the pre-fix source
 * (CodySwannGT/lisa#2958): a live, unresolved conflict sitting in the working
 * tree reported `✓ no leftover conflict markers in 4 tracked files`, exit 0.
 *
 * The captured run is what ties the three lines into one block — see
 * {@link findConflictBlocks}.
 */
const START_RE = /^(<{7,})(?:[ \t].*)?$/;

/** The separator git writes between the two sides, at the block's width. */
const SEPARATOR_RE = /^(={7,})$/;

/** `>>>>>>>` alone, or followed by whitespace and a label. */
const END_RE = /^(>{7,})(?:[ \t].*)?$/;

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
 * The width of a marker run on this line, or 0 when the line is not that marker.
 * @param {RegExp} pattern - one of the three marker patterns.
 * @param {string} line - the line to test.
 * @returns {number} the run length, or 0.
 */
function markerWidth(pattern, line) {
  const match = pattern.exec(line);
  return match === null ? 0 : match[1].length;
}

/**
 * Find every complete conflict block in `content`.
 *
 * A block is a `<<<<<<<` line, then a `=======` line, then a `>>>>>>>` line, in
 * that order, ALL THREE THE SAME WIDTH. A second opening marker abandons any
 * partial block and starts a new one, matching how git nests nothing and always
 * re-opens.
 *
 * The width is matched rather than assumed, and matching it is what keeps this
 * widening safe. Accepting any run of seven-or-more independently would make a
 * document that quotes one marker and later rules a line of `=` into a finding,
 * and this gate's first rule is that a gate which fires on files it should not
 * read is its own outage. Git writes one width per block, so requiring one
 * width per block costs nothing real and buys every `conflict-marker-size`.
 * @param {string} content - full text of a file.
 * @returns {{ startLine: number, separatorLine: number, endLine: number }[]}
 *   one entry per complete block, with 1-based line numbers.
 */
export function findConflictBlocks(content) {
  const lines = String(content).split(/\r?\n/);
  const blocks = [];
  let startLine = -1;
  let separatorLine = -1;
  let width = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const opening = markerWidth(START_RE, line);
    if (opening > 0) {
      startLine = index + 1;
      separatorLine = -1;
      width = opening;
      continue;
    }
    if (startLine === -1) {
      continue;
    }
    if (markerWidth(SEPARATOR_RE, line) === width) {
      if (separatorLine === -1) {
        separatorLine = index + 1;
      }
      continue;
    }
    if (markerWidth(END_RE, line) === width) {
      if (separatorLine !== -1) {
        blocks.push({ endLine: index + 1, separatorLine, startLine });
      }
      startLine = -1;
      separatorLine = -1;
      width = 0;
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
 * List every tracked file in `root`, relative to it, each path ONCE. Throws
 * `UsageError` when git is unavailable or `root` is not a repository.
 *
 * The de-duplication is load-bearing during a merge, and only became reachable
 * once this gate started detecting the conflicts a merge writes. `git ls-files`
 * emits an unmerged path once per stage — three times for an ordinary content
 * conflict — so a two-file repository mid-merge lists four entries, and the
 * gate scanned the same file three times and reported "3 of 4 tracked files
 * carry leftover conflict markers" about a single conflicted file. Measured
 * (CodySwannGT/lisa#2958). A count an operator cannot trust is the same defect
 * as a verdict they cannot trust.
 *
 * @param {string} root - the repository root.
 * @returns {string[]} tracked paths, relative to `root`, without repeats.
 */
function listTrackedFiles(root) {
  let stdout;
  try {
    // A killed child arrives here as an ordinary throw and leaves as a
    // `UsageError` naming ETIMEDOUT, so this call site was already fail-closed
    // and needed only the deadline. Nothing about the catch changes.
    stdout = boundedExecFileSync("git", ["-C", root, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    throw new UsageError(
      `could not list tracked files in ${root}: ${error.message}`
    );
  }
  return [...new Set(stdout.split("\0").filter(entry => entry !== ""))];
}

/**
 * Tracked paths whose working-tree bytes differ from the index.
 *
 * One git call, and on a clean tree it returns nothing — which is what keeps
 * the ordinary case reading straight off the filesystem with no per-file git
 * invocation at all.
 *
 * A failure here is deliberately NOT fatal: an empty set degrades this gate to
 * exactly its previous behaviour, which is a weaker true position rather than a
 * false one.
 *
 * That reasoning covers a KILLED child as well, and the swallow is kept for it
 * deliberately rather than by inheritance. An empty diff set means every path
 * is read from the working tree, which is where this gate read from before the
 * index was consulted at all — so a timeout here costs the improvement, not the
 * gate. Contrast `readIndexedBlob`, where the same swallow WOULD cost the
 * gate, and is not kept.
 * @param {string} root - the repository root.
 * @returns {Set<string>} paths that differ, relative to `root`.
 */
function listStagedDifferences(root) {
  try {
    const stdout = boundedExecFileSync(
      "git",
      ["-C", root, "diff", "--name-only", "-z"],
      {
        encoding: "utf8",
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    return new Set(stdout.split("\0").filter(entry => entry !== ""));
  } catch {
    return new Set();
  }
}

/**
 * The bytes git holds for `file` in the index, or null when it cannot be read.
 *
 * `:path` is the index, so this returns what a commit would carry rather than
 * what happens to be on disk. An unmerged path has no stage-0 entry and this
 * throws, which is correct — the caller falls back to the working tree, where
 * an in-progress merge writes its markers.
 *
 * A KILLED child is the one failure this must NOT swallow, and it is the only
 * call site in this file that re-raises. `contentToScan` reads
 * `readIndexedBlob(...) ?? readWorkingTree(...)`, so returning null for a
 * timeout silently reads the working tree in place of the index — which is
 * precisely the weaker position CodySwannGT/lisa#2958 removed. Two shapes it
 * measured go back to being invisible: a conflict block staged in the index
 * with an unstaged resolution on disk, and a tracked file absent from the
 * working tree that gets COUNTED as scanned and never read.
 *
 * So a busy machine would return this gate to reporting clean over bytes
 * nobody looked at, with no signal — the exact defect it exists to end,
 * reintroduced through its own error handling.
 * @param {string} root - the repository root.
 * @param {string} file - a tracked path relative to `root`.
 * @returns {Buffer|null} the indexed blob, or null.
 * @throws {Error} When the child was killed at its deadline.
 */
function readIndexedBlob(root, file) {
  try {
    return boundedExecFileSync("git", ["-C", root, "show", `:${file}`], {
      maxBuffer: MAX_FILE_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    if (isChildTimeout(error)) throw error;
    return null;
  }
}

/**
 * The bytes to scan for one tracked path, from the index or the working tree.
 *
 * `git ls-files` names what a push would carry; the working tree is only where
 * those bytes usually happen to be. Two measured ways they diverge, both of
 * which the gate reported clean (CodySwannGT/lisa#2958):
 *
 *   - a complete conflict block staged in the index, with an unstaged
 *     resolution on disk. The push carries the block; the disk says otherwise.
 *   - a tracked file absent from the working tree, as a sparse checkout leaves
 *     it. That file was COUNTED in `scanned` and never read — a clean report
 *     over a file nobody looked at, which is the exact failure this gate exists
 *     to end rather than one it may commit itself.
 *
 * The filesystem stays the fast path for the overwhelming majority: a file that
 * matches its index and exists on disk is read with no git call.
 * @param {string} root - the repository root.
 * @param {string} file - a tracked path relative to `root`.
 * @param {boolean} differs - whether this path differs from the index.
 * @returns {Buffer|null} the bytes to scan, or null when it should be skipped.
 */
function contentToScan(root, file, differs) {
  if (differs) {
    return readIndexedBlob(root, file) ?? readWorkingTree(root, file);
  }
  const working = readWorkingTree(root, file);
  // Absent from the working tree but present in the index: sparse checkout, or
  // `skip-worktree`. `git diff` stays silent about those, so the diff set alone
  // cannot catch them and the absence has to be handled here.
  return working ?? readIndexedBlob(root, file);
}

/**
 * The working-tree bytes for one tracked path, or null.
 *
 * Missing (staged-deleted or sparse) and oversized files return null, and a
 * directory or symlink is not a file to read.
 * @param {string} root - the repository root.
 * @param {string} file - a tracked path relative to `root`.
 * @returns {Buffer|null} the bytes, or null.
 */
function readWorkingTree(root, file) {
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
  try {
    return fs.readFileSync(absolute);
  } catch {
    return null;
  }
}

/**
 * Scan one tracked file. Unreadable, oversized, and binary files are skipped
 * rather than reported.
 *
 * @param {string} root - the repository root.
 * @param {string} file - a tracked path relative to `root`.
 * @param {boolean} differs - whether this path differs from the index.
 * @returns {{ file: string, blocks: ReadonlyArray<Record<string, number>> } | null}
 *   the finding, or `null` when the file is clean or skipped.
 */
function scanFile(root, file, differs) {
  const buffer = contentToScan(root, file, differs);
  if (buffer === null || isBinary(buffer)) {
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
      if (i + 1 >= argv.length) {
        throw new UsageError("--root requires a value");
      }
      const next = argv[i + 1];
      if (next.startsWith("--")) {
        throw new UsageError("--root requires a value");
      }
      root = next;
      i += 1;
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  return { json, root: path.resolve(root ?? process.cwd()) };
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
    if (files.length === 0) {
      throw new UsageError(
        `git ls-files named no tracked file under ${opts.root}; a scan of ` +
          `nothing is not a pass`
      );
    }
  } catch (error) {
    err.write(`error: ${error.message}\n`);
    return 2;
  }
  let results;
  try {
    const differing = listStagedDifferences(opts.root);
    results = files
      .map(file => scanFile(opts.root, file, differing.has(file)))
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
