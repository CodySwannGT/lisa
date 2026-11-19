/**
 * The call `lisa controls install-carriers` adds to a hook, in the checkouts
 * it did not expect (CodySwannGT/lisa#4989).
 *
 * The call is a few lines at the end of a hook file the repository owns, and
 * that file may be shared: git's own hooks folder serves every working tree
 * of a repository and every branch checked out in one. So the call has to
 * hold wherever it runs:
 *
 * - after a hook that changed folder, it still finds the carrier, from the
 *   top folder of the checkout;
 * - on a branch that never had Lisa's files, it says the declared checks did
 *   not run and lets the commit or push through, because that branch must
 *   stay usable;
 * - where the checked-out commit has the carrier and the file is gone from
 *   the checkout, it stops with a sentence;
 * - written through a linked working tree, it lands in the hook every
 *   checkout shares, the result says so, and no path from the operator's
 *   machine appears in what is printed.
 * @module tests/integration/controls-install-carriers-checkouts
 */
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CARRIERS_BLOCKED_EXIT_CODE } from "../../src/controls/commands/install-carriers.js";
import {
  gitHooksFolder,
  type OwnedRepository,
  ownedRepository,
  writeExecutable,
} from "../support/carrier-hook-owners.js";
import {
  type CarrierCommandRun,
  commitInstalled,
  commitLine,
  head,
  installCarriers,
  LINT_SHAPE,
  operatorGit,
  PLANTED,
  runs,
} from "../support/carrier-install.js";

const CLEAN_LINE = "# a harmless comment";
const COMMIT_HOOK = "pre-commit";
const PUSH_HOOK = "pre-push";
const CARRIER = ".lisa/hooks/pre-commit";
const SHARED = /shared by every checkout of this repository/u;
const DID_NOT_RUN =
  /The checks this repository requires before a (?:commit|push) did not run in this checkout: the commit checked out here does not contain \.lisa\/hooks\/pre-(?:commit|push)/u;

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Every shell on this machine a repository's hook may name on its first line. */
const SHELLS = ["/bin/sh", "/bin/dash", "/bin/bash", "/bin/zsh", "/bin/ksh"]
  .filter(shell => existsSync(shell))
  .map(shell => ({ shell }));

/**
 * Build F-none with a declared check and a hand-written hook in git's own
 * hooks folder for each moment.
 * @param lines - What each hook does after it recorded that it ran
 * @param shell - The shell the hook's first line names
 * @returns The repository
 */
function withGitHooks(
  lines: readonly string[] = [],
  shell = "/bin/sh"
): OwnedRepository {
  const owned = ownedRepository();
  cleanups.push(owned.repository.cleanup);
  for (const hook of [COMMIT_HOOK, PUSH_HOOK]) {
    writeExecutable(
      path.join(gitHooksFolder(owned.root), hook),
      [`#!${shell}`, owned.hostCommand, ...lines, ""].join("\n")
    );
  }
  return owned;
}

/**
 * A folder outside every repository, removed when the case ends.
 * @param name - What the folder is for
 * @returns The folder
 */
function outside(name: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), `lisa-carrier-${name}-`));
  cleanups.push(() => rmSync(folder, { force: true, recursive: true }));
  return folder;
}

/**
 * Run git and require it to succeed.
 * @param root - The repository
 * @param args - Arguments to git
 * @returns What git printed
 */
function git(root: string, args: readonly string[]): string {
  const child = operatorGit(root, args);
  if (child.status !== 0) throw new Error(`${child.stdout}${child.stderr}`);
  return child.stdout.trim();
}

/**
 * Add a linked working tree on a new branch.
 * @param root - The repository
 * @param branch - The branch the working tree is on
 * @returns The working tree's top folder
 */
function linkedWorktree(root: string, branch: string): string {
  const worktree = path.join(outside("worktree"), "linked");
  git(root, ["worktree", "add", "--quiet", "-b", branch, worktree]);
  return worktree;
}

