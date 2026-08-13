/**
 * Doctor coverage for an UNREGISTERED learnings union merge driver.
 *
 * `.gitattributes` ships the `merge=lisa-learnings` mapping, but git refuses to
 * read a driver COMMAND from a repository — so a clone that never ran `lisa
 * apply` silently falls back to git's built-in text merge for the ledger. That
 * degradation is safe (it leaves conflict markers rather than resolving to
 * empty) and completely invisible, which is the gap these tests close: doctor
 * must say out loud that the union an operator believes is protecting the
 * ledger is not registered here, and name the one command that fixes it.
 * @module tests/unit/cli/doctor-learnings-merge-driver
 */
import * as fse from "fs-extra";
import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDoctor } from "../../../src/cli/doctor.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CHECK_NAME = "Learnings merge driver registered?";
const LEDGER_CHECK_NAME = "Single learnings ledger?";
const DRIVER_KEY = "merge.lisa-learnings.driver";
const CANONICAL_LEDGER = ".lisa/PROJECT_LEARNINGS.md";
const ATTRIBUTES = `${CANONICAL_LEDGER} merge=lisa-learnings\n`;

/**
 * Resolve git to an absolute executable path by scanning `PATH`.
 * @returns Absolute path to the git executable
 */
function resolveGit(): string {
  const found = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(directory => directory !== "")
    .map(directory => path.join(directory, "git"))
    .find(candidate => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  if (found === undefined) {
    throw new Error("git executable not found on PATH");
  }
  return found;
}

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
  execFileSync(GIT, [...args], {
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
 * Run doctor and return the merge-driver check.
 * @param cwd - Fixture project path
 * @returns The merge-driver check result
 */
async function driverCheck(
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

describe("doctor learnings merge-driver check", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await fse.writeJson(path.join(tempDir, ".lisa.config.json"), {
      harness: "claude",
    });
    await fse.outputFile(path.join(tempDir, ".gitattributes"), ATTRIBUTES);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("warns when the ledger is mapped to a driver git cannot run", async () => {
    git(tempDir, ["init"]);
    const check = await driverCheck(tempDir);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain(DRIVER_KEY);
  });

  it("names the repair command and the silent degradation it prevents", async () => {
    git(tempDir, ["init"]);
    const check = await driverCheck(tempDir);
    expect(check.detail).toContain("lisa install-merge-driver");
    expect(check.detail).toMatch(/text merge|conflict marker/iu);
  });

  it("passes once the driver command is registered locally", async () => {
    git(tempDir, ["init"]);
    git(tempDir, ["config", "--local", DRIVER_KEY, "lisa merge-learnings"]);
    const check = await driverCheck(tempDir);
    expect(check.status).toBe("ok");
  });

  it("passes when the host opted out with learnings.mergeDriver false", async () => {
    git(tempDir, ["init"]);
    await fse.writeJson(path.join(tempDir, ".lisa.config.json"), {
      harness: "claude",
      learnings: { mergeDriver: false },
    });
    const check = await driverCheck(tempDir);
    expect(check.status).toBe("ok");
    expect(check.detail).toMatch(/opted out|mergeDriver/iu);
  });

  it("passes when nothing maps the ledger to the driver", async () => {
    git(tempDir, ["init"]);
    await fse.outputFile(path.join(tempDir, ".gitattributes"), "*.md text\n");
    const check = await driverCheck(tempDir);
    expect(check.status).toBe("ok");
  });

  it("passes outside a git repository, where registration cannot apply", async () => {
    const check = await driverCheck(tempDir);
    expect(check.status).toBe("ok");
    expect(check.detail).toMatch(/git repositor/iu);
  });

  it("reports the merge arm immediately after the single-ledger check", async () => {
    git(tempDir, ["init"]);
    const names = (await doctorChecks(tempDir)).map(check => check.name);
    expect(names.indexOf(CHECK_NAME)).toBe(
      names.indexOf(LEDGER_CHECK_NAME) + 1
    );
  });
});
