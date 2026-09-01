/**
 * A feature-branch push must never land on a deploy branch.
 *
 * `push.default=upstream` resolves a push's destination from the branch's
 * UPSTREAM rather than from the branch named on the command line. The ordinary
 * way to start work — `git checkout -b <branch> origin/main` — sets that
 * upstream to `main`, so the ordinary `git push -u origin <branch>` resolves to
 * `refs/heads/main` and lands there, reporting success while bypassing branch
 * protection and every required check (CodySwannGT/lisa#3495).
 *
 * These tests drive REAL git against a real bare remote, because that is the
 * only thing that proves it. Reading `push.default` back out of a config file
 * proves nothing about where a push resolves — the defect shipped past people
 * who had read the config. The first test is the unguarded control that
 * reproduces the accident; the rest prove the guard refuses exactly it and
 * nothing else.
 * @module tests/integration/push-destination-inheritance
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { resolveGit } from "../support/git-executable.js";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, "..", "..");
const GIT_BIN = resolveGit();
const WORK_ITEM_SCRIPT = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-work-item.mjs"
);
const SCRIPT_LIB = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "lib"
);

const FEATURE = "feature/x";
const DEPLOY = "main";
/** Commit subject used by every fixture that needs something worth pushing. */
const WORK_COMMIT = "feat: work";
/** Mode the fixture pre-push hook is written with, so git will execute it. */
const HOOK_MODE = 0o755;

/**
 * Sort branch names the way the lint ruleset requires — explicitly, by locale.
 * @param names - Branch names
 * @returns A new sorted array
 */
function sorted(names: readonly string[]): readonly string[] {
  return [...names].sort((a, b) => a.localeCompare(b));
}

// Every GIT_* variable stripped. When this suite runs from git's own pre-push
// hook, git exports GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE into the
// environment, and inheriting them points every fixture command back at the
// checkout the suite is running inside.
const AMBIENT_ENV: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
);

/** Hermetic git environment: no inherited state, no developer global config. */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...AMBIENT_ENV,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Repro",
  GIT_AUTHOR_EMAIL: "repro@example.com",
  GIT_COMMITTER_NAME: "Repro",
  GIT_COMMITTER_EMAIL: "repro@example.com",
};

const fixtures: string[] = [];

