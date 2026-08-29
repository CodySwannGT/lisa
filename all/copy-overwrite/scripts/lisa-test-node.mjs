#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * lisa-test-node — run the `*.test.mjs` suites nothing else collects.
 *
 * ## Why this exists
 *
 * Lisa distributes guard scripts as `.mjs` — nine to every project via
 * `all/copy-overwrite/scripts/`, four more to expo consumers — and every test
 * config Lisa ships restricts collection to `.ts`/`.tsx`. `.mjs` is an
 * extension those globs cannot express, so a consumer who does the responsible
 * thing and writes a test beside one of those guards gets a suite that never
 * runs, and a green build saying so.
 *
 * Measured downstream before this was written: 37 `*.test.mjs` files, 13
 * enforced by nothing at all, 229 stranded test cases.
 *
 * ## Why a wrapper rather than `node --test "**\/*.test.mjs"` in a script
 *
 * Two reasons, both measured rather than assumed.
 *
 * **The glob descends into `node_modules`.** In this repository
 * `**\/*.test.ts` matches 1175 files, 470 of them vendored. Handing that to
 * `node --test` runs other people's suites, which at best is slow and at worst
 * reports their failures as yours.
 *
 * **`node --test` exits 0 when its glob matches nothing.** Verified on
 * v22.22.0: a pattern with no matches produces a clean run and status 0. That
 * is the same "empty collection is a green collection" defect this script was
 * written to end, sitting inside the tool meant to end it. A bare script would
 * have reproduced the bug inside its own fix.
 *
 * So collection is done here, explicitly, and **the count is always printed**.
 * Zero collected is a failure, not a quiet pass. A project that genuinely has no
 * such tests should disable the gate in `.lisa.config.json`, where the decision
 * is visible and the required context is dropped instead of vacuously satisfied.
 *
 * ## What this does NOT do
 *
 * It does not verify that every `*.test.mjs` on disk is reachable from a
 * runner. That is a different question — a glob narrowed later would quietly
 * shrink what this collects, which is exactly how the original defect arose —
 * and it belongs to a guard that enumerates from disk independently rather
 * than to the runner whose own glob is the thing under suspicion.
 * @module lisa-test-node
 */

