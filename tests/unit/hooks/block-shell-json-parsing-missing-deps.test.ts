/**
 * `block-shell-json-parsing` must not fail open when its interpreters are absent.
 *
 * The hook's exit code IS its contract: 2 refuses, 0 allows, and Claude Code
 * treats every OTHER non-zero exit as a non-blocking hook error — the command
 * runs. `jq` was called unguarded under `set -euo pipefail`, so a container
 * without jq exited 127 and the guard silently vanished.
 *
 * That 127 was worse than a lost guard. `lisa-enforcement-fallback.sh` used to
 * aggregate guard statuses by taking the numerically largest, so this hook's
 * 127 outranked a SIBLING guard's 2 and downgraded its refusal to a warning.
 * One missing interpreter disabled more than one guard.
 *
 * Failing OPEN stays correct — a hook that cannot parse its input cannot tell a
 * violation from an ordinary command, and failing closed would block every Bash
 * call on a machine missing an interpreter. Doing it SILENTLY is not: a guard
 * that is quietly absent is indistinguishable from a guard that passes.
 *
 * Mirrors block-no-verify-missing-jq, which covers the sibling hook.
 * @module tests/unit/hooks/block-shell-json-parsing-missing-deps
 */

import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** The hook as it is installed into a project. */
const HOOK = path.resolve(
  __dirname,
  "../../../all/copy-overwrite/scripts/lisa-hooks/block-shell-json-parsing.sh"
);

/** A payload the hook refuses when it is working: jq's job done with grep. */
const VIOLATION = JSON.stringify({
  tool_name: "Bash",
  tool_input: { command: "grep '\"name\"' package.json | cut -d'\"' -f4" },
});

/** Every tool the hook may legitimately reach for. */
const ALL_TOOLS = [
  "bash",
  "sh",
  "env",
  "printf",
  "grep",
  "cat",
  "jq",
  "python3",
];

/** Literal, not a shared constant: a changed harness must not mask a changed contract. */
const BLOCKED = 2;
const ALLOWED = 0;

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

/** An absolute bash, so the runner is never resolved through a shim PATH. */
const BASH = locate("bash") ?? "/bin/bash";

/** Shim PATH directories, each missing exactly one interpreter. */
const shims = new Map<string, string>();

for (const omitted of ["jq", "python3"]) {
  const dir = mkdtempSync(path.join(tmpdir(), `lisa-no-${omitted}-`));
  for (const tool of ALL_TOOLS) {
    if (tool === omitted) continue;
    const found = locate(tool);
    if (found) symlinkSync(found, path.join(dir, tool));
  }
  shims.set(omitted, dir);
}

afterAll(() => {
  for (const dir of shims.values())
    rmSync(dir, { recursive: true, force: true });
});

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
  const result = boundedSpawnSync({
    label: "block-shell-json-parsing.sh",
    command: BASH,
    args: [HOOK],
    input: payload,
    env: { ...process.env, PATH: pathEnv },
  });

  return { status: result.status ?? -1, stderr: result.stderr ?? "" };
}

describe.each([["jq"], ["python3"]])(
  "block-shell-json-parsing when %s is missing",
  omitted => {
    it("does not exit 127, which would read as a non-blocking hook error", () => {
      // 127 is the whole bug: not a refusal, so the command proceeds unguarded
      // — and under the old fallback aggregation it also outranked a sibling
      // guard's genuine refusal.
      const { status } = runHook(VIOLATION, shims.get(omitted));

      expect(status).not.toBe(127);
      expect(status).toBe(ALLOWED);
    });

    it("says on stderr that the protection is not active", () => {
      // Failing open is acceptable; failing open silently is not.
      const { stderr } = runHook(VIOLATION, shims.get(omitted));

      expect(stderr).toContain(
        `block-shell-json-parsing: ${omitted} not found; JSON-parsing protection is NOT active`
      );
    });
  }
);

describe("block-shell-json-parsing with its interpreters present", () => {
  it("still refuses a violation with exit 2", () => {
    // The guard must not have been weakened to achieve the above.
    expect(runHook(VIOLATION).status).toBe(BLOCKED);
  });

  it("still allows an ordinary command", () => {
    expect(
      runHook(
        JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "jq -r .name package.json" },
        })
      ).status
    ).toBe(ALLOWED);
  });
});
