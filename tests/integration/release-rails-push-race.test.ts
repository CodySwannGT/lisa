/**
 * Two merges racing to `main` must never orphan the production tag
 * (CodySwannGT/lisa#4748).
 *
 * `release-rails.yml` used to bump and tag on the push-event SHA and then run
 * `git push --follow-tags origin <branch>`. That push updates each ref on its
 * own: when a second merge had already moved the branch, the branch ref was
 * rejected as non-fast-forward but the tag ref was accepted. The tag then
 * named a commit that is not on the branch, every later run computed the same
 * version from the unchanged VERSION file, hit the "tag already exists on a
 * different commit" guard, and production releases stayed wedged until a human
 * bumped VERSION by hand.
 *
 * The release is built only on the trigger commit, because that is the commit
 * the caller's pre-deploy gates checked and the deploy ships what the release
 * covers. A run whose branch moved past that commit therefore publishes
 * nothing and fails as superseded; the run for the newer commit releases it.
 *
 * Every case runs the shipped job against a local bare remote — see
 * `tests/helpers/release-rails-job.ts` for how GitHub is stood in for.
 * @module tests/integration/release-rails-push-race
 */
import * as path from "node:path";

import * as fs from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";

import {
  cloneRemote,
  git,
  isAncestor,
  landMerge,
  releaseFixture,
  runReleaseJob,
  tags,
  type ReleaseFixture,
  type ReleaseRun,
} from "../helpers/release-rails-job.js";

const BRANCH = "main";
const scratchRoots: string[] = [];

/** The bare remote's pre-receive hook, relative to the remote. */
const PRE_RECEIVE = path.join("hooks", "pre-receive");

/**
 * A fresh remote at VERSION 0.0.1, removed after the case.
 * @param branch - Branch the release runs on.
 * @returns The fixture.
 */
function freshFixture(branch: string = BRANCH): ReleaseFixture {
  const fixture = releaseFixture("0.0.1", branch);

  scratchRoots.push(fixture.base);
  return fixture;
}

/**
 * Asserts that every tag on the remote names a commit on the branch.
 * @param remote - The bare remote.
 */
function expectNoOrphanedTags(remote: string): void {
  for (const tag of tags(remote)) {
    expect(isAncestor(remote, tag, BRANCH), `${tag} is not on ${BRANCH}`).toBe(
      true
    );
  }
}

/**
 * Lands a staging release on `main` the way a promotion does: staging cuts
 * `chore(release): 0.0.2` on top of main's tip, then main takes it through
 * a merge commit or a fast-forward.
 * @param fixture - The fixture whose remote is promoted.
 * @param how - `merge` for a `--no-ff` promotion, `fast-forward` otherwise.
 * @param tag - The staging release's tag: scoped `v0.0.2-staging.1`, or a
 *   clean `v0.0.2` as staging cut before #3467 scoped its tags.
 */
function promoteForeignRelease(
  fixture: ReleaseFixture,
  how: "merge" | "fast-forward",
  tag: string
): void {
  const staging = cloneRemote(fixture, `staging-${how}`);

  git(staging, "checkout", "--quiet", "-b", "staging");
  fs.writeFileSync(path.join(staging, "VERSION"), "0.0.2\n");
  git(staging, "commit", "--quiet", "-am", "chore(release): 0.0.2");
  git(staging, "tag", "-a", tag, "-m", "staging release");
  git(staging, "push", "--quiet", "origin", "HEAD:refs/heads/staging");
  git(staging, "push", "--quiet", "origin", `refs/tags/${tag}`);
  git(staging, "checkout", "--quiet", BRANCH);
  if (how === "merge") {
    git(
      staging,
      "merge",
      "--quiet",
      "--no-ff",
      "-m",
      "Merge branch 'staging' into main",
      "staging"
    );
    git(staging, "push", "--quiet", "origin", `HEAD:refs/heads/${BRANCH}`);
    return;
  }
  git(staging, "push", "--quiet", "origin", `staging:refs/heads/${BRANCH}`);
}

/**
 * Makes the remote refuse every push without the branch moving: a revoked
 * deploy key, a ruleset, or a network failure, rather than a race.
 * @param fixture - The fixture whose remote refuses.
 */
function refuseAllPushes(fixture: ReleaseFixture): void {
  const hook = path.join(fixture.remote, PRE_RECEIVE);

  fs.writeFileSync(
    hook,
    "#!/bin/sh\necho 'push refused by policy' >&2\nexit 1\n"
  );
  fs.chmodSync(hook, 0o700);
}

/**
 * Makes the remote reject the next push and then disappear, so the run's
 * follow-up fetch fails too and it cannot tell a race from a refusal.
 * @param fixture - The fixture whose remote vanishes.
 */
function vanishOnPush(fixture: ReleaseFixture): void {
  const hook = path.join(fixture.remote, PRE_RECEIVE);

  fs.writeFileSync(
    hook,
    `#!/bin/sh\nmv '${fixture.remote}' '${fixture.remote}.gone'\nexit 1\n`
  );
  fs.chmodSync(hook, 0o700);
}