import { spawnSync } from "node:child_process";
import { globSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Files matching this are candidate suites. */
export const TEST_GLOB = "**/*.test.mjs";

/**
 * Path segments whose contents are never this project's tests.
 *
 * Matched as path segments, not substrings: a project directory legitimately
 * named `distribution` must not be excluded because it starts with `dist`.
 */
export const EXCLUDED_SEGMENTS = Object.freeze([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".lisabak",
  "worktrees",
  ".worktrees",
]);

/**
 * The same policy as {@link EXCLUDED_SEGMENTS}, spelled as prune patterns for
 * the walker so those trees are never descended into in the first place.
 *
 * Derived from the segment list rather than written out beside it, so a
 * segment added to one cannot go missing from the other.
 *
 * ## Two traps worth knowing before editing this
 *
 * The intuitive spelling is `ignore: [...]`, which is the **`glob` NPM
 * package's** option. This is `node:fs`, whose option is `exclude` — and
 * `node:fs` **silently discards unknown keys**. Measured on v22.22.0, passing
 * `ignore` returns a result byte-identical to passing no options at all, so
 * the plausible fix is a no-op that still exhausts the heap and still looks
 * correct in review.
 *
 * The array form is used rather than the function form because node documents
 * `exclude` as taking a list of glob patterns, whereas what the function form
 * is handed on v22 is a bare basename — an undocumented shape not worth
 * pinning a contract to.
 *
 * The dot-leading entries are inert and kept deliberately: measured on
 * v22.22.0, `**` matches no dot-leading segment and the walk never descends
 * into one, so `.worktrees` costs nothing either way. Deriving the whole list
 * is what keeps this honest if that behaviour ever changes.
 */
export const EXCLUDED_GLOBS = Object.freeze(
  EXCLUDED_SEGMENTS.map(segment => `**/${segment}/**`)
);

/**
 * Whether a matched path belongs to this project rather than to a dependency,
 * a build output, or another checkout parked inside the tree.
 * @param {string} relativePath - Path relative to the project root.
 * @returns {boolean} True when the file is this project's own test.
 */
export function isOwnTest(relativePath) {
  return !relativePath
    .split(path.sep)
    .some(segment => EXCLUDED_SEGMENTS.includes(segment));
}

/**
 * The suites this runner will execute, sorted for a stable transcript.
 * @param {string} [cwd] - Project root to search.
 * @returns {string[]} Project-relative paths.
 */
export function collect(cwd = process.cwd()) {
  // Both filters are load-bearing and neither replaces the other: `exclude`
  // decides what is WALKED, `isOwnTest` decides what is a SUITE.
  //
  // Filtering alone runs after the walk has already materialised every
  // matching path in the tree. Where agent sessions park nested `git worktree`
  // checkouts inside the repository — which Lisa's own worktree-isolation
  // guidance encourages — that walk descends into every nested checkout's
  // `node_modules` and exhausts the heap. Measured downstream on v22.22.0 with
  // 107 nested checkouts: a heap-limit abort, exit 134, at
  // `--max-old-space-size=4096`; with `exclude`, 43 suites in 362 ms and 10 MB.
  //
  // That took the whole gate down, not just this runner: the guard that
  // imports `collect` runs in the pre-push hook, so every push was refused.
  return globSync(TEST_GLOB, { cwd, exclude: EXCLUDED_GLOBS })
    .filter(isOwnTest)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Run the collected suites.
 *
 * The file list is passed explicitly rather than as a glob, so what runs is
 * exactly what was reported as collected — the log cannot describe one set
 * while the runner executes another.
 * @param {string[]} files - Suites to run.
 * @param {Function} [exec] - Spawner, injected for tests.
 * @returns {number} Exit status.
 */
export function run(files, exec = spawnSync) {
  const result = exec(process.execPath, ["--test", ...files], {
    stdio: "inherit",
  });
  // A signal-killed child reports a null status. Treating that as 0 would call
  // an interrupted run a pass, which is the defect this file exists to remove.
  return typeof result.status === "number" ? result.status : 1;
}

/**
 * CLI entry point.
 *
 * The writer and the project root are injected rather than reached for, so a
 * test can assert what the transcript SAYS without redirecting the real stdout
 * or changing the process working directory. The empty case is the one that
 * has to be asserted on output, so making that assertable is the point.
 * @param {object} [io] - Injection seam.
 * @param {Function} [io.write] - Line sink; defaults to stdout.
 * @param {string} [io.cwd] - Project root to search.
 * @param {Function} [io.exec] - Spawner passed through to {@link run}.
 * @returns {number} Exit status.
 */
export function main({ write, cwd, exec } = {}) {
  const out = write ?? (text => process.stdout.write(text));
  const files = collect(cwd);
  out(`lisa-test-node: collected ${files.length} *.test.mjs suite(s)\n`);
  for (const file of files) out(`  ${file}\n`);
  if (!files.length) {
    // Reported, never silent, and never green: empty collection is the defect
    // this runner exists to prevent.
    out(
      "lisa-test-node: nothing to run. This is only correct if this project " +
        "genuinely has no .mjs suites.\n"
    );
    return 1;
  }
  return exec ? run(files, exec) : run(files);
}

/**
 * True when `moduleUrl` names the module node was asked to run.
 *
 * Both sides are realpath'd: `import.meta.url` is the real path while
 * `argv[1]` is whatever the caller typed, so through a symlinked checkout, a
 * git worktree, or a `/tmp` path on macOS a raw comparison is false and the
 * body never runs — for a test runner, exiting 0 having run nothing.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the CLI body should run.
 */
export function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  process.exit(main());
}
