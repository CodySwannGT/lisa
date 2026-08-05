/**
 * `block-no-verify` must not fail open when its interpreters are absent.
 *
 * The hook's exit code IS its contract: 2 refuses, 0 allows, and Claude Code
 * treats every OTHER non-zero exit as a non-blocking hook error — meaning the
 * command runs. `jq` was called unguarded under `set -euo pipefail`, so a
 * container without jq exited 127 and the hook that enforces "never
 * --no-verify" silently permitted exactly what it exists to stop.
 *
 * Not hypothetical: the agent containers this is deployed into shipped no jq,
 * which is why jq is now a pinned toolchain entry. The Codex variant of this
 * script always had the guard, so this was a parity gap.
 *
 * Failing OPEN is still correct — a hook that cannot parse its input cannot
 * tell a bypass from an ordinary command, and failing closed would block every
 * Bash call on a machine missing an interpreter. Doing it SILENTLY is not: a
 * guard that is quietly absent is indistinguishable from a guard that passes.
 * @module tests/unit/hooks/block-no-verify-missing-jq
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/** The hook as it is installed into a project. */
const HOOK = path.resolve(
  __dirname,
  "../../../all/copy-overwrite/scripts/lisa-hooks/block-no-verify.sh"
);

/** A PreToolUse payload for a command that bypasses the hooks. */
const BYPASS = JSON.stringify({
  tool_name: "Bash",
  tool_input: { command: "git commit --no-verify -m x" },
});

/** Tools the hook legitimately needs, minus the one under test. */
const SHIM_TOOLS = ["bash", "sh", "env", "printf", "grep", "cat", "python3"];

/** A PATH directory deliberately missing `jq`. */
const shim = mkdtempSync(path.join(tmpdir(), "lisa-nojq-"));

/**
 * Find an executable by scanning PATH directly.
 *
 * Deliberately not `spawnSync("command -v")`: resolving a command *through*
 * PATH is what `sonarjs/no-os-command-from-path` exists to prevent, and reading
 * the directories to build a fixture needs no subprocess at all.
 * @param tool The executable name.
 * @returns Its absolute path, or undefined.
 */
function locate(tool: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, tool);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** An absolute bash, so the runner is never resolved through the shim PATH. */
const BASH = locate("bash") ?? "/bin/bash";

for (const tool of SHIM_TOOLS) {
  const found = locate(tool);
  if (found) symlinkSync(found, path.join(shim, tool));
}

afterAll(() => rmSync(shim, { recursive: true, force: true }));

/**
 * Run the hook with a payload and a PATH.
 * @param payload The JSON given on stdin.
 * @param pathEnv The PATH to run under.
 * @returns Exit status and stderr.
 */
function runHook(
  payload: string,
  pathEnv = process.env.PATH
): { status: number; stderr: string } {
  const result = spawnSync(BASH, [HOOK], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, PATH: pathEnv },
  });

  return { status: result.status ?? -1, stderr: result.stderr ?? "" };
}

describe("block-no-verify when jq is missing", () => {
  it("does not exit 127, which would read as a non-blocking hook error", () => {
    // 127 is the whole bug: not a refusal, so the command proceeds unguarded.
    const { status } = runHook(BYPASS, shim);

    expect(status).not.toBe(127);
    expect(status).toBe(0);
  });

  it("says on stderr that the protection is not active", () => {
    // Failing open is acceptable; failing open silently is not.
    const { stderr } = runHook(BYPASS, shim);

    expect(stderr).toMatch(/jq not found/);
    expect(stderr).toMatch(/protection is NOT active/);
  });
});

describe("block-no-verify with its interpreters present", () => {
  it("still refuses a bypass with exit 2", () => {
    // The guard must not have been weakened to achieve the above.
    expect(runHook(BYPASS).status).toBe(2);
  });

  it("still allows an ordinary command", () => {
    expect(
      runHook(
        JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "git status" },
        })
      ).status
    ).toBe(0);
  });
});
