/**
 * The call `lisa controls install-carriers` adds to a hook, after a hook
 * that leaves the shell in another repository (CodySwannGT/lisa#4989).
 *
 * The call finds the carrier by asking git for the top folder of the
 * checkout, and lets a commit through, with one sentence, when the commit
 * checked out does not contain the carrier. Git answers both questions for
 * whichever repository the shell is in. A hook that ends with `cd` into a
 * nested repository or a submodule got its answers about that repository:
 * the commit went through with a sentence that was false for the repository
 * being committed to, whether or not it had the carrier.
 *
 * So an answer counts only when it is about the repository git started the
 * hook for, and where that cannot be told the commit stops. This is held
 * with real commits, once for every owner whose hook file the call is added
 * to: git's own hooks folder, a `core.hooksPath` folder written as a path
 * from the top folder and as an absolute path, and Husky. Lefthook and the
 * pre-commit framework start the carrier itself, which goes to its own top
 * folder and has no such question to ask.
 * @module tests/integration/controls-install-carriers-other-repository
 */
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  gitHooksFolder,
  hostHookScript,
  installHusky,
  type OwnedRepository,
  ownedRepository,
  writeExecutable,
} from "../support/carrier-hook-owners.js";
import {
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
const HOOK = "pre-commit";
const HOOKS_FOLDER = ".githooks";
const WITH_CARRIERS = "with-carriers";
const NESTED = "vendor/tool";
const CANNOT_TELL =
  /(?:Commit|Push) stopped: this hook can no longer tell which repository the (?:commit|push) is made in, so the checks this repository requires before a (?:commit|push) were not run/u;
const DID_NOT_RUN =
  /did not run in this checkout: the commit checked out here does not contain \.lisa\/hooks\/pre-(?:commit|push)/u;

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

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
 * Make a repository of its own with one commit.
 * @param folder - Where it goes
 */
function smallRepository(folder: string): void {
  mkdirSync(folder, { recursive: true });
  git(folder, ["init", "--quiet", "."]);
  writeFileSync(path.join(folder, "README"), "another repository\n");
  git(folder, ["add", "README"]);
  git(folder, ["commit", "--quiet", "-m", "chore: start"]);
}

/**
 * Put a repository of its own inside a checkout, kept out of what the outer
 * repository tracks.
 * @param checkout - The outer checkout's top folder
 * @param hookAt - A hook file to give it, from its top folder, if any
 */
function nestRepository(checkout: string, hookAt: string | null = null): void {
  const folder = path.join(checkout, NESTED);
  const exclude = path.resolve(
    checkout,
    git(checkout, ["rev-parse", "--git-path", "info/exclude"])
  );
  smallRepository(folder);
  if (hookAt !== null) {
    writeExecutable(path.join(folder, hookAt), "#!/bin/sh\ntrue\n");
  }
  mkdirSync(path.dirname(exclude), { recursive: true });
  appendFileSync(exclude, `/${NESTED}/\n`);
}

/** One owner whose commit hook file the call is added to. */
interface ShellOwner {
  /** Who owns the hook. */
  readonly name: string;
  /** The hook file, from the top folder of a main working tree. */
  readonly hookAt: string;
  /** Set the existing hook up, and say where its file is. */
  readonly prepare: (owned: OwnedRepository) => string;
}

/**
 * Write the existing hook into a folder `core.hooksPath` names.
 * @param owned - The repository
 * @param setting - What `core.hooksPath` is set to
 * @returns The hook file
 */
function hooksPathHook(owned: OwnedRepository, setting: string): string {
  const file = path.join(owned.root, HOOKS_FOLDER, HOOK);
  writeExecutable(file, hostHookScript(owned));
  git(owned.root, ["config", "core.hooksPath", setting]);
  return file;
}

const OWNERS: readonly ShellOwner[] = [
  {
    hookAt: `.git/hooks/${HOOK}`,
    name: "git's own hooks folder",
    prepare: owned => {
      const file = path.join(gitHooksFolder(owned.root), HOOK);
      writeExecutable(file, hostHookScript(owned));
      return file;
    },
  },
  {
    hookAt: `${HOOKS_FOLDER}/${HOOK}`,
    name: "a core.hooksPath folder, written from the top folder",
    prepare: owned => hooksPathHook(owned, HOOKS_FOLDER),
  },
  {
    hookAt: `${HOOKS_FOLDER}/${HOOK}`,
    name: "a core.hooksPath folder, written as an absolute path",
    prepare: owned => hooksPathHook(owned, path.join(owned.root, HOOKS_FOLDER)),
  },
  {
    hookAt: `.husky/${HOOK}`,
    name: "Husky",
    prepare: owned => {
      installHusky(owned.root);
      const file = path.join(owned.root, ".husky", HOOK);
      writeExecutable(
        file,
        hostHookScript(owned, ['. "$(dirname -- "$0")/_/husky.sh"'])
      );
      return file;
    },
  },
];

/** A repository wired on one branch, with `main` left without Lisa's files. */
interface Wired {
  readonly owned: OwnedRepository;
  /** The commit hook file. */
  readonly hook: string;
}

/**
 * Have a repository removed when the case ends.
 * @param owned - The repository
 * @returns The same repository
 */
function removedAfterwards(owned: OwnedRepository): OwnedRepository {
  cleanups.push(owned.repository.cleanup);
  return owned;
}

/**
 * Build F-none with an existing hook, and wire it on a branch of its own.
 * @param owner - Who owns the hook
 * @returns The repository, on the wired branch
 */
async function wiredOnABranch(owner: ShellOwner): Promise<Wired> {
  const owned = removedAfterwards(ownedRepository());
  const hook = owner.prepare(owned);
  git(owned.root, ["checkout", "--quiet", "-b", WITH_CARRIERS]);
  if ((await installCarriers(owned.root)).code !== 0) {
    throw new Error(`the call could not be added for ${owner.name}`);
  }
  commitInstalled(owned.root);
  return { hook, owned };
}

/**
 * Make the hook's own lines end by changing folder.
 * @param wired - The repository
 * @param folder - The folder they change to, from the top folder
 */
function endIn(wired: Wired, folder: string): void {
  const text = readFileSync(wired.hook, "utf8");
  const own = `${wired.owned.hostCommand}\n`;
  const ended = text
    .replace(/^cd .*\n/mu, "")
    .replace(own, `${own}cd ${folder}\n`);
  if (!ended.includes(`\ncd ${folder}\n`)) throw new Error(text);
  writeExecutable(wired.hook, ended);
}

/**
 * Check `main` out: the branch whose commits never held Lisa's files, with
 * the hook as it was wired.
 * @param wired - The repository
 */
function onTheBranchWithoutCarriers(wired: Wired): void {
  const hookText = readFileSync(wired.hook, "utf8");
  // Forced, so that what a stopped commit left staged does not hold it up.
  git(wired.owned.root, ["checkout", "--quiet", "--force", "main"]);
  // Where the hook file is committed, the checkout took it away with the
  // branch. It is put back as it was wired: a hook that outlived its branch.
  writeExecutable(wired.hook, hookText);
  if (!readFileSync(wired.hook, "utf8").includes("\ncd ")) {
    throw new Error("the hook no longer changes folder");
  }
}

describe.each(OWNERS)(
  "the call in a hook owned by $name, which ends in a nested repository",
  owner => {
    it("stops the commit, on a branch with the carrier and on one without", async () => {
      const wired = await wiredOnABranch(owner);
      const { root } = wired.owned;
      nestRepository(root);
      endIn(wired, NESTED);
      const checksBefore = runs(wired.owned.commitRan);
      const wiredHead = head(root);

      const withCarrier = commitLine(root, `# ${PLANTED}`);
      onTheBranchWithoutCarriers(wired);
      const mainHead = head(root);
      const withoutCarrier = commitLine(root, CLEAN_LINE);

      // Neither commit is in, neither was let through with a sentence about
      // the nested repository, and no check ran for either.
      expect(withCarrier.status).not.toBe(0);
      expect(withCarrier.stderr).toMatch(CANNOT_TELL);
      expect(withoutCarrier.status).not.toBe(0);
      expect(withoutCarrier.stderr).toMatch(CANNOT_TELL);
      expect(withoutCarrier.stderr).not.toMatch(DID_NOT_RUN);
      expect(head(root)).toBe(mainHead);
      expect(git(root, ["rev-parse", WITH_CARRIERS])).toBe(wiredHead);
      expect(runs(wired.owned.commitRan)).toBe(checksBefore);
    });

    it("still runs the checks, and still leaves a branch without them usable, after a hook that ends in a folder of the checkout", async () => {
      const wired = await wiredOnABranch(owner);
      const { root } = wired.owned;
      endIn(wired, "src");
      const checksBefore = runs(wired.owned.commitRan);

      const rejected = commitLine(root, `# ${PLANTED}`);
      onTheBranchWithoutCarriers(wired);
      const letThrough = commitLine(root, CLEAN_LINE);

      expect(rejected.status).not.toBe(0);
      expect(`${rejected.stdout}${rejected.stderr}`).toContain(LINT_SHAPE);
      expect(runs(wired.owned.commitRan)).toBe(checksBefore + 1);
      expect(letThrough.status).toBe(0);
      expect(letThrough.stderr).toMatch(DID_NOT_RUN);
    });

    it("stops the commit when the nested repository has a hook file of the same name", async () => {
      const wired = await wiredOnABranch(owner);
      const { root } = wired.owned;
      // The nested repository's own hook is where this hook's path leads
      // from there. It does not hold the call, so it is not taken for this
      // hook.
      nestRepository(root, owner.hookAt);
      endIn(wired, NESTED);
      onTheBranchWithoutCarriers(wired);
      const before = head(root);

      const commit = commitLine(root, CLEAN_LINE);

      expect(commit.status).not.toBe(0);
      expect(commit.stderr).toMatch(CANNOT_TELL);
      expect(head(root)).toBe(before);
    });
  }
);

describe("the call in a hook that ends in a submodule", () => {
  it("stops the commit instead of answering for the submodule", async () => {
    const [owner] = OWNERS;
    if (owner === undefined) throw new Error("no owner");
    const source = path.join(outside("submodule"), "source");
    smallRepository(source);
    const wired = await wiredOnABranch(owner);
    const { root } = wired.owned;
    git(root, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "--quiet",
      "add",
      source,
      NESTED,
    ]);
    git(root, ["commit", "--quiet", "-m", "chore: add a submodule"]);
    endIn(wired, NESTED);
    const before = head(root);
    const checksBefore = runs(wired.owned.commitRan);

    const commit = commitLine(root, `# ${PLANTED}`);

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toMatch(CANNOT_TELL);
    expect(commit.stderr).not.toMatch(DID_NOT_RUN);
    expect(head(root)).toBe(before);
    expect(runs(wired.owned.commitRan)).toBe(checksBefore);
  });
});