/**
 * Puts back a remote that `vanishOnPush` moved away, minus its hook.
 * @param fixture - The fixture whose remote vanished.
 */
function restoreVanished(fixture: ReleaseFixture): void {
  fs.renameSync(`${fixture.remote}.gone`, fixture.remote);
  fs.removeSync(path.join(fixture.remote, PRE_RECEIVE));
}

/**
 * Asserts a run refused to release because its branch moved past the gated
 * trigger commit, and that it published nothing.
 * @param run - The run.
 * @param fixture - The fixture it ran against.
 * @param tip - The branch tip the racing merge left, which must be untouched.
 */
function expectSuperseded(
  run: ReleaseRun,
  fixture: ReleaseFixture,
  tip: string
): void {
  expect(run.status, run.output).not.toBe(0);
  expect(run.output).toContain("::error title=Release superseded::");
  expect(run.output).toContain(tip);
  expect(tags(fixture.remote)).toEqual([]);
  expect(git(fixture.remote, "rev-parse", fixture.branch)).toBe(tip);
  expect(run.createsGithubRelease).toBe(false);
}

describe("release-rails.yml racing merges (#4748)", () => {
  afterEach(() => {
    for (const root of scratchRoots.splice(0)) {
      fs.removeSync(root);
    }
  });

  it("refuses a release the branch has moved past, leaving no tag behind", () => {
    const fixture = freshFixture();
    const runA = cloneRemote(fixture, "a");
    const other = cloneRemote(fixture, "b");

    // Merge A triggers run A; its checkout is the push-event SHA, which is
    // also the commit the caller's pre-deploy gates checked.
    const triggerA = landMerge(fixture, runA, "a.txt");
    // Merge B lands before run A releases.
    const mergeB = landMerge(fixture, other, "b.txt");

    const run = runReleaseJob(fixture, runA);

    // Checked first: the orphan is the original defect.
    expectNoOrphanedTags(fixture.remote);
    expectSuperseded(run, fixture, mergeB);
    expect(run.output).toContain(triggerA);
    // Nothing was even bumped: a release of the tip would cover merge B,
    // which this run's gates never checked.
    expect(run.npxCalls).toEqual([]);
  });

  it("refuses when the branch moves between the bump and the push", () => {
    const fixture = freshFixture();
    const runA = cloneRemote(fixture, "a");
    const other = cloneRemote(fixture, "b");

    landMerge(fixture, runA, "a.txt");
    // A concurrent merge lands while the run bumps, so the atomic push is a
    // genuine non-fast-forward rejection.
    const run = runReleaseJob(fixture, runA, { clone: other, landings: 1 });

    expectSuperseded(run, fixture, git(other, "rev-parse", "HEAD"));
    // One bump, no rebuild on the ungated tip.
    expect(run.npxCalls).toHaveLength(1);
  });

  it("refuses a raced non-production release the same way", () => {
    const fixture = freshFixture("staging");
    const runA = cloneRemote(fixture, "a");
    const other = cloneRemote(fixture, "b");

    landMerge(fixture, runA, "a.txt");
    const run = runReleaseJob(fixture, runA, { clone: other, landings: 1 });

    expectSuperseded(run, fixture, git(other, "rev-parse", "HEAD"));
    expect(run.npxCalls).toHaveLength(1);
  });

  it("defers when a concurrent run already released the trigger commit", () => {
    const fixture = freshFixture();
    const runA = cloneRemote(fixture, "a");
    const runB = cloneRemote(fixture, "b");

    const triggerA = landMerge(fixture, runA, "a.txt");
    landMerge(fixture, runB, "b.txt");

    // Run B, on the tip, releases first; its release contains merge A.
    expect(runReleaseJob(fixture, runB).status).toBe(0);
    const tipAfterB = git(fixture.remote, "rev-parse", BRANCH);

    // Run A still sits on its own push-event SHA.
    expect(git(runA, "rev-parse", "HEAD")).toBe(triggerA);
    const run = runReleaseJob(fixture, runA);

    expect(run.status, run.output).toBe(0);
    expect(run.outputs["version"]?.["deferred"]).toBe("true");
    expect(run.outputs["version"]?.["tag"]).toBe("v0.0.2");
    expect(run.npxCalls).toEqual([]);
    expect(git(fixture.remote, "rev-parse", BRANCH)).toBe(tipAfterB);
    expect(tags(fixture.remote)).toEqual(["v0.0.2"]);
    expectNoOrphanedTags(fixture.remote);
  });

  it("advances past a production tag already taken by another commit", () => {
    const fixture = freshFixture();
    const runA = cloneRemote(fixture, "a");
    const orphan = cloneRemote(fixture, "orphan");

    // The wedged state the old push left behind: v0.0.2 on a commit that is
    // not on main, while main's VERSION still says 0.0.1.
    git(orphan, "commit", "--quiet", "--allow-empty", "-m", "orphaned");
    git(orphan, "tag", "-a", "v0.0.2", "-m", "orphaned release");
    git(orphan, "push", "--quiet", "origin", "refs/tags/v0.0.2");
    landMerge(fixture, runA, "a.txt");

    const run = runReleaseJob(fixture, runA);

    expect(run.status, run.output).toBe(0);
    expect(run.outputs["version"]?.["version"]).toBe("0.0.3");
    expect(run.outputs["version"]?.["tag"]).toBe("v0.0.3");
    expect(run.npxCalls).toContain(
      "standard-version@9 --skip.tag --release-as 0.0.3"
    );
    expect(git(fixture.remote, "show", `${BRANCH}:VERSION`)).toBe("0.0.3");
    expect(isAncestor(fixture.remote, "v0.0.3", BRANCH)).toBe(true);
  });

  // `merge` + scoped tag is caught by either guard; `fast-forward` puts the
  // staging commit on main's first-parent line, so only the tag-namespace
  // check stops it; `merge` + a legacy clean tag passes the namespace check,
  // so only `--first-parent` stops it.
  it.each([
    ["merge", "v0.0.2-staging.1"],
    ["fast-forward", "v0.0.2-staging.1"],
    ["merge", "v0.0.2"],
  ] as const)(
    "does not defer to a staging release promoted into main (%s, %s)",
    (how, tag) => {
      const fixture = freshFixture();
      const runT = cloneRemote(fixture, "t");

      // Hotfix T merges to main; its run is still queued when a staging
      // release is promoted back into main on top of it.
      landMerge(fixture, runT, "hotfix.txt");
      promoteForeignRelease(fixture, how, tag);

      const tipBefore = git(fixture.remote, "rev-parse", BRANCH);
      const tagsBefore = tags(fixture.remote);
      const run = runReleaseJob(fixture, runT);

      // Deferring would publish the staging tag as main's release. Instead
      // the promotion moved main past T, so T's run is superseded.
      expect(run.outputs["version"]?.["deferred"]).not.toBe("true");
      expect(run.status).not.toBe(0);
      expect(run.output).toContain("::error title=Release superseded::");
      expect(git(fixture.remote, "rev-parse", BRANCH)).toBe(tipBefore);
      expect(tags(fixture.remote)).toEqual(tagsBefore);
      expect(run.createsGithubRelease).toBe(false);
    }
  );

  it("fails at once, without blaming a race, when the remote refuses the push", () => {
    const fixture = freshFixture();
    const runA = cloneRemote(fixture, "a");

    landMerge(fixture, runA, "a.txt");
    refuseAllPushes(fixture);
    const run = runReleaseJob(fixture, runA);

    expect(run.status).not.toBe(0);
    expect(run.npxCalls).toHaveLength(1);
    expect(run.output).toContain("::error title=Release push refused::");
    expect(run.output).toContain("refused by the remote");
    expect(run.output).not.toContain("kept moving");
    expect(tags(fixture.remote)).toEqual([]);
  });

  it("defers a rerun to its own release and still publishes that tag", () => {
    const fixture = freshFixture();
    const runA = cloneRemote(fixture, "a");
    const trigger = landMerge(fixture, runA, "a.txt");

    expect(runReleaseJob(fixture, runA).status).toBe(0);

    // A rerun checks out the same push-event SHA again.
    const rerun = cloneRemote(fixture, "rerun");

    git(rerun, "reset", "--quiet", "--hard", trigger);
    const run = runReleaseJob(fixture, rerun);

    expect(run.status, run.output).toBe(0);
    expect(run.outputs["version"]?.["deferred"]).toBe("true");
    expect(run.outputs["version"]?.["tag"]).toBe("v0.0.2");
    expect(run.npxCalls).toEqual([]);
    expect(run.createsGithubRelease).toBe(true);
  });

  it("cuts a fresh pre-release tag on a non-production branch", () => {
    const fixture = freshFixture("staging");
    const runA = cloneRemote(fixture, "a");

    landMerge(fixture, runA, "a.txt");
    const run = runReleaseJob(fixture, runA);
    const tag = run.outputs["version"]?.["tag"] ?? "";

    expect(run.status, run.output).toBe(0);
    expect(tag).toMatch(/^v0\.0\.2-staging\.\d+$/u);
    expect(isAncestor(fixture.remote, tag, "staging")).toBe(true);
    expect(tags(fixture.remote)).toEqual([tag]);
  });

  it("reports an unverifiable rejection as inconclusive, not as a refusal", () => {
    const fixture = freshFixture();
    const runA = cloneRemote(fixture, "a");

    landMerge(fixture, runA, "a.txt");
    vanishOnPush(fixture);
    const run = runReleaseJob(fixture, runA);

    restoreVanished(fixture);
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("::error title=Release push failed::");
    expect(run.output).toContain("could not tell");
    expect(run.output).not.toContain("refused by the remote");
    expect(run.output).not.toContain("Release superseded");
    expect(tags(fixture.remote)).toEqual([]);
  });
});