/**
 * Everything a run printed, for a person and for a program.
 * @param run - The finished run
 * @returns The result document and the lines said, as one text
 */
function printed(run: CarrierCommandRun): string {
  return `${JSON.stringify(run.result)}\n${run.said.join("\n")}`;
}

/**
 * Every spelling of the machine's temporary folder, which holds each fixture.
 * @returns The folder as it is named and as it resolves
 */
function machinePaths(): readonly string[] {
  return [...new Set([tmpdir(), realpathSync(tmpdir())])];
}

describe("the call added to a hook that changes folder", () => {
  it.each(SHELLS)(
    "still runs the declared check, from the top of the checkout, in a hook written for $shell",
    async ({ shell }) => {
      // A strict hook, as Husky starts one (`sh -e`): an unset variable or a
      // failing command in the added lines would end it.
      const owned = withGitHooks(["set -eu", "cd src"], shell);

      const run = await installCarriers(owned.root);
      commitInstalled(owned.root);
      const before = runs(owned.commitRan);
      const clean = commitLine(owned.root, CLEAN_LINE);
      const planted = commitLine(owned.root, `# ${PLANTED}`);

      expect(run.code).toBe(0);
      expect(`${clean.stdout}${clean.stderr}`).not.toMatch(/No such file/u);
      expect(clean.status).toBe(0);
      expect(planted.status).not.toBe(0);
      expect(`${planted.stdout}${planted.stderr}`).toContain(LINT_SHAPE);
      expect(runs(owned.commitRan)).toBe(before + 2);
    }
  );

  it("still runs it in a linked working tree, where git names its own folder to the hook", async () => {
    const owned = withGitHooks(["cd src"]);
    const worktree = linkedWorktree(owned.root, "linked");

    await installCarriers(worktree);
    commitInstalled(worktree);
    const before = runs(owned.commitRan);
    const clean = commitLine(worktree, CLEAN_LINE);
    const planted = commitLine(worktree, `# ${PLANTED}`);

    expect(clean.status).toBe(0);
    expect(planted.status).not.toBe(0);
    expect(`${planted.stdout}${planted.stderr}`).toContain(LINT_SHAPE);
    expect(runs(owned.commitRan)).toBe(before + 2);
  });
});

describe("the call in a hook that outlives the branch it was installed on", () => {
  it("lets a commit and a push through on a branch without Lisa's files, and says the checks did not run", async () => {
    const owned = withGitHooks();
    const remote = outside("remote");
    git(remote, ["init", "--quiet", "--bare", "."]);
    git(owned.root, ["remote", "add", "origin", remote]);
    git(owned.root, ["checkout", "--quiet", "-b", "with-carriers"]);
    await installCarriers(owned.root);
    commitInstalled(owned.root);
    git(owned.root, ["checkout", "--quiet", "main"]);
    const checksBefore = runs(owned.commitRan) + runs(owned.pushRan);
    const hostBefore = runs(owned.hostRan);

    const commit = commitLine(owned.root, CLEAN_LINE);
    const push = operatorGit(owned.root, ["push", "origin", "main"]);

    expect(commit.status).toBe(0);
    expect(commit.stderr).toMatch(DID_NOT_RUN);
    expect(push.status).toBe(0);
    expect(push.stderr).toMatch(DID_NOT_RUN);
    expect(runs(owned.commitRan) + runs(owned.pushRan)).toBe(checksBefore);
    expect(runs(owned.hostRan)).toBe(hostBefore + 2);
    expect(git(remote, ["rev-parse", "main"])).toBe(head(owned.root));
  });

  it("stops the commit where the checked-out commit has the carrier and the checkout does not", async () => {
    const owned = withGitHooks();
    await installCarriers(owned.root);
    commitInstalled(owned.root);
    rmSync(path.join(owned.root, CARRIER));
    const before = head(owned.root);
    const checksBefore = runs(owned.commitRan);

    const commit = commitLine(owned.root, CLEAN_LINE);

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toMatch(
      /Commit stopped: \.lisa\/hooks\/pre-commit, the script that runs the checks this repository requires before a commit, could not be found in this checkout/u
    );
    expect(commit.stderr).not.toMatch(DID_NOT_RUN);
    expect(head(owned.root)).toBe(before);
    expect(runs(owned.commitRan)).toBe(checksBefore);
  });
});

