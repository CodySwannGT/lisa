/**
 * The push checks refuse rather than pass when they cannot see the pushed tree.
 *
 * Measured, on a real push (CodySwannGT/lisa#3874). A session pinned to one
 * worktree can only push another worktree's branch cross-tree, and when it did,
 * `eslint .` and `knip` walked the PUSHER'S working tree while the push carried
 * a commit from somewhere else — and then printed `PASSED`. Neither half is a
 * defect alone: a hook that reads the tree it is in is correct when you are
 * pushing the branch you are on, and the worktree binding confining a session
 * to one tree is doing its job. Together they produce a green about the wrong
 * tree.
 *
 * Refusing is the honest answer and passing is not, which is what these cases
 * pin. `refuses` and `names the ref it could not examine` hold the refusal;
 * `runs the gates for the branch this checkout is on` and
 * `runs the gates for a commit already in this tree's history` hold the
 * ordinary paths the guard must leave completely alone — a guard that refused
 * those would be a worse defect than the one it closes.
 *
 * Sliced out of the real hook rather than reimplemented: an assertion against a
 * copy of the logic stays green over a hook whose copy of it was deleted. The
 * roster is derived, so a fourth tracked copy joins this suite the moment it is
 * tracked (CodySwannGT/lisa#2847).
 * @module tests/unit/hooks/pre-push-pushed-tree-scope
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { trackedHookCopies } from "../../helpers/hook-roster.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const ROOT = process.cwd();

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const SH = "/bin/sh";

/** Every tracked copy of the pre-push hook, derived rather than written down. */
const HOOKS = [...trackedHookCopies("pre-push")];

/** Opening marker of the block under test. */
const GUARD_START = "# BEGIN: pushed-tree scope guard";

/** Closing marker of the block under test. */
const GUARD_END = "# END: pushed-tree scope guard";

/** Printed by the harness when the guard let the hook continue. */
const CONTINUED = "GATE-SUITE-REACHED";

/** The refusal's opening words, which the operator reads first. */
const REFUSED = "Push refused: the push checks cannot see the commits";

/** A 40-zero object id, exactly as Git writes it for a new branch. */
const ZERO = "0".repeat(40);

/** Identity for the fixture repository, so committing needs no global config. */
const IDENTITY = {
  GIT_AUTHOR_EMAIL: "lisa@example.test",
  GIT_AUTHOR_NAME: "Lisa Test",
  GIT_COMMITTER_EMAIL: "lisa@example.test",
  GIT_COMMITTER_NAME: "Lisa Test",
};

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true });
});

/** One repository, two branches, and the object ids each case needs. */
interface Repo {
  /** The tip of the branch the fixture is NOT checked out on. */
  elsewhere: string;
  /** The tip of the checked-out branch. */
  head: string;
  /** The first commit, which IS in the checked-out branch's history. */
  root: string;
  /** Absolute path to the working tree. */
  tree: string;
}

/**
 * Run git in the fixture, failing loudly rather than returning a bad answer.
 * @param cwd - Working tree to run in
 * @param args - Argument vector after `git`
 * @returns Trimmed stdout
 */
function git(cwd: string, args: string[]): string {
  const outcome = boundedSpawnSync({
    args,
    command: "git",
    cwd,
    env: { ...process.env, ...IDENTITY },
    label: `git ${args[0]}`,
  });
  if (outcome.status !== 0)
    throw new Error(outcome.stderr || `git ${args.join(" ")} failed`);
  return outcome.stdout.trim();
}

/**
 * Build the two branches, and answer with the object ids each case needs.
 *
 * Two real branches rather than two invented object ids: the guard's whole
 * question is `git merge-base --is-ancestor`, and a fabricated sha cannot
 * answer it either way.
 * @param tree - Working tree to build in
 * @returns The tips, and the root commit both branches share
 */
function build(tree: string): Omit<Repo, "tree"> {
  git(tree, ["init", "-q", "-b", "main"]);
  writeFileSync(path.join(tree, "a.txt"), "a\n");
  git(tree, ["add", "a.txt"]);
  git(tree, ["commit", "-q", "-m", "root"]);
  git(tree, ["branch", "other"]);
  git(tree, ["commit", "-q", "--allow-empty", "-m", "here"]);
  git(tree, ["switch", "-q", "other"]);
  git(tree, ["commit", "-q", "--allow-empty", "-m", "elsewhere"]);
  git(tree, ["switch", "-q", "main"]);
  return {
    elsewhere: git(tree, ["rev-parse", "other"]),
    head: git(tree, ["rev-parse", "main"]),
    root: git(tree, ["rev-parse", "main~"]),
  };
}

/**
 * A repository whose `elsewhere` commit is genuinely absent from `HEAD`.
 * @returns The fixture
 */
