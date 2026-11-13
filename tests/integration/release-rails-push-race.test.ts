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
 * Every case runs the shipped job against a local bare remote — see
 * `tests/helpers/release-rails-job.ts` for how GitHub is stood in for.
 * @module tests/integration/release-rails-push-race
 */
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
} from "../helpers/release-rails-job.js";

const BRANCH = "main";
const scratchRoots: string[] = [];

/**
 * A fresh remote at VERSION 0.0.1, removed after the case.
 * @returns The fixture.
 */
function freshFixture(): ReleaseFixture {
  const fixture = releaseFixture("0.0.1", BRANCH);

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

describe("release-rails.yml racing merges (#4748)", () => {
  afterEach(() => {
    for (const root of scratchRoots.splice(0)) {
      fs.removeSync(root);
    }
  });

  it("releases onto the moved branch tip instead of orphaning the tag", () => {
    const fixture = freshFixture();
    const runA = cloneRemote(fixture, "a");
    const other = cloneRemote(fixture, "b");

    // Merge A triggers run A; its checkout is the push-event SHA.
    landMerge(fixture, runA, "a.txt");
    // Merge B lands before run A pushes.
    landMerge(fixture, other, "b.txt");

    const run = runReleaseJob(fixture, runA);

    // Checked first: the orphan is the defect, the failed run only its echo.
    expectNoOrphanedTags(fixture.remote);
    expect(run.status, run.output).toBe(0);
    expect(run.outputs["version"]?.["tag"]).toBe("v0.0.2");
    expect(tags(fixture.remote)).toContain("v0.0.2");
    expect(isAncestor(fixture.remote, "v0.0.2", BRANCH)).toBe(true);
    // The release carries both merges, so nothing is left unreleased.
    expect(git(fixture.remote, "show", `${BRANCH}:VERSION`)).toBe("0.0.2");
    expect(git(fixture.remote, "show", `${BRANCH}:b.txt`)).toBe("b.txt");
    expect(run.createsGithubRelease).toBe(true);
  });

  it("re-bumps and retries when the branch moves between fetch and push", () => {
    const fixture = freshFixture();
    const runA = cloneRemote(fixture, "a");
    const other = cloneRemote(fixture, "b");

    landMerge(fixture, runA, "a.txt");
    // One concurrent merge lands while the first attempt bumps, so the first
    // push is a genuine non-fast-forward rejection.
    const run = runReleaseJob(fixture, runA, { clone: other, landings: 1 });

    expect(run.status, run.output).toBe(0);
    expect(run.npxCalls).toHaveLength(2);
    expect(run.outputs["version"]?.["tag"]).toBe("v0.0.2");
    expect(isAncestor(fixture.remote, "v0.0.2", BRANCH)).toBe(true);
    expect(git(fixture.remote, "show", `${BRANCH}:concurrent.txt`)).toBe("1");
    expectNoOrphanedTags(fixture.remote);
  });

  it("gives up after three rejected attempts and leaves no tag behind", () => {
    const fixture = freshFixture();
    const runA = cloneRemote(fixture, "a");
    const other = cloneRemote(fixture, "b");

    landMerge(fixture, runA, "a.txt");
    const run = runReleaseJob(fixture, runA, { clone: other, landings: 99 });

    expect(run.status).not.toBe(0);
    expect(run.npxCalls).toHaveLength(3);
    expect(run.output).toContain("::error::");
    expect(run.output).toContain("3 attempts");
    // Atomic: a rejected branch took its tag down with it every time.
    expect(tags(fixture.remote)).toEqual([]);
    expect(run.createsGithubRelease).toBe(false);
  });

  it("defers when a concurrent run already released the trigger commit", () => {
    const fixture = freshFixture();
    const runA = cloneRemote(fixture, "a");
    const runB = cloneRemote(fixture, "b");

    landMerge(fixture, runA, "a.txt");
    const triggerB = landMerge(fixture, runB, "b.txt");

    // Run A releases first, from the tip that already contains merge B.
    expect(runReleaseJob(fixture, runA).status).toBe(0);
    const tipAfterA = git(fixture.remote, "rev-parse", BRANCH);

    // Run B still sits on its own push-event SHA.
    expect(git(runB, "rev-parse", "HEAD")).toBe(triggerB);
    const run = runReleaseJob(fixture, runB);

    expect(run.status, run.output).toBe(0);
    expect(run.outputs["version"]?.["deferred"]).toBe("true");
    expect(run.npxCalls).toEqual([]);
    expect(git(fixture.remote, "rev-parse", BRANCH)).toBe(tipAfterA);
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
});
