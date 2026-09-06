/**
 * An amended merge commit keeps its merge exemption (#3875).
 *
 * The work-item gate had two merge detectors asking two different questions.
 * The commit path asked "is a merge IN PROGRESS?" — `MERGE_HEAD` exists — which
 * is a transient repository state that `git merge` clears the moment the merge
 * commits. The push path asked "does this commit have two parents?", a property
 * of the commit itself.
 *
 * So folding a regenerated artifact into the sync merge that staled it —
 * `git commit --amend` on a merge that has already landed — met a commit that
 * is still a merge by every structural measure, presenting as an ordinary one
 * and refused for lacking a `Work-Item:` trailer. The refusal then advised
 * adding a trailer to a merge commit, which is the one place the project's own
 * rules say a trailer does not belong.
 *
 * ## Why the obvious fix is not the fix
 *
 * At `commit-msg` time the commit does not exist yet, so its parents cannot be
 * counted — which is why the transient check was there. Counting HEAD's parents
 * unconditionally would exempt an ordinary commit authored ON TOP of a merge,
 * which is the strictly worse failure: an unlinked commit let through rather
 * than a linked one blocked. The second scenario below is that control, and a
 * fix that merely relaxed the gate fails it.
 * @module tests/unit/scripts/work-item-amended-merge-exemption
 */
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  bindTo,
  cleanupFixtures,
  cleanupTemplates,
  cli,
  Fixture,
  git,
  offlineFixture,
  REF,
} from "../../support/work-item-cli.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "all/copy-overwrite/scripts/lisa-work-item.mjs"
);
const VALIDATE = "validate-commit";
const BRANCH = "feature/tracked";
const LOCAL_REF = `refs/heads/${BRANCH}`;
const MERGE_SUBJECT = `Merge branch 'main' into ${BRANCH}`;

/** A branch whose tip is a completed merge, plus what a pre-push line carries. */
interface Merged {
  readonly fixture: Fixture;
  /** The merge commit at the branch tip. */
  readonly localOid: string;
  /** The already-pushed branch tip the merge sits on top of. */
  readonly remoteOid: string;
}

/**
 * Commit one file in the fixture.
 * @param fixture - The repository to commit in.
 * @param file - File to write, named after itself.
 * @param message - Commit message.
 * @returns The new commit's object id.
 */
function commitFile(fixture: Fixture, file: string, message: string): string {
  writeFileSync(path.join(fixture.root, file), `${file}\n`);
  git(fixture.root, ["add", file], fixture.env);
  git(fixture.root, ["commit", "-q", "-m", message], fixture.env);
  return git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
}

/**
 * Write a proposed commit message where the hook would find it.
 * @param fixture - The repository to write in.
 * @param body - The message text.
 * @returns Absolute path of the file.
 */
function proposed(fixture: Fixture, body: string): string {
  const file = path.join(fixture.root, "MSG");
  writeFileSync(file, body);
  return file;
}

/**
 * A branch whose tip is a merge of `main` that has ALREADY completed.
 *
 * The remote is real because the push-path assertion needs a range: without
 * `refs/remotes/origin/HEAD` the pushed range loses its `--not <default>`
 * exclusion and pulls `main`'s own commits in, modelling a different situation.
 * @returns The merged branch.
 */
function mergedBranch(): Merged {
  const fixture = offlineFixture();
  const { env, root } = fixture;
  bindTo(fixture, REF);

  const origin = mkdtempSync(path.join(tmpdir(), "lisa-3875-origin-"));
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
  git(root, ["merge", "--no-ff", "-m", MERGE_SUBJECT, "origin/main"], env);

  return {
    fixture,
    localOid: git(root, ["rev-parse", "HEAD"], env),
    remoteOid: authored,
  };
}

/**
 * The merge state every case here depends on: two parents, and no `MERGE_HEAD`.
 *
 * Asserted rather than assumed. If `git merge` left `MERGE_HEAD` behind, the
 * pre-existing transient check would answer these cases and they would pass
 * without touching the mechanism they exist for.
 * @param merged - The merged branch.
 */
