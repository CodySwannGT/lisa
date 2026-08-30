#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
/**
 * Report remote branches carrying work that was pushed and never submitted
 * (issue #3446).
 *
 * ## The state this exists for
 *
 * `lisa-git-submit-pr` lists **Push** and **PR Management** as separate steps
 * with nothing binding them: no atomicity, no post-condition, no terminal check
 * that a pull request exists when the flow ends. An agent that stops between
 * them — context exhaustion, a turn limit, an interruption, a refused call —
 * leaves a branch on the remote carrying finished work that is in no review, no
 * CI run, and no report.
 *
 * The skill's own `Never` list contained the rule for exactly this pair of
 * steps, pointing the other way: *"skip pushing before PR creation"* forbids a
 * PR without a push. Push without a PR was unprohibited and undetected.
 *
 * **The last signal such an agent receives is green.** The pre-push hook prints
 * `no pull request exists yet, so gates 4 and 5 could not be checked here — CI
 * will verify both`, which is accurate and reads as an informational pass.
 * Downstream the silence holds: the work item keeps its in-progress role, so
 * intake will not re-dispatch it, and nothing counts a branch without a pull
 * request. The state is unreachable by every other check.
 *
 * Measured when this was written: 15 such branches in one repository, roughly
 * 12,900 insertions, every one dated within a single day. Fifteen simultaneous
 * stops at the same step is not fifteen coincidences.
 *
 * ## What it reports, and what it deliberately does not
 *
 * Reported: a remote branch **ahead** of the default branch, with **no** pull
 * request of any state.
 *
 * A branch level with the default branch has nothing to submit. A branch whose
 * pull request already MERGED is an un-deleted leftover, not lost work — and
 * keying on "no OPEN pull request" instead would report every such branch in
 * the repository. Both exclusions exist because a check that reports everything
 * is one nobody reads, which is the same outcome as no check at all.
 *
 * Determinism: Node built-ins only, no `Date`, no `Math.random`. Branch and
 * pull-request facts come from `git` and `gh`; with neither available the
 * script reports that it could not look rather than that it found nothing.
 * @module check-orphaned-branches
 */

import { spawnSync } from "node:child_process";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** Branch name prefixes that are never work-in-flight. */
const IGNORED_PREFIXES = Object.freeze(["backup/", "gh-readonly-queue/"]);

/** Exit codes. `FOUND` is advisory by default; see `--fail-on-found`. */
const EXIT = Object.freeze({ OK: 0, FOUND: 1, UNAVAILABLE: 70 });

/**
 * Run a command and return its trimmed stdout, or undefined on any failure.
 *
 * Undefined means "could not look", never "looked and found nothing" — the two
 * are reported differently, because a check that turns a broken command into a
 * clean result is the vacuous-success failure this file's family exists to
 * refuse.
 * @param {string} command Executable name.
 * @param {string[]} args Arguments.
 * @returns {string | undefined} Trimmed stdout, or undefined.
 */
function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return undefined;
  return result.stdout.trim();
}

/**
 * The repository's default branch, as the remote reports it.
 * @param {string} remote Remote name.
 * @returns {string | undefined} Short branch name, or undefined.
 */
export function defaultBranch(remote = "origin") {
  const symref = run("git", [
    "symbolic-ref",
    "--quiet",
    `refs/remotes/${remote}/HEAD`,
  ]);
  return symref?.startsWith(`refs/remotes/${remote}/`)
    ? symref.slice(`refs/remotes/${remote}/`.length)
    : undefined;
}

/**
 * Every branch name that has a pull request, in any state.
 *
 * Any state, not just OPEN. A branch whose pull request merged is a leftover
 * ref, not unsubmitted work, and reporting it would bury the real findings
 * under every branch nobody deleted.
 * @returns {Set<string> | undefined} Branch names, or undefined if `gh` failed.
 */
