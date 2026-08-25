/**
 * Doctor coverage for UNREGISTERED merge drivers.
 *
 * `.gitattributes` ships the `merge=<name>` mapping, but git refuses to read a
 * driver COMMAND from a repository — so a clone that never ran the registration
 * step silently falls back to git's built-in text merge. That degradation is
 * safe (it leaves conflict markers rather than resolving a file to empty) and
 * completely invisible, which is the gap these tests close: doctor must say out
 * loud that the driver an operator believes is protecting a path is not
 * registered here, and name the command that fixes it.
 *
 * The roster case is the one that matters for CodySwannGT/lisa#3084. The check
 * used to name `lisa-learnings` and only `lisa-learnings`, so Lisa's SECOND
 * driver would have been uncovered until somebody widened it — the same
 * "declared, and inert" defect the drivers themselves exist to close. These
 * tests pin that the roster comes from `.gitattributes`, using a driver name
 * that appears nowhere in Lisa's source.
 * @module tests/unit/cli/doctor-merge-drivers
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDoctor } from "../../../src/cli/doctor.js";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const CHECK_NAME = "Merge drivers registered?";
const LEDGER_CHECK_NAME = "Single learnings ledger?";
const DRIVER_KEY = "merge.lisa-learnings.driver";
const INIT = ["init"] as const;
const ATTRIBUTES_FILE = ".gitattributes";
const CANONICAL_LEDGER = ".lisa/PROJECT_LEARNINGS.md";
const ATTRIBUTES = `${CANONICAL_LEDGER} merge=lisa-learnings\n`;

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

describe("doctor merge-driver registration check", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await fse.writeJson(path.join(tempDir, ".lisa.config.json"), {
      harness: "claude",
    });
    await fse.outputFile(path.join(tempDir, ATTRIBUTES_FILE), ATTRIBUTES);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("warns when the ledger is mapped to a driver git cannot run", async () => {
    git(tempDir, INIT);
    const check = await driverCheck(tempDir);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain(DRIVER_KEY);
  });

  it("names the repair command and the silent degradation it prevents", async () => {
    git(tempDir, INIT);
    const check = await driverCheck(tempDir);
    expect(check.detail).toContain("lisa install-merge-driver");
    expect(check.detail).toMatch(/text merge|conflict marker/iu);
  });

  it("passes once the driver command is registered locally", async () => {
    git(tempDir, INIT);
    git(tempDir, ["config", "--local", DRIVER_KEY, "lisa merge-learnings"]);
    const check = await driverCheck(tempDir);
    expect(check.status).toBe("ok");
  });

  it("passes when the host opted out with learnings.mergeDriver false", async () => {
    git(tempDir, INIT);
    await fse.writeJson(path.join(tempDir, ".lisa.config.json"), {
      harness: "claude",
      learnings: { mergeDriver: false },
    });
    const check = await driverCheck(tempDir);
    expect(check.status).toBe("ok");
    expect(check.detail).toMatch(/opted out|mergeDriver/iu);
  });

  it("warns about a driver Lisa has never heard of, named only by .gitattributes", async () => {
    git(tempDir, INIT);
    await fse.outputFile(
      path.join(tempDir, ATTRIBUTES_FILE),
      "generated/report.json merge=some-third-party-driver\n"
    );
    const check = await driverCheck(tempDir);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("merge.some-third-party-driver.driver");
  });

  it("ignores git's built-in strategies, which need no registration", async () => {
    git(tempDir, INIT);
    await fse.outputFile(
      path.join(tempDir, ATTRIBUTES_FILE),
      "CHANGELOG.md merge=union\n*.png merge=binary\n"
    );
    const check = await driverCheck(tempDir);
    expect(check.status).toBe("ok");
  });

  it("names every unregistered driver when more than one is mapped", async () => {
    git(tempDir, INIT);
    await fse.outputFile(
      path.join(tempDir, ATTRIBUTES_FILE),
      `${CANONICAL_LEDGER} merge=lisa-learnings\nsrc/core/generated.ts merge=lisa-generated-artifact\n`
    );
    const check = await driverCheck(tempDir);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("merge.lisa-learnings.driver");
    expect(check.detail).toContain("merge.lisa-generated-artifact.driver");
  });

  it("passes when nothing maps a path to a custom driver", async () => {
    git(tempDir, INIT);
    await fse.outputFile(path.join(tempDir, ATTRIBUTES_FILE), "*.md text\n");
    const check = await driverCheck(tempDir);
    expect(check.status).toBe("ok");
  });

  it("passes outside a git repository, where registration cannot apply", async () => {
    const check = await driverCheck(tempDir);
    expect(check.status).toBe("ok");
    expect(check.detail).toMatch(/git repositor/iu);
  });

  it("reports the merge arm immediately after the single-ledger check", async () => {
    git(tempDir, INIT);
    const names = (await doctorChecks(tempDir)).map(check => check.name);
    expect(names.indexOf(CHECK_NAME)).toBe(
      names.indexOf(LEDGER_CHECK_NAME) + 1
    );
  });
});
