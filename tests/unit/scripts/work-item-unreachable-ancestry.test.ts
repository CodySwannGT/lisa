/**
 * The push range's own bounds, asked about IN-PROCESS so mutants can be killed.
 *
 * There are end-to-end cases for this in `lisa-work-item.test.ts`, and they
 * prove the wiring — the refusal really does reach an operator running a real
 * push. They cannot prove anything else. That suite drives the validator by
 * SPAWNING it, and Stryker activates a mutant through an in-process global on
 * `globalThis.__stryker__`, which a child process cannot see. So every mutant in
 * this code survived a full gate run: 58 generated, 0 killed, including
 * `function ancestryUnreachable() {}` — a body that can never diagnose anything.
 * A suite that cannot fail on that is not evidence about this code.
 *
 * Hence this file. It imports the two functions directly and drives them
 * against real repositories, which is the only shape the mutation gate can
 * measure. See `tests/support/work-item-cli.ts` for the same reasoning applied
 * to the rest of the validator.
 * @module tests/unit/scripts/work-item-unreachable-ancestry
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  ancestryUnreachable,
  unreachableAncestryRefusal,
} from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  cleanupFixtures,
  cleanupTemplates,
  createFixture,
  Fixture,
  git,
  githubConfig,
} from "../../support/work-item-cli.js";

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/** Git's flag for a commit with no tree change, which every fixture commit is. */
const EMPTY_COMMIT = "--allow-empty";

/** A ref name whose only job is to be reported back in a refusal. */
const SOME_REF = "refs/heads/x";

/** The rev-list vector the new-branch lane builds for a tip. */
const scopeFor = (tip: string): string[] => [
  "rev-list",
  tip,
  "--not",
  "--remotes=origin",
];

/**
 * Run one call with the fixture's repository installed in the environment.
 *
 * `ancestryUnreachable` shells out to git, and git resolves its repository from
 * `GIT_DIR`/`GIT_WORK_TREE` rather than from the working directory — pointing at
 * the fixture that way is what lets this run under Stryker's threads pool,
 * where `process.chdir()` throws outright.
 * @param fixture - The repository to run against.
 * @param call - The thunk to run inside it.
 * @returns Whatever the thunk returned.
 */
function inFixture<T>(fixture: Fixture, call: () => T): T {
  const saved = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    for (const [key, value] of Object.entries({
      ...fixture.env,
      GIT_DIR: `${fixture.root}/.git`,
      GIT_WORK_TREE: fixture.root,
    }))
      if (value !== undefined) process.env[key] = value;
    return call();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    for (const [key, value] of Object.entries(saved))
      if (value !== undefined) process.env[key] = value;
  }
}

/**
 * Publish a base and branch from it — the ordinary, still-reachable shape.
 * @param fixture - The repository to build in.
 * @returns The branch tip.
 */
function ordinaryBranch(fixture: Fixture): string {
  const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
  git(
    fixture.root,
    ["update-ref", "refs/remotes/origin/main", base],
    fixture.env
  );
  git(
    fixture.root,
    ["commit", "-q", EMPTY_COMMIT, "-m", "feat: branch work"],
    fixture.env
  );
  return git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
}

/**
 * The same branch, after the remote's history is replaced by a disjoint one.
 *
 * That is what an identifier scrub leaves behind: every commit gets a new object
 * id, so nothing this branch was built on is reachable from the remote any more.
 * @param fixture - The repository to build in.
 * @returns The branch tip, now with unreachable ancestry.
 */
function branchStrandedByRewrite(fixture: Fixture): string {
  const head = ordinaryBranch(fixture);
  const branch = git(
    fixture.root,
    ["rev-parse", "--abbrev-ref", "HEAD"],
    fixture.env
  );
  git(fixture.root, ["switch", "-q", "--orphan", "rewritten"], fixture.env);
  git(
    fixture.root,
    ["commit", "-q", EMPTY_COMMIT, "-m", "chore: rewritten history"],
    fixture.env
  );
  const rewritten = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
  git(
    fixture.root,
    ["update-ref", "refs/remotes/origin/main", rewritten],
    fixture.env
  );
  git(fixture.root, ["switch", "-q", branch], fixture.env);
  return head;
}

/**
 * The range the new-branch lane would compute for a tip.
 * @param fixture - The repository to read.
 * @param tip - The branch tip being pushed.
 * @returns The group shape `ancestryUnreachable` is asked about.
 */
function groupFor(
  fixture: Fixture,
  tip: string
): { commits: string[]; scope: string[] } {
  const scope = scopeFor(tip);
  return {
    commits: git(fixture.root, scope, fixture.env).split("\n").filter(Boolean),
    scope,
  };
}