afterEach(() => {
  while (fixtures.length > 0) {
    const dir = fixtures.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Outcome of one fixture git invocation. */
interface GitRun {
  readonly status: number;
  readonly output: string;
}

/**
 * Run git in a fixture directory.
 * @param cwd - Directory to run in
 * @param args - Git arguments
 * @returns Exit status and combined output
 */
function git(cwd: string, ...args: readonly string[]): GitRun {
  const result = boundedSpawnSync({
    args,
    command: GIT_BIN,
    cwd,
    env: GIT_ENV,
    label: `git ${args[0]} in ${path.basename(cwd)}`,
    // Several of these cases are pushes the hook refuses, which exit without
    // draining anything this test wrote.
    childMayExitBeforeReading: true,
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/** A fixture: a bare remote plus a clone of it. */
interface Fixture {
  /** Path of the bare remote repository. */
  readonly remote: string;
  /** Path of the working clone. */
  readonly work: string;
}

/**
 * A bare remote holding one commit on `main`, and a clone of it.
 *
 * `guarded` installs the destination guard as the clone's real pre-push hook,
 * wired the way `.husky/pre-push` wires it. `false` leaves the clone unguarded,
 * which is what reproduces the original accident.
 * @param guarded - Whether to install the pre-push destination guard
 * @returns Paths of the remote and the working clone
 */
function makeFixture(guarded: boolean): Fixture {
  const root = fs.mkdtempSync(path.join(REPO_ROOT, "..", "lisa-push-fixture-"));
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const work = path.join(root, "work");
  const scripts = path.join(work, "scripts");
  const hooks = path.join(work, ".githooks");
  const hook = path.join(hooks, "pre-push");

  fixtures.push(root);
  git(root, "init", "--quiet", "--bare", remote, "--initial-branch", DEPLOY);
  git(root, "init", "--quiet", seed, "--initial-branch", DEPLOY);
  fs.writeFileSync(path.join(seed, "a.txt"), "a\n");
  git(seed, "add", "-A");
  git(seed, "commit", "--quiet", "-m", "init");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "--quiet", "origin", `${DEPLOY}:refs/heads/${DEPLOY}`);
  git(root, "clone", "--quiet", remote, work);

  // The config the guard reads to learn which branches are deploy branches.
  fs.writeFileSync(
    path.join(work, ".lisa.config.json"),
    `${JSON.stringify({ tracker: "github", deploy: { branches: { production: DEPLOY } } }, null, 2)}\n`
  );

  if (guarded) {
    fs.mkdirSync(scripts, { recursive: true });
    fs.copyFileSync(WORK_ITEM_SCRIPT, path.join(scripts, "lisa-work-item.mjs"));
    fs.cpSync(SCRIPT_LIB, path.join(scripts, "lib"), { recursive: true });
    fs.mkdirSync(hooks, { recursive: true });
    fs.writeFileSync(
      hook,
      [
        "#!/bin/sh",
        'node scripts/lisa-work-item.mjs validate-push-destination "${1:-origin}" || exit 1',
        "",
      ].join("\n"),
      // Executable because git runs it; the file is a throwaway fixture inside
      // a temp directory this suite created and deletes.
      { mode: HOOK_MODE }
    );
    git(work, "config", "core.hooksPath", ".githooks");
  }
  return { remote, work };
}

/**
 * Perform the exact branch-creation step the flow used to prescribe, then
 * commit something worth pushing.
 * @param work - Working clone
 */
function startWorkTheOldWay(work: string): void {
  git(work, "config", "push.default", "upstream");
  git(work, "checkout", "--quiet", "-b", FEATURE, `origin/${DEPLOY}`);
  fs.writeFileSync(path.join(work, "b.txt"), "b\n");
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", WORK_COMMIT);
}

/**
 * Branch names that exist on the remote.
 * @param remote - Bare remote path
 * @returns Sorted short branch names
 */
function remoteBranches(remote: string): readonly string[] {
  const listing = git(
    remote,
    "for-each-ref",
    "--format=%(refname)",
    "refs/heads"
  );
  const names = listing.output
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(ref => ref.replace("refs/heads/", ""));
  return sorted(names);
}

/**
 * The commit `main` currently points at on the remote.
 * @param remote - Bare remote path
 * @returns The commit id
 */
function remoteDeployHead(remote: string): string {
  return git(remote, "rev-parse", DEPLOY).output.trim();
}

describe("push destination inheritance", () => {
  it("reproduces the accident when nothing guards the push", () => {
    // The control. Without this, a green suite would prove only that the
    // fixture cannot push at all.
    const { remote, work } = makeFixture(false);
    const before = remoteDeployHead(remote);
    startWorkTheOldWay(work);

    const push = git(work, "push", "-u", "origin", FEATURE);

    expect(push.status).toBe(0);
    expect(push.output).toContain(`${FEATURE} -> ${DEPLOY}`);
    expect(remoteBranches(remote)).toEqual([DEPLOY]);
    expect(remoteDeployHead(remote)).not.toBe(before);
  });

  it("refuses the same sequence once the destination guard is installed", () => {
    const { remote, work } = makeFixture(true);
    const before = remoteDeployHead(remote);
    startWorkTheOldWay(work);
    // The upstream really is the deploy branch — the trap is armed, and the
    // guard is what disarms it rather than the fixture being different.
    expect(
      git(work, "config", "--get", `branch.${FEATURE}.merge`).output.trim()
    ).toBe(`refs/heads/${DEPLOY}`);

    const push = git(work, "push", "-u", "origin", FEATURE);

    expect(push.status).not.toBe(0);
    expect(push.output).toContain(
      `Push blocked: "${FEATURE}" would land on "${DEPLOY}"`
    );
    expect(remoteBranches(remote)).toEqual([DEPLOY]);
    expect(remoteDeployHead(remote)).toBe(before);
  });

  it("lets the remedy the refusal prints actually work", () => {
    const { remote, work } = makeFixture(true);
    startWorkTheOldWay(work);
    git(work, "push", "-u", "origin", FEATURE);

    git(work, "branch", "--unset-upstream", FEATURE);
    git(work, "config", "--local", "push.default", "simple");
    const push = git(
      work,
      "push",
      "origin",
      `${FEATURE}:refs/heads/${FEATURE}`
    );

    expect(push.status).toBe(0);
    expect(remoteBranches(remote)).toEqual(sorted([DEPLOY, FEATURE]));
  });

  it("still allows a legitimate merge landing on the deploy branch", () => {
    // The guard would be worthless if it also refused this: merges to the
    // deploy branch are the whole point of having one.
    const { remote, work } = makeFixture(true);
    startWorkTheOldWay(work);
    git(work, "checkout", "--quiet", DEPLOY);
    git(work, "merge", "--quiet", "--no-ff", "-m", "merge work", FEATURE);
    const localHead = git(work, "rev-parse", DEPLOY).output.trim();

    const push = git(work, "push", "origin", DEPLOY);

    expect(push.status).toBe(0);
    expect(remoteDeployHead(remote)).toBe(localHead);
  });

  it("still allows an ordinary feature-branch push", () => {
    const { remote, work } = makeFixture(true);
    git(
      work,
      "switch",
      "--quiet",
      "-c",
      FEATURE,
      "--no-track",
      `origin/${DEPLOY}`
    );
    fs.writeFileSync(path.join(work, "b.txt"), "b\n");
    git(work, "add", "-A");
    git(work, "commit", "--quiet", "-m", WORK_COMMIT);

    const push = git(work, "push", "-u", "origin", FEATURE);

    expect(push.status).toBe(0);
    expect(remoteBranches(remote)).toEqual(sorted([DEPLOY, FEATURE]));
  });

  it("still allows deleting a feature branch from the deploy branch", () => {
    // A deletion line carries a zeroed LOCAL sha and a deploy-branch remote ref
    // is not involved, but the shape is close enough to the refusal's that it
    // is worth pinning: cleanup must not need a bypass.
    const { remote, work } = makeFixture(true);
    git(
      work,
      "switch",
      "--quiet",
      "-c",
      FEATURE,
      "--no-track",
      `origin/${DEPLOY}`
    );
    fs.writeFileSync(path.join(work, "b.txt"), "b\n");
    git(work, "add", "-A");
    git(work, "commit", "--quiet", "-m", WORK_COMMIT);
    git(work, "push", "origin", `${FEATURE}:refs/heads/${FEATURE}`);
    git(work, "checkout", "--quiet", DEPLOY);

    const push = git(work, "push", "origin", "--delete", FEATURE);

    expect(push.status).toBe(0);
    expect(remoteBranches(remote)).toEqual([DEPLOY]);
  });
});
