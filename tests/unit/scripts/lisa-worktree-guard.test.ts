/**
 * Unit tests for all/copy-overwrite/scripts/lisa-worktree-guard.mjs (#3863).
 *
 * The guard exists because two agents hit the same worktree deletion on the
 * same evening and only one lost work: `.git/refs` and the object store are
 * shared between worktrees, `.git/index` and the working files are not. So the
 * property under test is a content property, never a tracking-state one — the
 * question is whether some commit already holds these exact bytes.
 *
 * The REJECTION CONTROL is the point of this file. A check that passes in both
 * states proves nothing, so every refusal case below is paired with the
 * byte-for-byte inverse that must be allowed: the same file, staged the same
 * way, differing only in whether a commit contains it.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/scripts/lisa-worktree-guard
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyWorktree } from "../../../all/copy-overwrite/scripts/lisa-worktree-guard.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const SCRIPT = path.resolve(
  "all/copy-overwrite/scripts/lisa-worktree-guard.mjs"
);
const GIT = resolveGit();
const LEDGER = "lisa-worktree-removals.jsonl";
const STAGED_FILE = "staged.txt";
const STAGED_BYTES = "work that exists nowhere else\n";

/** Exit status meaning "safe, or removed". */
const OK = 0;
/** Exit status meaning "usage or environment error". */
const ERROR = 1;
/** Exit status meaning "refused: uncommitted work would be destroyed". */
const REFUSED = 2;

/**
 * Process env with outer git hook state stripped, for nested temp repos.
 * @returns Environment safe for fixture git commands
 */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  env.GIT_AUTHOR_NAME = "t";
  env.GIT_AUTHOR_EMAIL = "t@t";
  env.GIT_COMMITTER_NAME = "t";
  env.GIT_COMMITTER_EMAIL = "t@t";
  return env;
}

/**
 * Run git in a fixture directory.
 * @param cwd - Directory to run in
 * @param args - Arguments after `git`
 * @returns Captured stdout
 */
function git(cwd: string, args: string[]): string {
  return boundedSpawnSync({
    label: `git ${args[0]}`,
    command: GIT,
    args,
    cwd,
    env: cleanGitEnv(),
  }).stdout;
}

/**
 * Run the guard CLI.
 * @param args - Arguments after the script path
 * @param cwd - Directory to run in
 * @returns Exit status and captured streams
 */
function runGuard(
  args: string[],
  cwd: string
): { status: number | null; stdout: string; stderr: string } {
  const result = boundedSpawnSync({
    label: "lisa-worktree-guard",
    command: process.execPath,
    args: [SCRIPT, ...args],
    cwd,
    env: cleanGitEnv(),
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

let tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) await cleanupTempDir(dir);
  tempDirs = [];
});

/**
 * A repository with one commit and one linked worktree on its own branch.
 * @returns The primary checkout and the linked worktree paths
 */
async function fixture(): Promise<{ primary: string; worktree: string }> {
  const tempDir = await createTempDir();
  tempDirs.push(tempDir);
  const primary = path.join(tempDir, "primary");
  const worktree = path.join(tempDir, "linked");

  mkdirSync(primary, { recursive: true });
  git(primary, ["init", "-q", "-b", "main", "."]);
  writeFileSync(path.join(primary, "seed.txt"), "seed\n");
  git(primary, ["add", "seed.txt"]);
  git(primary, ["commit", "-q", "-m", "seed"]);
  git(primary, ["worktree", "add", "-q", worktree, "-b", "side"]);

  return { primary, worktree };
}

/**
 * Read every ledger row written beside the shared object store.
 * @param primary - Primary checkout path
 * @returns Parsed ledger rows, oldest first
 */
function ledgerRows(primary: string): Record<string, unknown>[] {
  const file = path.join(primary, ".git", LEDGER);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>);
}