describe("ancestryUnreachable", () => {
  it("is true when the range runs back to a parentless commit", () => {
    const fixture = createFixture(githubConfig("trailer"));
    const head = branchStrandedByRewrite(fixture);
    const group = groupFor(fixture, head);

    // The range itself is the evidence: it no longer stops at a published base,
    // so it swept up commits this branch did not author.
    expect(group.commits.length).toBeGreaterThan(1);
    expect(inFixture(fixture, () => ancestryUnreachable(group, "origin"))).toBe(
      true
    );
  });

  it("is false for an ordinary branch, however long", () => {
    // The control that gives the case above meaning. Without it, a function
    // that always answered true would pass.
    const fixture = createFixture(githubConfig("trailer"));
    const head = ordinaryBranch(fixture);
    const group = groupFor(fixture, head);

    expect(group.commits).toHaveLength(1);
    expect(inFixture(fixture, () => ancestryUnreachable(group, "origin"))).toBe(
      false
    );
  });

  it("is false on a first push, where a root commit in range is legitimate", () => {
    // Nothing is published yet, so the exclusion set is empty because there is
    // nothing to exclude — not because history moved underneath the branch.
    const fixture = createFixture(githubConfig("trailer"));
    git(
      fixture.root,
      ["commit", "-q", EMPTY_COMMIT, "-m", "feat: first ever change"],
      fixture.env
    );
    const head = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
    const group = groupFor(fixture, head);

    expect(inFixture(fixture, () => ancestryUnreachable(group, "origin"))).toBe(
      false
    );
  });

  it("is false when the remote name matches nothing, rather than throwing", () => {
    // A repository whose remote is named something else must not be diagnosed
    // as rewritten; it has simply published nothing under this name.
    const fixture = createFixture(githubConfig("trailer"));
    const head = branchStrandedByRewrite(fixture);
    const group = groupFor(fixture, head);

    expect(
      inFixture(fixture, () => ancestryUnreachable(group, "upstream"))
    ).toBe(false);
  });

  it("is false for an empty range and for a range with no bounds recorded", () => {
    const fixture = createFixture(githubConfig("trailer"));
    const head = ordinaryBranch(fixture);

    expect(
      inFixture(fixture, () =>
        ancestryUnreachable({ commits: [], scope: scopeFor(head) }, "origin")
      )
    ).toBe(false);
    expect(
      inFixture(fixture, () =>
        ancestryUnreachable({ commits: [head], scope: [] }, "origin")
      )
    ).toBe(false);
  });
});

describe("unreachableAncestryRefusal", () => {
  it("names the branch it refused", () => {
    const error = unreachableAncestryRefusal("refs/heads/feature/tracked");

    expect(error.message).toContain("feature/tracked");
    expect(error.message).not.toContain("refs/heads/");
  });

  it("falls back to a readable subject when no ref was named", () => {
    expect(unreachableAncestryRefusal(undefined).message).toContain(
      "this branch"
    );
  });

  it("states the cause, clears the author, and gives the move that works", () => {
    // Asserted as three claims rather than as one literal. Pinning the exact
    // sentence would check that nobody reworded it, never that it is true.
    const message = unreachableAncestryRefusal(SOME_REF).message;

    expect(message).toContain("no longer reachable");
    expect(message).toContain("rewritten");
    expect(message).toContain("Nothing is wrong with what you wrote");
    // Both halves of the remedy, because either alone leaves it unusable: the
    // ACTION (copy the commits somewhere else) and the TOOL that does it. A
    // hand-run mutant that deleted the action survived an assertion naming only
    // the tool, which is the message saying "use cherry-pick" without saying
    // what to cherry-pick or where.
    expect(message).toContain("copy your commits");
    expect(message).toContain("cherry-pick");
    // The move an author reaches for first, and the one that cannot work.
    expect(message).toContain("does NOT help");
  });

  it("says nothing about work items, which is the defect being repaired", () => {
    // The refusal this replaces argued about a stranger's closed ticket. A
    // message that still argues about tickets has been decorated, not fixed.
    const message = unreachableAncestryRefusal(SOME_REF).message;

    expect(message).not.toContain("Work-Item");
    expect(message).not.toContain("work item");
  });

  it("suppresses the five-gate checklist", () => {
    // `selfExplanatory` is what stops the reporter appending "mention the
    // ticket this work relates to" — advice that points away from the fix.
    expect(unreachableAncestryRefusal(SOME_REF).selfExplanatory).toBe(true);
  });
});