describe("the call at push, in a hook that ends in a nested repository", () => {
  it("stops the push on a branch without the carrier", async () => {
    const [owner] = OWNERS;
    if (owner === undefined) throw new Error("no owner");
    const wired = await wiredOnABranch(owner);
    const { root } = wired.owned;
    const remote = outside("remote");
    git(remote, ["init", "--quiet", "--bare", "."]);
    git(root, ["remote", "add", "origin", remote]);
    nestRepository(root);
    const pushHook = path.join(gitHooksFolder(root), "pre-push");
    writeExecutable(
      pushHook,
      readFileSync(pushHook, "utf8").replace(
        "#!/bin/sh\n",
        `#!/bin/sh\ncd ${NESTED}\n`
      )
    );
    git(root, ["checkout", "--quiet", "main"]);

    const push = operatorGit(root, ["push", "origin", "main"]);

    expect(readFileSync(pushHook, "utf8")).toContain(`\ncd ${NESTED}\n`);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toMatch(CANNOT_TELL);
    expect(push.stderr).not.toMatch(DID_NOT_RUN);
    expect(operatorGit(remote, ["rev-parse", "main"]).status).not.toBe(0);
  });
});

describe("the call in a linked working tree, after a hook that ends in a nested repository", () => {
  /**
   * Add a linked working tree with a nested repository in it.
   * @param root - The repository
   * @param args - What to check out there
   * @returns The working tree's top folder
   */
  function linkedWorktree(root: string, args: readonly string[]): string {
    const worktree = path.join(outside("worktree"), "linked");
    git(root, ["worktree", "add", "--quiet", worktree, ...args]);
    smallRepository(path.join(worktree, NESTED));
    return worktree;
  }

  it("lets a branch without the carrier through, because git named the repository itself", async () => {
    const [owner] = OWNERS;
    if (owner === undefined) throw new Error("no owner");
    const wired = await wiredOnABranch(owner);
    nestRepository(wired.owned.root);
    endIn(wired, NESTED);
    const worktree = linkedWorktree(wired.owned.root, ["-b", "plain", "main"]);

    const commit = commitLine(worktree, CLEAN_LINE);

    // Here the sentence is true: git named the repository to the hook, so
    // the answer is about the commit checked out in this working tree.
    expect(commit.status).toBe(0);
    expect(commit.stderr).toMatch(DID_NOT_RUN);
  });

  it("stops a branch with the carrier, without running another repository's checks", async () => {
    const [owner] = OWNERS;
    if (owner === undefined) throw new Error("no owner");
    const wired = await wiredOnABranch(owner);
    nestRepository(wired.owned.root);
    endIn(wired, NESTED);
    const worktree = linkedWorktree(wired.owned.root, [
      "-b",
      "wired-too",
      WITH_CARRIERS,
    ]);
    const before = head(worktree);
    const checksBefore = runs(wired.owned.commitRan);

    const commit = commitLine(worktree, `# ${PLANTED}`);

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toMatch(CANNOT_TELL);
    expect(head(worktree)).toBe(before);
    expect(runs(wired.owned.commitRan)).toBe(checksBefore);
  });
});