function repository(): Repo {
  const tree = mkdtempSync(path.join(tmpdir(), "lisa-tree-scope-"));
  const built = build(tree);
  dirs.push(tree);
  return { ...built, tree };
}

/**
 * Cut the scope guard out of a hook, verbatim.
 * @param relative - Repo-relative path to the hook
 * @returns The block as a runnable script body
 */
function guardBlock(relative: string): string {
  const lines = readFileSync(path.join(ROOT, relative), "utf8").split("\n");
  const start = lines.findIndex(line => line.trim() === GUARD_START);
  const end = lines.findIndex(line => line.trim() === GUARD_END);
  expect(start, `${relative} has no ${GUARD_START}`).toBeGreaterThan(-1);
  expect(end, `${relative} has no ${GUARD_END}`).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join("\n");
}

/**
 * Run one hook's guard over one pre-push stream, inside a real repository.
 *
 * `LISA_TRACEABILITY_RAN` is set, and `WORK_ITEM_SCRIPT` names a path that does
 * not exist, so the guard's own traceability call stands down: this suite's
 * subject is the refusal, and the validator has its own.
 * @param relative - Repo-relative path to the hook
 * @param repo - The fixture repository
 * @param stream - The pre-push lines, newline-terminated
 * @param refsFile - Whether to write the stream to a file at all
 * @returns Exit status and everything the guard printed
 */
function runGuard(
  relative: string,
  repo: Repo,
  stream: string,
  refsFile = true
): { status: number | null; stdout: string } {
  const file = path.join(repo.tree, "pushed-refs");
  if (refsFile) writeFileSync(file, stream);
  const script = [guardBlock(relative), `echo "${CONTINUED}"`].join("\n");
  const outcome = boundedSpawnSync({
    args: ["-c", script, "hook", "origin"],
    command: SH,
    cwd: repo.tree,
    env: {
      ...process.env,
      ...IDENTITY,
      LISA_PUSHED_REFS_FILE: refsFile ? file : "",
      LISA_TRACEABILITY_RAN: "1",
      WORK_ITEM_SCRIPT: path.join(repo.tree, "no-such-validator.mjs"),
    },
    label: `${relative} scope guard`,
  });
  return {
    status: outcome.status,
    stdout: `${outcome.stdout}\n${outcome.stderr}`,
  };
}

describe.each(HOOKS)("%s pushed-tree scope guard", relative => {
  it("refuses a push whose commit this working tree has never contained", () => {
    const repo = repository();

    const outcome = runGuard(
      relative,
      repo,
      `refs/heads/other ${repo.elsewhere} refs/heads/other ${ZERO}\n`
    );

    expect(outcome.status).toBe(1);
    expect(outcome.stdout).not.toContain(CONTINUED);
  });

  it("names the ref and the commit it could not examine", () => {
    const repo = repository();

    const outcome = runGuard(
      relative,
      repo,
      `refs/heads/other ${repo.elsewhere} refs/heads/other ${ZERO}\n`
    );

    expect(outcome.stdout).toContain(REFUSED);
    expect(outcome.stdout).toContain(`refs/heads/other -> ${repo.elsewhere}`);
  });

  it("runs the gates for the branch this checkout is on", () => {
    const repo = repository();

    const outcome = runGuard(
      relative,
      repo,
      `refs/heads/main ${repo.head} refs/heads/main ${repo.root}\n`
    );

    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain(CONTINUED);
  });

  it("runs the gates for a commit already in this tree's history", () => {
    const repo = repository();

    const outcome = runGuard(
      relative,
      repo,
      `refs/heads/main ${repo.root} refs/heads/main ${ZERO}\n`
    );

    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain(CONTINUED);
  });

  it("leaves a tag push alone, which moves a label rather than a tree", () => {
    const repo = repository();

    const outcome = runGuard(
      relative,
      repo,
      `refs/tags/v1 ${repo.elsewhere} refs/tags/v1 ${ZERO}\n`
    );

    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain(CONTINUED);
  });

  it("stands down when no refs file could be written", () => {
    const repo = repository();

    const outcome = runGuard(
      relative,
      repo,
      `refs/heads/other ${repo.elsewhere} refs/heads/other ${ZERO}\n`,
      false
    );

    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain(CONTINUED);
  });

  it("refuses a push that mixes an in-tree ref with an out-of-tree one", () => {
    const repo = repository();

    const outcome = runGuard(
      relative,
      repo,
      `refs/heads/main ${repo.head} refs/heads/main ${repo.root}\n` +
        `refs/heads/other ${repo.elsewhere} refs/heads/other ${ZERO}\n`
    );

    expect(outcome.status).toBe(1);
    expect(outcome.stdout).not.toContain(CONTINUED);
  });
});