describe("install-carriers through a linked working tree", () => {
  it("writes the hook every checkout shares, says so, and prints no path of the machine", async () => {
    const owned = withGitHooks();
    const worktree = linkedWorktree(owned.root, "linked");

    const run = await installCarriers(worktree);
    commitInstalled(worktree);
    const again = await installCarriers(worktree, { check: true });
    const rejected = commitLine(worktree, `# ${PLANTED}`);
    const elsewhere = commitLine(owned.root, CLEAN_LINE);

    expect(run.code).toBe(0);
    expect(run.result?.hook_owner).toBe("git-hooks");
    expect(run.result?.reason).toMatch(SHARED);
    expect(run.result?.enforcement_points.map(point => point.path)).toEqual([
      "<git-common-dir>/hooks/pre-commit",
      "<git-common-dir>/hooks/pre-push",
    ]);
    expect(run.result?.changes).toContainEqual({
      action: "update",
      path: "<git-common-dir>/hooks/pre-commit",
    });
    for (const machinePath of machinePaths()) {
      expect(printed(run)).not.toContain(machinePath);
    }
    expect(again.code).toBe(0);
    expect(again.result?.outcome).toBe("already-wired");
    expect(rejected.status).not.toBe(0);
    // The other checkout is on a branch that never had Lisa's files.
    expect(elsewhere.status).toBe(0);
    expect(elsewhere.stderr).toMatch(DID_NOT_RUN);
  });

  it("says the setting is shared when nothing owns hooks and it sets core.hooksPath", async () => {
    const owned = ownedRepository();
    cleanups.push(owned.repository.cleanup);
    const worktree = linkedWorktree(owned.root, "linked");

    const run = await installCarriers(worktree);

    expect(run.code).toBe(0);
    expect(run.result?.hook_owner).toBe("none");
    expect(run.result?.reason).toMatch(
      /core\.hooksPath lives in the configuration every checkout of this repository shares/u
    );
    expect(run.said.join("\n")).not.toMatch(/of this checkout only/u);
    expect(git(owned.root, ["config", "core.hooksPath"])).toBe(".lisa/hooks");
    for (const machinePath of machinePaths()) {
      expect(printed(run)).not.toContain(machinePath);
    }
  });

  it("does not say shared in a repository with one checkout", async () => {
    const owned = withGitHooks();

    const run = await installCarriers(owned.root);

    expect(run.code).toBe(0);
    expect(run.result?.reason).not.toMatch(SHARED);
    expect(run.result?.enforcement_points[0]?.path).toBe(
      ".git/hooks/pre-commit"
    );
  });
});

describe("install-carriers and a hooks folder outside the checkout", () => {
  it("names neither the folder nor the hook by its path on the machine", async () => {
    const owned = ownedRepository();
    cleanups.push(owned.repository.cleanup);
    const elsewhere = outside("hooks");
    writeExecutable(
      path.join(elsewhere, COMMIT_HOOK),
      `#!/bin/sh\n${owned.hostCommand}\n`
    );
    git(owned.root, ["config", "core.hooksPath", elsewhere]);

    const run = await installCarriers(owned.root);

    expect(run.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(run.result?.enforcement_points.map(point => point.path)).toEqual([
      "<outside the checkout>/pre-commit",
      "<outside the checkout>/pre-push",
    ]);
    expect(run.result?.enforcement_points[0]?.reason).toMatch(
      /from a folder outside this checkout \(the one core\.hooksPath names;.*by hand/su
    );
    for (const machinePath of machinePaths()) {
      expect(printed(run)).not.toContain(machinePath);
    }
  });
});