export function branchesWithPullRequests() {
  const json = run("gh", [
    "pr",
    "list",
    "--state",
    "all",
    "--limit",
    "1000",
    "--json",
    "headRefName",
  ]);
  if (json === undefined) return undefined;
  try {
    const rows = JSON.parse(json);
    return new Set(
      Array.isArray(rows)
        ? rows
            .map(row => row?.headRefName)
            .filter(name => typeof name === "string")
        : []
    );
  } catch {
    return undefined;
  }
}

/**
 * Remote branches ahead of the default branch, with their commit counts.
 * @param {string} remote Remote name.
 * @param {string} base Default branch name.
 * @returns {ReadonlyArray<{branch: string, ahead: number}> | undefined} Rows.
 */
export function branchesAhead(remote = "origin", base = "main") {
  const listed = run("git", [
    "for-each-ref",
    "--format=%(refname:strip=3)",
    `refs/remotes/${remote}`,
  ]);
  if (listed === undefined) return undefined;
  const rows = [];
  for (const branch of listed.split("\n").map(line => line.trim())) {
    if (!branch || branch === base || branch === "HEAD") continue;
    if (IGNORED_PREFIXES.some(prefix => branch.startsWith(prefix))) continue;
    const count = run("git", [
      "rev-list",
      "--count",
      `${remote}/${base}..${remote}/${branch}`,
    ]);
    const ahead = Number.parseInt(count ?? "", 10);
    if (Number.isFinite(ahead) && ahead > 0) rows.push({ ahead, branch });
  }
  return rows;
}

/**
 * Branches carrying commits that no pull request has ever covered.
 * @param {object} inputs Inputs.
 * @param {ReadonlyArray<{branch: string, ahead: number}>} inputs.ahead Branches ahead of base.
 * @param {Set<string>} inputs.submitted Branch names that have a pull request.
 * @returns {ReadonlyArray<{branch: string, ahead: number}>} The orphans.
 */
export function orphanedBranches({ ahead, submitted }) {
  return ahead.filter(row => !submitted.has(row.branch));
}

/**
 * Report orphaned branches.
 * @param {string[]} argv Arguments.
 * @returns {number} Exit code.
 */
export function main(argv = process.argv.slice(2)) {
  const remote = "origin";
  const base = defaultBranch(remote);
  if (!base) {
    console.error(
      "check-orphaned-branches: could not resolve the remote default branch, so nothing was checked. This is NOT a clean result."
    );
    return EXIT.UNAVAILABLE;
  }
  const ahead = branchesAhead(remote, base);
  const submitted = branchesWithPullRequests();
  if (ahead === undefined || submitted === undefined) {
    console.error(
      `check-orphaned-branches: could not read ${ahead === undefined ? "branches" : "pull requests"}, so nothing was checked. This is NOT a clean result.`
    );
    return EXIT.UNAVAILABLE;
  }
  const orphans = orphanedBranches({ ahead, submitted });
  if (orphans.length === 0) {
    console.log(
      `check-orphaned-branches: every remote branch ahead of ${base} has a pull request.`
    );
    return EXIT.OK;
  }
  console.log(
    `check-orphaned-branches: ${orphans.length} branch(es) carry commits that were pushed and never submitted.\n`
  );
  for (const { branch, ahead: count } of [...orphans].sort((a, b) =>
    a.branch.localeCompare(b.branch)
  ))
    console.log(
      `  ${branch} — ${count} commit(s) ahead of ${base}, no pull request`
    );
  console.log(
    "\nWork on these branches is in no review, no CI run, and no report, and it drifts from " +
      `${base} until it is submitted or deleted. Open a pull request for each, or delete the branch ` +
      "if the work is abandoned — but decide, rather than leaving it invisible."
  );
  return argv.includes("--fail-on-found") ? EXIT.FOUND : EXIT.OK;
}

if (invokedAsScript(import.meta.url)) {
  // exitCode (not process.exit): when stdout is a pipe, writes are async and
  // process.exit() truncates the report mid-flush.
  process.exitCode = main(process.argv.slice(2));
}
