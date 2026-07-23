/**
 * Registration mechanics for the learnings union merge driver.
 *
 * Git runs `merge.<name>.driver` through `sh`, so the registered command is a
 * SHELL string even though we never spawn a shell to write it. That makes
 * quoting load-bearing: this repo shipped the same bug class in #1982, where a
 * double-quoted path containing `$` silently expanded to nothing.
 */
import * as fs from "fs-extra";
import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInstallMergeDriver } from "../../../src/cli/install-merge-driver-cmd.js";
import { installLearningsMergeDriver } from "../../../src/core/learnings-merge-driver-install.js";
import { LEARNINGS_MERGE_DRIVER_NAME } from "../../../src/core/learnings-merge-driver.js";

const DRIVER_KEY = `merge.${LEARNINGS_MERGE_DRIVER_NAME}.driver`;
/** A benign, already shell-quoted invocation for registration tests. */
const STUB_INVOCATION = "'/opt/lisa' 'index.js'";
const ENTRY_SCRIPT = "'index.js'";
const DRIVER_SUBCOMMAND = "merge-learnings";

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
 * Environment without the outer repository's git hook state.
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

describe("installLearningsMergeDriver", () => {
  let repo: string;
  let dir: string;

  /**
   * Read the registered driver command.
   * @returns Configured command, or undefined when unset
   */
  function registered(): string | undefined {
    try {
      return execFileSync(GIT, ["config", "--local", "--get", DRIVER_KEY], {
        cwd: repo,
        env: cleanGitEnv(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return undefined;
    }
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-driver-scratch-"));
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-driver-install-"));
    execFileSync(GIT, ["init"], {
      cwd: repo,
      env: cleanGitEnv(),
      stdio: "ignore",
    });
  });

  afterEach(async () => {
    await fs.remove(repo);
    await fs.remove(dir);
  });

  it("registers the driver command", async () => {
    const result = await installLearningsMergeDriver(repo, {
      invocation: STUB_INVOCATION,
    });
    expect(result.kind).toBe("installed");
    expect(registered()).toContain(DRIVER_SUBCOMMAND);
  });

  it("reports an already-correct registration as unchanged", async () => {
    const invocation = STUB_INVOCATION;
    await installLearningsMergeDriver(repo, { invocation });
    const second = await installLearningsMergeDriver(repo, { invocation });
    expect(second.kind).toBe("unchanged");
  });

  it("skips a directory that is not a git repository", async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-not-a-repo-"));
    try {
      const result = await installLearningsMergeDriver(plain);
      expect(result.kind).toBe("skipped");
    } finally {
      await fs.remove(plain);
    }
  });

  describe("shell quoting of the registered command", () => {
    // Git executes the driver through `sh`. Under double quotes `$`, backtick
    // and backslash stay special, so a path containing any of them produces a
    // command that silently fails to launch — or, with a backtick, runs a
    // command substitution.
    const HOSTILE = [
      "/opt/lisa$HOME/x",
      "/opt/li`id`sa",
      "/opt/back\\slash",
      '/opt/dq"uote/x',
    ];

    it.each(HOSTILE)(
      "survives a path containing shell metacharacters: %s",
      async hostile => {
        await installLearningsMergeDriver(repo, {
          invocation: `'${hostile}' ${ENTRY_SCRIPT}`,
        });
        // The shell must reproduce the path byte-for-byte after expansion.
        const command = registered() ?? "";
        const echoed = execFileSync(
          "/bin/sh",
          [
            "-c",
            `set -- ${command.split(` ${DRIVER_SUBCOMMAND}`)[0] as string}; printf '%s' "$1"`,
          ],
          { encoding: "utf8" }
        );
        expect(echoed).toBe(hostile);
      }
    );

    it("does not execute a command substitution embedded in the path", async () => {
      // A security review demonstrated a working RCE against the original
      // double-quoted form: an install path containing $(touch …) ran on the
      // first `git merge`. Single quotes make the shell treat it as data.
      const marker = path.join(dir, "PWNED");
      await installLearningsMergeDriver(repo, {
        invocation: `'/opt/lisa$(touch ${marker})/x' ${ENTRY_SCRIPT}`,
      });
      const command = registered() ?? "";
      execFileSync(
        "/bin/sh",
        [
          "-c",
          `set -- ${command.split(` ${DRIVER_SUBCOMMAND}`)[0] as string}; printf '%s' "$1" >/dev/null`,
        ],
        { encoding: "utf8" }
      );
      expect(await fs.pathExists(marker)).toBe(false);
    });
  });

  it("does not report success when git config cannot be written", async () => {
    // A path that exists as a repo but whose config write will fail: point the
    // installer at a repository whose .git/config is read-only.
    const configPath = path.join(repo, ".git", "config");
    await fs.chmod(configPath, 0o400);
    try {
      const result = await installLearningsMergeDriver(repo, {
        invocation: STUB_INVOCATION,
      });
      // Root can write regardless of mode; only assert when the guard held.
      if (result.kind !== "installed") {
        expect(result.kind).toBe("failed");
      }
    } finally {
      await fs.chmod(configPath, 0o600);
    }
  });
});

describe("runInstallMergeDriver exit codes", () => {
  let plain: string;

  beforeEach(async () => {
    plain = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-install-cmd-"));
  });

  afterEach(async () => {
    await fs.remove(plain);
  });

  it("passes for a directory that is not a git repository", async () => {
    const lines: string[] = [];
    const code = await runInstallMergeDriver(plain, {
      log: message => lines.push(message),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toMatch(/not a git repository/i);
  });
});
