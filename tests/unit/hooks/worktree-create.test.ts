/**
 * Tests for the managed WorktreeCreate hook.
 *
 * Claude Code replaces its default worktree creation with this hook, so the
 * contract is strict: create the worktree, print ONLY its absolute path on
 * stdout, exit 0. The hook reads `{ name, cwd }` from stdin (the observed
 * payload — the docs' `worktree_name`/`base_path` fields do not appear), mirrors
 * the default `<cwd>/.claude/worktrees/<name>` layout on a `worktree-<name>`
 * branch, and keeps all git chatter off stdout.
 * @module tests/unit/hooks/worktree-create
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

const HOOK_PATH = path.resolve(
  "typescript/copy-overwrite/.claude/hooks/worktree-create.sh"
);
const SH_PATH = "/bin/sh";
const GIT_PATH = resolveGit();
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
const hasJq =
  boundedSpawnSync({
    label: "command -v jq",
    command: SH_PATH,
    args: ["-c", "command -v jq"],
  }).status === 0;

/**
 * Return process env without outer git hook state for nested temp repos.
 * @returns Environment safe for fixture git commands
 */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) {
      delete env[key];
    }
  }
  return env;
}

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs = [];
});

/**
 * Create an initialized git repo in a fresh temp dir.
 * @returns The repo root path
 */
function createGitRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-worktree-create-"));
  tempDirs.push(root);
  boundedSpawnSync({
    label: "git init",
    command: GIT_PATH,
    args: ["init", "-q"],
    cwd: root,
    env: cleanGitEnv(),
  });
  boundedSpawnSync({
    label: "git commit --allow-empty",
    command: GIT_PATH,
    args: ["commit", "-q", "--allow-empty", "-m", "init"],
    cwd: root,
    env: { ...cleanGitEnv(), ...GIT_IDENTITY },
  });
  return root;
}

/**
 * Run the hook with a WorktreeCreate stdin payload.
 * @param root - Project root passed as `cwd` in the payload
 * @param name - Worktree name
 * @param options - Overrides for how the hook is invoked
 * @param options.env - Extra environment variables for the hook process
 * @param options.omitCwd - Omit `cwd` from the payload entirely
 * @returns The hook's exit status, trimmed stdout, and stderr
 */
