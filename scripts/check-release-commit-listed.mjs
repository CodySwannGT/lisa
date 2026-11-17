#!/usr/bin/env node
/**
 * Fail a release whose public-commit list does not hold the commit it is being
 * cut from.
 *
 * `lisa file-upstream` accepts a commit reference only when it is on the list
 * built into the package (`UPSTREAM_PUBLIC_COMMITS`). The release hook
 * refreshes that list from git history, and this is the step after it: a
 * release that ships a stale list ships a `file-upstream` that refuses every
 * filing citing recent history, and nothing else notices until an agent in the
 * field tries to file one (CodySwannGT/lisa#4960).
 *
 * The commit a release is cut from is `HEAD` when the hook runs — the release
 * commit itself does not exist yet, and could never be on a list it contains.
 * That commit is the newest thing the refresh can have seen, so its absence
 * means the refresh did not read the history this release is made of: the
 * commit was never pushed, `origin`'s refs were not fetched, or the refresh did
 * not run.
 *
 * It reads the file on disk rather than trusting the refresh's exit code, so it
 * checks what will actually be committed.
 *
 * Exit codes:
 *   0 — the commit is listed; says so on stdout.
 *   1 — it is not; the refusal on stderr names the refresh command.
 * @module scripts/check-release-commit-listed
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { boundedExecFileSync } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  describeUnlistedReleaseCommit,
  listedPublicCommits,
  MANIFEST_PATH,
} from "./lib/upstream-public-commits.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

/**
 * Compare the checked-out commit with the list on disk.
 *
 * A killed or failed `git` propagates rather than reading as "not listed": the
 * refusal below tells the operator to refresh, which would be the wrong advice
 * for a machine that could not answer.
 * @returns {{ok: boolean, message: string}} Verdict and the line to print.
 */
export function checkReleaseCommitListed() {
  const commit = boundedExecFileSync("git", ["rev-parse", "HEAD^{commit}"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const listed = listedPublicCommits(
    readFileSync(path.join(repoRoot, MANIFEST_PATH), "utf8")
  );
  return listed.has(commit)
    ? {
        ok: true,
        message: `Release commit ${commit} is on the upstream public-commit list (${listed.size} commits).`,
      }
    : {
        ok: false,
        message: describeUnlistedReleaseCommit({
          commit,
          listedCount: listed.size,
        }),
      };
}

if (invokedAsScript(import.meta.url)) {
  const verdict = checkReleaseCommitListed();
  if (verdict.ok) {
    console.log(verdict.message);
  } else {
    console.error(verdict.message);
    process.exitCode = 1;
  }
}
