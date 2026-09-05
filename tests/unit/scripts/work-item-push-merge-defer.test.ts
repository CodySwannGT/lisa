/**
 * A merge-conflict resolution can be pushed (#3851).
 *
 * Two required gates deadlocked. `artifact-freshness` requires the regeneration
 * to live IN the merge commit, because a take-a-side conflict resolution is
 * stale by construction. The unpushed range is then exactly one merge, merges
 * are trailer-exempt, the non-merge set is empty, and the traceability gate
 * refused the push with "Pull request has no non-merge commit linked to a work
 * item". Putting the regeneration in a second commit satisfies the traceability
 * gate but requires creating the merge first with a stale artifact, which
 * `artifact-freshness` refuses at commit time. **There was no legal commit
 * sequence**, and it blocked a queue of pull requests whose only conflict was a
 * generated file.
 *
 * The gate's own advice could not be followed either: it says to amend the
 * commit and force-push, but there is no non-merge commit to amend, and the
 * destructive-command guard refuses `--force`.
 *
 * ## What is wrong, and what must not be touched
 *
 * The RANGE is right and must not be widened. `parsePushGroups` excludes
 * commits already on the remote branch and everything reachable from the remote
 * default branch, and it deliberately never uses `--remotes=<remote>` — that
 * ref set includes the branch being force-pushed and would let a pusher exempt
 * arbitrary commits. Widening the range was proposed for this defect and
 * refuted for exactly that reason.
 *
 * The VERDICT drawn from it was wrong. A push range is always a SUBSET of the
 * pull request's, so "nothing to check here" is not "the pull request checks
 * out to nothing" — the trailered commit is excluded precisely because an
 * earlier push already validated it. The commit-side question has no subject in
 * this push; its subject is the pull request, where `validate-pr` asks it from
 * `base..head` under the required `🔗 Work-Item Traceability` check.
 *
 * ## Why this file builds a remote
 *
 * The shared fixture has none, so `remoteDefaultRef` resolves to undefined and
 * the range loses its `--not <default>` exclusion — which would pull `main`'s
 * own commits into the pushed range and model a different situation entirely.
 * A faithful replay needs `origin` and `refs/remotes/origin/HEAD` to exist.
 * @module tests/unit/scripts/work-item-push-merge-defer
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
  createFixture,
  Fixture,
  git,
  githubConfig,
  REF,
} from "../../support/work-item-cli.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "all/copy-overwrite/scripts/lisa-work-item.mjs"
);
const BRANCH = "fix/thing";
const LOCAL_REF = `refs/heads/${BRANCH}`;

/** A branch mid-merge-resolution, plus the two shas a pre-push line carries. */
interface Replay {
  readonly fixture: Fixture;
  /** The already-pushed branch tip — the remote's current value for the ref */
  readonly remoteOid: string;
  /** The merge commit about to be pushed */
  readonly localOid: string;
}

/**
 * Commit a file in the fixture.
 * @param fixture - The repository
 * @param file - File to write
 * @param message - Commit message
 * @returns The new commit sha
 */
function commitFile(fixture: Fixture, file: string, message: string): string {
  writeFileSync(path.join(fixture.root, file), `${file}\n`);
  git(fixture.root, ["add", file], fixture.env);
  git(fixture.root, ["commit", "--no-verify", "-m", message], fixture.env);
  return git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
}

/**
 * Replay the deadlock: a branch whose only unpushed commit is a merge of main.
 *
 * The trailered commit is pushed FIRST, so it lands in the remote-tracking ref
 * and is excluded from the next push's range exactly as in the wild. That
 * exclusion is the whole mechanism — a fixture that skipped it would leave the
 * trailered commit visible and never reproduce the defect.
 * @returns The replayed branch
 */
function replayMergeResolution(): Replay {
  const fixture = createFixture(githubConfig("trailer"));
  const origin = mkdtempSync(path.join(tmpdir(), "lisa-3851-origin-"));
  const { env, root } = fixture;

  git(root, ["init", "--bare", "--initial-branch=main"], {
    ...env,
    GIT_DIR: origin,
  });
  git(root, ["remote", "add", "origin", origin], env);
  git(root, ["push", "-q", "origin", "HEAD:refs/heads/main"], env);
  git(root, ["fetch", "-q", "origin"], env);
  git(
    root,
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    env
  );

  git(root, ["switch", "-q", "-c", BRANCH], env);
  const authored = commitFile(
    fixture,
    "src.txt",
    `fix: the actual change\n\nWork-Item: ${REF}\n`
  );
  git(root, ["push", "-q", "origin", BRANCH], env);

  git(root, ["switch", "-q", "main"], env);
  commitFile(fixture, "other.txt", "chore: unrelated main work");
  git(root, ["push", "-q", "origin", "main"], env);
  git(root, ["fetch", "-q", "origin"], env);
  git(root, ["switch", "-q", BRANCH], env);
  git(
    root,
    ["merge", "--no-verify", "--no-ff", "-m", "Merge main", "origin/main"],
    env
  );

  return {
    fixture,
    localOid: git(root, ["rev-parse", "HEAD"], env),
    remoteOid: authored,
  };
}

/**
 * Drive `validate-push` the way the pre-push hook does.
 * @param replay - The replayed branch
 * @param localOid - Override for the tip being pushed
 * @returns Exit status and streams
 */
function push(replay: Replay, localOid = replay.localOid) {
  return boundedSpawnSync({
    args: [SCRIPT, "validate-push", "origin"],
    command: process.execPath,
    cwd: replay.fixture.root,
    env: replay.fixture.env,
    input: `${LOCAL_REF} ${localOid} ${LOCAL_REF} ${replay.remoteOid}\n`,
    label: "lisa-work-item.mjs validate-push",
  });
}

afterAll(() => {
  cleanupFixtures();
  cleanupTemplates();
});

describe("a merge-only push on an attributed pull request", () => {
  it("is not refused for having no non-merge commit", () => {
    const result = push(replayMergeResolution());
    const output = `${result.stdout}${result.stderr}`;

    // Asserted on the MESSAGE, not just the status: this check reports two
    // independent requirements under one name, and reading the summary rather
    // than the finding is what produced four misdiagnoses of a sibling defect
    // in a single day.
    expect(output).not.toContain("no non-merge commit linked to a work item");
    expect(result.status, output).toBe(0);
  });
});

describe("the control: an untrailered commit is still refused", () => {
  // A fix that merely relaxed the gate would pass the case above and break
  // this one. `validateCommits` counts a commit as relevant BEFORE reading its
  // trailer, so an empty non-merge set can never be produced by a commit that
  // simply lacks one — this proves that still holds through the change.
  it("refuses a pushed non-merge commit carrying no trailer", () => {
    const replay = replayMergeResolution();
    const tip = commitFile(
      replay.fixture,
      "untrailered.txt",
      "fix: no trailer"
    );
    const result = push(replay, tip);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status, output).not.toBe(0);
    expect(output).toMatch(/Work-Item|trailer/iu);
  });
});