function runHook(
  root: string,
  name: string,
  options: {
    env?: NodeJS.ProcessEnv;
    omitCwd?: boolean;
  } = {}
): { status: number | null; stdout: string; stderr: string } {
  const payload = JSON.stringify({
    hook_event_name: "WorktreeCreate",
    name,
    ...(options.omitCwd === true ? {} : { cwd: root }),
  });
  const result = boundedSpawnSync({
    label: "worktree-create.sh",
    command: SH_PATH,
    args: [HOOK_PATH],
    cwd: root,
    env: { ...cleanGitEnv(), ...options.env },
    input: payload,
  });
  // Raw stdout (not trimmed): the contract is "ONLY the path", so tests assert
  // the exact `<path>\n` shape and catch any stray whitespace/chatter.
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe.skipIf(!hasJq)("WorktreeCreate hook", () => {
  it("creates <cwd>/.claude/worktrees/<name> and prints exactly its path", () => {
    const root = createGitRepo();
    const { status, stdout } = runHook(root, "featureX");
    const expected = path.join(root, ".claude", "worktrees", "featureX");

    expect(status).toBe(0);
    expect(stdout).toBe(`${expected}\n`);
    expect(existsSync(expected)).toBe(true);
  });

  it("checks out a worktree-<name> branch", () => {
    const root = createGitRepo();
    const { stdout } = runHook(root, "featureY");
    const branch = boundedSpawnSync({
      label: "git rev-parse --abbrev-ref HEAD",
      command: GIT_PATH,
      args: ["rev-parse", "--abbrev-ref", "HEAD"],
      cwd: stdout.trim(),
      env: cleanGitEnv(),
    }).stdout.trim();
    expect(branch).toBe("worktree-featureY");
  });

  it("is idempotent: re-creating returns the same path and succeeds", () => {
    const root = createGitRepo();
    const first = runHook(root, "featureZ");
    const second = runHook(root, "featureZ");
    expect(second.status).toBe(0);
    expect(second.stdout).toBe(first.stdout);
  });

  it("emits only the path on stdout — no git chatter", () => {
    const root = createGitRepo();
    const expected = path.join(root, ".claude", "worktrees", "clean");
    expect(runHook(root, "clean").stdout).toBe(`${expected}\n`);
  });

  it("aborts with a non-zero exit when the payload has no name", () => {
    const root = createGitRepo();
    const result = boundedSpawnSync({
      label: "worktree-create.sh",
      command: SH_PATH,
      args: [HOOK_PATH],
      cwd: root,
      env: cleanGitEnv(),
      input: JSON.stringify({ hook_event_name: "WorktreeCreate", cwd: root }),
    });
    expect(result.status).not.toBe(0);
    expect((result.stdout ?? "").trim()).toBe("");
  });

  it("rejects an unsafe worktree name (path traversal) without creating it", () => {
    const root = createGitRepo();
    const { status, stdout } = runHook(root, "../escape");
    expect(status).not.toBe(0);
    expect(stdout.trim()).toBe("");
    expect(existsSync(path.join(root, "..", "escape"))).toBe(false);
  });
});

const INTEGRATION_BRANCH = "main";
const FEATURE_BRANCH = "feat/other-ticket";
const FEATURE_COMMIT_SUBJECT = "another work item's unmerged commit";
const INTEGRATION_COMMIT_SUBJECT = "init";
const REMOTE_SECRET = "s3cr3t-token";
const REMOTE_URL_WITH_SECRET = `https://user:${REMOTE_SECRET}@example.invalid/o/r.git`;

/**
 * Run a git command in a repo and return its trimmed stdout.
 * @param cwd - Directory to run in
 * @param args - Git arguments
 * @returns Trimmed stdout
 */
function git(cwd: string, args: readonly string[]): string {
  return (
    boundedSpawnSync({
      label: `git ${args[0] ?? ""}`,
      command: GIT_PATH,
      args: [...args],
      cwd,
      env: { ...cleanGitEnv(), ...GIT_IDENTITY },
    }).stdout ?? ""
  ).trim();
}

/**
 * The subject line of a worktree's checked-out commit — the cheapest way to say
 * which base it was actually cut from.
 * @param worktree - Worktree path
 * @returns The commit subject
 */
function baseSubject(worktree: string): string {
  return git(worktree, ["log", "-1", "--format=%s"]);
}

/**
 * A checkout parked on an unmerged feature branch, with the integration base
 * held by `refs/remotes/origin/main`. This is the shape that made every created
 * worktree inherit another work item's commits.
 * @param options - Fixture shape controls
 * @param options.originHead - Set false to leave `origin/HEAD` unresolvable
 * @returns The repo root
 */
function createDriftedRepo(options: { originHead?: boolean } = {}): string {
  const root = createGitRepo();
  git(root, ["branch", "-M", INTEGRATION_BRANCH]);
  git(root, [
    "update-ref",
    `refs/remotes/origin/${INTEGRATION_BRANCH}`,
    git(root, ["rev-parse", INTEGRATION_BRANCH]),
  ]);
  git(root, ["remote", "add", "origin", REMOTE_URL_WITH_SECRET]);
  git(root, ["checkout", "-q", "-b", FEATURE_BRANCH]);
  git(root, ["commit", "-q", "--allow-empty", "-m", FEATURE_COMMIT_SUBJECT]);
  if (options.originHead !== false) {
    git(root, [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      `refs/remotes/origin/${INTEGRATION_BRANCH}`,
    ]);
  }
  return root;
}

describe.skipIf(!hasJq)("WorktreeCreate hook base selection", () => {
  it("bases a new worktree on the integration branch, not the checkout's HEAD", () => {
    const root = createDriftedRepo();
    const { status, stdout } = runHook(root, "based");
    expect(status).toBe(0);

    const worktree = stdout.trim();
    expect(baseSubject(worktree)).toBe(INTEGRATION_COMMIT_SUBJECT);
  });

  it("does not inherit commits that are absent from the integration branch", () => {
    const root = createDriftedRepo();
    const worktree = runHook(root, "clean-base").stdout.trim();

    // Left/right counts against the integration branch: the right-hand number
    // is commits the worktree carries that origin/main does not. Before the
    // fix this was `0\t1` — the feature branch's commit came along silently.
    expect(
      git(worktree, [
        "rev-list",
        "--left-right",
        "--count",
        `refs/remotes/origin/${INTEGRATION_BRANCH}...HEAD`,
      ])
    ).toBe("0\t0");
  });

  it("does not make the integration branch the new branch's push upstream", () => {
    const root = createDriftedRepo();
    const worktree = runHook(root, "untracked").stdout.trim();
    const upstream = boundedSpawnSync({
      label: "git rev-parse @{u}",
      command: GIT_PATH,
      args: ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      cwd: worktree,
      env: cleanGitEnv(),
    });
    expect(upstream.status).not.toBe(0);
  });

  it("announces the repository and the resolved base on stderr", () => {
    const root = createDriftedRepo();
    const { stderr } = runHook(root, "announced");
    expect(stderr).toContain(`repository : ${root}`);
    expect(stderr).toContain(`base       : refs/remotes/origin/main`);
    expect(stderr).toContain("(origin/HEAD)");
  });

  it("redacts credentials embedded in the announced origin URL", () => {
    const root = createDriftedRepo();
    const { stderr } = runHook(root, "redacted");
    expect(stderr).not.toContain(REMOTE_SECRET);
    expect(stderr).toContain("https://example.invalid/o/r.git");
  });

  it("falls back to HEAD and warns loudly when no integration branch resolves", () => {
    const root = createDriftedRepo({ originHead: false });
    const { status, stdout, stderr } = runHook(root, "fallback");

    // The fallback must not be a hard failure: a non-zero exit aborts worktree
    // creation entirely, so an offline clone or a repo with no remote still
    // gets a worktree — it just gets told what it got.
    expect(status).toBe(0);
    expect(stderr).toContain("(fallback)");
    expect(stderr).toContain("WARNING");
    expect(stderr).toContain("may carry another work item's unmerged commits");
    expect(baseSubject(stdout.trim())).toBe(FEATURE_COMMIT_SUBJECT);
  });

  it("uses the configured production branch when origin/HEAD is absent", () => {
    const root = createDriftedRepo({ originHead: false });
    writeFileSync(
      path.join(root, ".lisa.config.json"),
      JSON.stringify({ deploy: { branches: { production: "main" } } })
    );
    const { stdout, stderr } = runHook(root, "configured");
    expect(stderr).toContain("(deploy.branches.production)");
    expect(baseSubject(stdout.trim())).toBe(INTEGRATION_COMMIT_SUBJECT);
  });

  it("ignores an origin/HEAD symref pointing outside refs/remotes/origin/", () => {
    const root = createDriftedRepo({ originHead: false });
    // A symref that resolves, but to a ref the remote does not govern. Taking
    // it would let anything that can write the ref store choose the base.
    git(root, [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      `refs/heads/${FEATURE_BRANCH}`,
    ]);
    const { stderr } = runHook(root, "crafted");
    expect(stderr).toContain("(fallback)");
    expect(stderr).not.toContain("(origin/HEAD)");
  });

  it("refuses when LISA_WORKTREE_BASE names a ref that does not resolve", () => {
    const root = createDriftedRepo();
    const { status, stdout, stderr } = runHook(root, "badbase", {
      env: { LISA_WORKTREE_BASE: "refs/heads/does-not-exist" },
    });

    // An explicit override that cannot be honored is a configuration error the
    // operator can see and fix. Silently using a different base is the exact
    // failure this hook exists to stop.
    expect(status).not.toBe(0);
    expect(stdout.trim()).toBe("");
    expect(stderr).toContain("LISA_WORKTREE_BASE");
    expect(existsSync(path.join(root, ".claude", "worktrees", "badbase"))).toBe(
      false
    );
  });

  it("honors a LISA_WORKTREE_BASE that does resolve", () => {
    const root = createDriftedRepo();
    const { stdout, stderr } = runHook(root, "override", {
      env: { LISA_WORKTREE_BASE: `refs/heads/${FEATURE_BRANCH}` },
    });
    expect(stderr).toContain("(LISA_WORKTREE_BASE)");
    expect(baseSubject(stdout.trim())).toBe(FEATURE_COMMIT_SUBJECT);
  });

  it("warns rather than silently resolving the repo when cwd is missing", () => {
    const root = createDriftedRepo();
    const { status, stderr } = runHook(root, "nocwd", { omitCwd: true });

    // The hook cannot know which repository was intended — it is handed only
    // `{ name, cwd }`. What it must not do is take the process working
    // directory without saying so.
    expect(status).toBe(0);
    expect(stderr).toContain("payload carried no 'cwd'");
  });
});
