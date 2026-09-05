/**
 * Proof that `cleanup-worktrees.sh` can REFUSE, and with which exit status.
 *
 * `check:shell-guard-refusals` reported this script as
 * `driven 1 time(s), only ever exit 0 — nothing proves it can refuse`. Every
 * other suite that runs it drives a happy path: the sibling `-unreadable` and
 * `-apply` suites both build a valid repository and assert `status === 0`. So
 * the two `exit 1` arms in argument and repository validation had no test at
 * all, and deleting either would have left the suite green.
 *
 * That gap matters more than it looks for this particular script. Its whole
 * job is deleting worktrees, and both refusals sit BEFORE any deletion — one
 * rejects a malformed `--min-age-days`, the other a target that is not a git
 * repository. A regression that turned either into a fall-through would not
 * fail loudly; it would carry on with `MIN_AGE_DAYS` holding whatever followed,
 * or sweep a directory nobody meant to point it at.
 *
 * EXACT STATUS, NOT `not.toBe(0)`. The coverage check asks for the exact code
 * for a reason: `not.toBe(0)` cannot tell a guard that refused from one that
 * crashed, and a script under `set -uo pipefail` has several ways to die with a
 * non-zero status that are not refusals. Each case therefore pins `1` and the
 * message that identifies WHICH refusal fired.
 *
 * THE ALLOW CONTROL IS THE POINT OF THE THIRD CASE. Two refusals on their own
 * are satisfied by a script that refuses everything, which would be a worse
 * defect than the one being guarded against — so a real repository must still
 * come back 0 in the same suite, under the same runner and environment.
 *
 * DRY-RUN THROUGHOUT. No case passes `--apply`. The refusal cases never reach
 * the sweep at all, and the control reports decisions and deletes nothing.
 * @module tests/unit/scripts/cleanup-worktrees-refusals
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  boundedExecFileSync,
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { cleanGitEnv, GIT_BIN } from "../../support/git-executable.js";

useIoLatencyBudget();

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const CLEANUP_SCRIPT = path.join(repoRoot, "scripts", "cleanup-worktrees.sh");
const TRACKED_FILE = "tracked.txt";
const SAFE_COMMAND_PATH = `${path.dirname(
  GIT_BIN
)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`;

/** The status both validation arms exit with. */
const REFUSED = 1;

let tempDir: string | undefined;

/**
 * Resolve the run-scoped scratch directory for one case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await mkdtemp(path.join(os.tmpdir(), "lisa-cleanup-refusals-"));
  return tempDir;
}

/**
 * Run git with fixture identity and no ambient configuration.
 * @param cwd - Working directory
 * @param hooks - Empty hooks directory, so no repository hook can fire
 * @param args - Git arguments
 * @returns Standard output
 */
function git(cwd: string, hooks: string, ...args: readonly string[]): string {
  return boundedExecFileSync({
    label: `git ${args.join(" ")}`,
    command: GIT_BIN,
    args: [
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "user.name=Lisa Fixture",
      "-c",
      "commit.gpgsign=false",
      "-c",
      `core.hooksPath=${hooks}`,
      ...args,
    ],
    cwd,
    env: { ...cleanGitEnv(), HOME: cwd },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Invoke the real script and return its full result, refusals included.
 * @param args - Arguments after the script path
 * @param home - HOME for the child, kept off the developer's own
 * @returns Status, stdout and stderr
 */
function runCleanup(
  args: readonly string[],
  home: string
): { status: number | null; stdout: string; stderr: string } {
  const result = boundedSpawnSync({
    label: `cleanup-worktrees.sh ${args.join(" ")}`,
    command: "/bin/bash",
    args: [CLEANUP_SCRIPT, ...args],
    env: { HOME: home, PATH: SAFE_COMMAND_PATH },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("cleanup-worktrees.sh refusals", () => {
  it("refuses --min-age-days with no value, rather than consuming the next word", async () => {
    const root = await getTempDir();

    const result = runCleanup(["--min-age-days"], root);

    expect(result.status).toBe(REFUSED);
    expect(result.stderr).toContain("--min-age-days requires a value");
  });

  it("refuses a target that is not a git repository", async () => {
    const root = await getTempDir();
    const notARepository = path.join(root, "plain-directory");
    await mkdir(notARepository, { recursive: true });

    const result = runCleanup([notARepository], root);

    // The message, not just the status: under `set -uo pipefail` there are
    // other ways to exit 1, and only this string says the check fired.
    expect(result.status).toBe(REFUSED);
    expect(result.stderr).toContain("not a git repository");
  });

  it("still accepts a real repository, so the refusals above mean something", async () => {
    // The allow control. Without it, a script that refused unconditionally
    // would satisfy both cases above while being far more broken.
    const root = await getTempDir();
    const repo = path.join(root, "repo");
    const hooks = path.join(root, "no-hooks");
    await mkdir(repo, { recursive: true });
    await mkdir(hooks, { recursive: true });

    git(root, hooks, "init", "--initial-branch=main", repo);
    await writeFile(path.join(repo, TRACKED_FILE), "committed\n");
    git(repo, hooks, "add", TRACKED_FILE);
    git(repo, hooks, "commit", "-m", "base");

    const result = runCleanup(["--min-age-days", "0", repo], root);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("not a git repository");
  });
});
