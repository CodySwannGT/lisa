/**
 * A git command that works in one folder and nowhere else
 * (CodySwannGT/lisa#4995).
 *
 * A proof is run from wherever the operator happens to be, which may be
 * inside a git hook. Git exports the repository it is working in to its
 * hooks, and a command started there would answer for that repository
 * instead of the folder it was started in. The command built here answers
 * for its own folder whatever the environment says.
 * @module tests/unit/controls/proof-isolated-git
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isolatedGit } from "../../../src/controls/proof-patch.js";
import { runControlAuditGit } from "../../helpers/control-audit-fixtures.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** Asks git which repository a folder belongs to. */
const WHICH_REPOSITORY = ["rev-parse", "--show-toplevel"];

describe("a git command started for a proof", () => {
  let sandbox: string;
  let workspace: string;
  let other: string;

  /**
   * Start git in the workspace, built the way a proof builds it or as the
   * bare program, with the environment this process has.
   * @param prefix - The program and everything before git's own arguments
   * @returns Exit status and what git printed
   */
  function ask(prefix: readonly string[]): {
    readonly status: number | null;
    readonly stdout: string;
  } {
    const [program = "git", ...before] = prefix;
    const child = boundedSpawnSync({
      label: "git rev-parse in a proof workspace",
      command: program,
      args: [...before, ...WHICH_REPOSITORY],
      cwd: workspace,
      env: process.env,
    });
    return { status: child.status, stdout: child.stdout.trim() };
  }

  beforeEach(() => {
    sandbox = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-proof-git-")));
    workspace = path.join(sandbox, "workspace");
    other = path.join(sandbox, "other");
    mkdirSync(workspace);
    mkdirSync(other);
    runControlAuditGit(other, ["init", "--quiet"]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(sandbox, { force: true, recursive: true });
  });

  it("answers for the folder it is started in when the environment names another repository", () => {
    runControlAuditGit(workspace, ["init", "--quiet"]);
    vi.stubEnv("GIT_DIR", path.join(other, ".git"));
    vi.stubEnv("GIT_WORK_TREE", other);

    expect(ask(["git"])).toEqual({ status: 0, stdout: other });
    expect(ask(isolatedGit(workspace))).toEqual({
      status: 0,
      stdout: workspace,
    });
  });

  it("does not take a repository the folder merely sits inside as its own", () => {
    runControlAuditGit(sandbox, ["init", "--quiet"]);

    expect(ask(["git"])).toEqual({ status: 0, stdout: sandbox });
    expect(ask(isolatedGit(workspace)).status).not.toBe(0);
  });

  it("names its program by a fixed place and ends with git", () => {
    const command = isolatedGit(workspace);

    expect(path.isAbsolute(command[0] ?? "")).toBe(true);
    expect(command.at(-1)).toBe("git");
  });
});