function assertMergeCompleted(merged: Merged): void {
  const { env, root } = merged.fixture;
  const parents = git(
    root,
    ["rev-list", "--parents", "-n", "1", "HEAD"],
    env
  ).split(/\s+/u);
  expect(parents).toHaveLength(3);
  expect(
    existsSync(path.join(root, ".git", "MERGE_HEAD")),
    "git merge should have cleared MERGE_HEAD on success"
  ).toBe(false);
}

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

describe("commit-msg on an amend of a completed merge", () => {
  it("exempts it as a merge", () => {
    const merged = mergedBranch();
    assertMergeCompleted(merged);
    // What `git commit --amend --no-edit` puts in the file: the message HEAD
    // already carries. Nothing about the commit's merge-ness changed between
    // the merge and the amend — only MERGE_HEAD did.
    const file = proposed(merged.fixture, `${MERGE_SUBJECT}\n`);

    const result = cli(merged.fixture, [VALIDATE, file]);

    expect(result.exitCode, result.stderr).toBeUndefined();
    expect(result.stdout).toContain("WORK_ITEM_TRACKING_OK merge");
  });

  it("still exempts it when the editor left its comment block behind", () => {
    // `git commit --amend` through an editor hands the hook the message WITH
    // git's `# Please enter the commit message` block still attached. Comparing
    // the raw bytes would refuse exactly the amend this ticket is about.
    const merged = mergedBranch();
    const file = proposed(
      merged.fixture,
      `${MERGE_SUBJECT}\n\n# Please enter the commit message for your changes.\n#\n# On branch ${BRANCH}\n`
    );

    const result = cli(merged.fixture, [VALIDATE, file]);

    expect(result.exitCode, result.stderr).toBeUndefined();
    expect(result.stdout).toContain("WORK_ITEM_TRACKING_OK merge");
  });
});

describe("the control: a NEW commit on top of a merge is still checked", () => {
  it("refuses one carrying no trailer", () => {
    // Treating every commit-msg invocation as an amend would exempt this, and
    // that is a worse defect than the one being fixed — it lets an unlinked
    // commit through instead of blocking a linked one.
    const merged = mergedBranch();
    assertMergeCompleted(merged);
    const file = proposed(merged.fixture, "chore: fold in generated files\n");

    const result = cli(merged.fixture, [VALIDATE, file]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Work-Item/u);
  });

  it("accepts one carrying a matching trailer, by its trailer", () => {
    // The counter-control. Without it the case above also passes for a build
    // that refuses every commit authored on top of a merge. `OK <ref>` rather
    // than `OK merge` is the load-bearing half: this commit earned its way
    // through the gate, it was not waved past it.
    const merged = mergedBranch();
    const file = proposed(
      merged.fixture,
      `chore: fold in generated files\n\nWork-Item: ${REF}\n`
    );

    const result = cli(merged.fixture, [VALIDATE, file]);

    expect(result.exitCode, result.stderr).toBeUndefined();
    expect(result.stdout).toContain(`WORK_ITEM_TRACKING_OK ${REF}`);
    expect(result.stdout).not.toContain("OK merge");
  });
});

describe("the two detectors agree", () => {
  it("exempts the same merge commit on the push path, by parent count", () => {
    const merged = mergedBranch();
    assertMergeCompleted(merged);

    const result = boundedSpawnSync({
      args: [SCRIPT, "validate-push", "origin"],
      command: process.execPath,
      cwd: merged.fixture.root,
      env: merged.fixture.env,
      input: `${LOCAL_REF} ${merged.localOid} ${LOCAL_REF} ${merged.remoteOid}\n`,
      label: "lisa-work-item.mjs validate-push",
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status, output).toBe(0);
    expect(output).toContain("1 merge commit(s)");
  });
});
