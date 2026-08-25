/**
 * Doctor coverage for a readiness report that a checkout still TRACKS.
 *
 * `.lisa/readiness.json` is shipped on the ignored side of `.gitignore`
 * (CodySwannGT/lisa#3046) because it is derived: every field recomputes on the
 * next `lisa doctor --readiness`, and three of the nine describe the run rather
 * than the repository. But `.gitignore` binds UNTRACKED paths only. A checkout
 * that committed a report before the rule shipped — a host repository that has
 * not re-applied templates, a `git add -f`, any clone predating the change —
 * keeps committing it on every doctor run, and the ignore rule says nothing
 * either way.
 *
 * That is the same shape as the unregistered merge driver next door: a
 * protection present in the repository and absent at runtime, silent in both
 * directions. These tests close it — doctor must name the tracked path and the
 * one command that stops tracking it.
 * @module tests/unit/cli/doctor-readiness-tracking
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDoctor } from "../../../src/cli/doctor.js";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const CHECK_NAME = "Readiness report untracked?";
const REPORT_PATH = ".lisa/readiness.json";
const REPORT_BODY = `${JSON.stringify(
  {
    schema_version: 1,
    generated_at: "2026-08-25T00:00:00.000Z",
    lisa_version: "4.6.2",
    worker_signature: "claude/unknown/unknown",
    verdict: "NOT_READY",
    narrowed_claim: "ready for supervised changes only",
    blockers: [],
    blocker_count: 0,
    dimensions: [],
  },
  null,
  2
)}\n`;

const GIT = resolveGit();

/**
 * Environment without the outer repository's git state, so fixture repos are
 * never contaminated by the worktree these tests run inside.
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

/**
 * Run one git command inside a fixture repository.
 * @param cwd - Fixture repository path
 * @param args - Literal git arguments
 */
function git(cwd: string, args: readonly string[]): void {
  boundedExecFileSync({
    label: `git ${args.join(" ")}`,
    command: GIT,
    args,
    cwd,
    env: cleanGitEnv(),
    stdio: "ignore",
  });
}

/**
 * Run doctor offline against a fixture and return every check.
 * @param cwd - Fixture project path
 * @returns Doctor check results
 */
async function doctorChecks(
  cwd: string
): Promise<readonly { name: string; status: string; detail: string }[]> {
  const result = await runDoctor(
    cwd,
    { json: true, offline: true },
    {
      write: vi.fn(),
      setExitCode: vi.fn(),
      runUpdateCheck: vi.fn().mockResolvedValue({ updateAvailable: false }),
    }
  );
  return result.checks;
}

/**
 * Run doctor and return the readiness-tracking check.
 * @param cwd - Fixture project path
 * @returns The readiness-tracking check result
 */
async function trackingCheck(
  cwd: string
): Promise<{ status: string; detail: string }> {
  const check = (await doctorChecks(cwd)).find(
    candidate => candidate.name === CHECK_NAME
  );
  if (check === undefined) {
    throw new Error(`doctor did not run the "${CHECK_NAME}" check`);
  }
  return check;
}

describe("doctor readiness-report tracking check", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await fse.writeJson(path.join(tempDir, ".lisa.config.json"), {
      harness: "claude",
    });
    await fse.outputFile(path.join(tempDir, REPORT_PATH), REPORT_BODY);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("warns when the checkout tracks the derived readiness report", async () => {
    git(tempDir, ["init"]);
    git(tempDir, ["add", "--force", REPORT_PATH]);
    const check = await trackingCheck(tempDir);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain(REPORT_PATH);
  });

  it("names `git rm --cached` and says why the ignore rule alone will not help", async () => {
    git(tempDir, ["init"]);
    git(tempDir, ["add", "--force", REPORT_PATH]);
    const check = await trackingCheck(tempDir);
    expect(check.detail).toContain(`git rm --cached ${REPORT_PATH}`);
    expect(check.detail).toContain("does not untrack");
  });

  it("stays a warning rather than failing, because a tracked report is hygiene", async () => {
    git(tempDir, ["init"]);
    git(tempDir, ["add", "--force", REPORT_PATH]);
    const check = await trackingCheck(tempDir);
    expect(check.status).not.toBe("fail");
  });

  it("passes when the report exists on disk but git does not track it", async () => {
    git(tempDir, ["init"]);
    await fse.outputFile(path.join(tempDir, ".gitignore"), `${REPORT_PATH}\n`);
    const check = await trackingCheck(tempDir);
    expect(check.status).toBe("ok");
    expect(check.detail).toContain("not tracked");
  });

  it("passes in a repository that has never written a readiness report", async () => {
    git(tempDir, ["init"]);
    await fse.remove(path.join(tempDir, ".lisa", "readiness.json"));
    const check = await trackingCheck(tempDir);
    expect(check.status).toBe("ok");
  });

  it("passes outside a git repository, where tracking cannot apply", async () => {
    const check = await trackingCheck(tempDir);
    expect(check.status).toBe("ok");
    expect(check.detail).toMatch(/git repositor|git working tree/iu);
  });

  it("reports the tracking arm immediately after the learnings merge arm", async () => {
    git(tempDir, ["init"]);
    const names = (await doctorChecks(tempDir)).map(check => check.name);
    expect(names.indexOf(CHECK_NAME)).toBe(
      names.indexOf("Learnings merge driver registered?") + 1
    );
  });
});