describe("lisa-worktree-guard", () => {
  it("refuses a worktree holding one staged file that exists in no commit", async () => {
    const { primary, worktree } = await fixture();
    writeFileSync(path.join(worktree, STAGED_FILE), STAGED_BYTES);
    git(worktree, ["add", STAGED_FILE]);

    const result = runGuard(["check", worktree], primary);

    expect(result.status).toBe(REFUSED);
    expect(result.stderr).toContain(STAGED_FILE);
    expect(result.stderr).toContain("exist in no commit");
  });

  it("allows the byte-identical inverse: the same staged file, committed", async () => {
    const { primary, worktree } = await fixture();
    writeFileSync(path.join(worktree, STAGED_FILE), STAGED_BYTES);
    git(worktree, ["add", STAGED_FILE]);
    git(worktree, ["commit", "-q", "-m", "keep"]);

    const result = runGuard(["check", worktree], primary);

    expect(result.status).toBe(OK);
  });

  it("allows an untracked file whose bytes are already in a commit", async () => {
    const { primary, worktree } = await fixture();
    writeFileSync(path.join(worktree, STAGED_FILE), STAGED_BYTES);
    git(worktree, ["add", STAGED_FILE]);
    git(worktree, ["commit", "-q", "-m", "keep"]);
    writeFileSync(path.join(worktree, "duplicate.txt"), STAGED_BYTES);

    const result = runGuard(["check", worktree], primary);

    expect(result.status).toBe(OK);
  });

  it("refuses an untracked file whose bytes are in no commit", async () => {
    const { primary, worktree } = await fixture();
    writeFileSync(path.join(worktree, "fresh.txt"), "never committed\n");

    const result = runGuard(["check", worktree], primary);

    expect(result.status).toBe(REFUSED);
    expect(result.stderr).toContain("fresh.txt");
  });

  it("ignores paths git ignores", async () => {
    const { primary, worktree } = await fixture();
    writeFileSync(path.join(primary, ".gitignore"), "build/\n");
    git(primary, ["add", ".gitignore"]);
    git(primary, ["commit", "-q", "-m", "ignore build"]);
    git(worktree, ["merge", "-q", "main"]);
    mkdirSync(path.join(worktree, "build"), { recursive: true });
    writeFileSync(path.join(worktree, "build", "out.js"), "artifact\n");

    const result = runGuard(["check", worktree], primary);

    expect(result.status).toBe(OK);
  });

  it("removes a clean worktree without ceremony", async () => {
    const { primary, worktree } = await fixture();

    const result = runGuard(["remove", worktree], primary);

    expect(result.status).toBe(OK);
    expect(existsSync(worktree)).toBe(false);
  });

  it("refuses to remove the primary checkout, with no override", async () => {
    const { primary } = await fixture();

    const result = runGuard(["remove", primary, "--force"], primary);

    expect(result.status).toBe(ERROR);
    expect(result.stderr).toContain("primary checkout");
  });

  it("proceeds under --force and records the override in the shared git dir", async () => {
    const { primary, worktree } = await fixture();
    writeFileSync(path.join(worktree, STAGED_FILE), STAGED_BYTES);
    git(worktree, ["add", STAGED_FILE]);

    const result = runGuard(["remove", worktree, "--force"], primary);

    expect(result.status).toBe(OK);
    expect(existsSync(worktree)).toBe(false);
    const overrides = ledgerRows(primary).filter(
      row => row.action === "override"
    );
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?.atRisk).toEqual([
      {
        path: STAGED_FILE,
        blob: "5b1fe83bff7f581cfe3532be5d29deda0d436394",
        source: "index",
      },
    ]);
  });

  it("records a refusal even when nothing is deleted", async () => {
    const { primary, worktree } = await fixture();
    writeFileSync(path.join(worktree, STAGED_FILE), STAGED_BYTES);
    git(worktree, ["add", STAGED_FILE]);

    runGuard(["check", worktree], primary);

    const refusals = ledgerRows(primary).filter(
      row => row.action === "refused"
    );
    expect(refusals).toHaveLength(1);
  });

  it("honours the environment spelling of the override", async () => {
    const { primary, worktree } = await fixture();
    writeFileSync(path.join(worktree, "fresh.txt"), "never committed\n");

    const result = boundedSpawnSync({
      label: "lisa-worktree-guard (env override)",
      command: process.execPath,
      args: [SCRIPT, "check", worktree],
      cwd: primary,
      env: { ...cleanGitEnv(), LISA_WORKTREE_REMOVE_OVERRIDE: "1" },
    });

    expect(result.status).toBe(OK);
  });

  it("refuses a worktree whose index it cannot read", async () => {
    const { worktree } = await fixture();
    // A corrupt index makes `git diff --cached` fail while `rev-parse` and
    // `worktree list` still answer, so the guard identifies the worktree and
    // then cannot enumerate its candidate paths. Before unreadability
    // propagated, that failure arrived as an EMPTY candidate list and the
    // worktree was classified `safe` — a deletion authorised by a probe that
    // never ran.
    const indexFile = path.join(worktree, ".git");
    const gitDir = readFileSync(indexFile, "utf8")
      .replace("gitdir: ", "")
      .trim();
    writeFileSync(path.join(gitDir, "index"), "not an index\n");

    const verdict = classifyWorktree(worktree) as {
      ok: boolean;
      reason: string;
    };

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("unreadable");
  });

  it("allows the same worktree once its index reads again", async () => {
    // The rejection control for the case above: byte-for-byte the same
    // fixture, differing only in whether the index is readable.
    const { worktree } = await fixture();

    const verdict = classifyWorktree(worktree) as {
      ok: boolean;
      reason: string;
    };

    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toBe("safe");
  });

  it("classifies a path that is not a worktree without throwing", async () => {
    const tempDir = await createTempDir();
    tempDirs.push(tempDir);

    const verdict = classifyWorktree(tempDir) as {
      ok: boolean;
      reason: string;
    };

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("not-a-worktree");
  });
});
