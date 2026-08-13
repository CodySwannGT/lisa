/**
 * `block-direct-issue-create` must not fail open silently when its interpreters
 * are absent.
 *
 * The hook's exit code IS its contract: 2 refuses, 0 allows, and Claude Code
 * treats every OTHER non-zero exit as a non-blocking hook error — meaning the
 * command runs. Under `set -euo pipefail` an unguarded `jq` on a machine
 * without it exits 127, and the guard that enforces ready-role filing would
 * then permit exactly what it exists to stop. This is not hypothetical: the
 * agent containers this fleet deploys into shipped no jq, which is why jq is
 * now a pinned toolchain entry and why `block-no-verify` grew the same probe.
 *
 * Failing OPEN is still correct — a hook that cannot parse its input cannot
 * tell an undeclared filing from a read, and failing closed would block every
 * Bash call on a machine missing an interpreter. Doing it SILENTLY is not: a
 * guard that is quietly absent is indistinguishable from a guard that passes.
 *
 * Split from `block-direct-issue-create.test.ts` for the same reason
 * `block-no-verify-missing-jq.test.ts` is split from its sibling — the fixture
 * is a PATH shim rather than a payload, so it shares nothing with the
 * classification suite.
 * @module tests/unit/hooks/block-direct-issue-create-missing-interpreter
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

const SCRIPT_PATH = path.resolve(
  "plugins/src/base/hooks/block-direct-issue-create.sh"
);
const EXIT_ALLOWED = 0;

/** A PreToolUse payload for the filing the guard exists to refuse. */
const PAYLOAD = JSON.stringify({
  tool_name: "Bash",
  tool_input: { command: 'gh issue create --title "x"' },
});

/** Tools the hook legitimately needs, including the two it probes for. */
const SHIM_TOOLS = [
  "bash",
  "sh",
  "env",
  "printf",
  "grep",
  "cat",
  "jq",
  "python3",
];

/** Shim directories to clean up once the suite is done. */
const shims: string[] = [];

afterAll(() => {
  for (const dir of shims.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * Find an executable by scanning PATH directly.
 *
 * Deliberately not `command -v` in a subprocess: resolving a command *through*
 * PATH is what `sonarjs/no-os-command-from-path` exists to prevent, and reading
 * the directories to build a fixture needs no subprocess at all.
 * @param tool - The executable name.
 * @returns Its absolute path, or undefined.
 */
const locate = (tool: string): string | undefined =>
  (process.env["PATH"] ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map(entry => path.join(entry, tool))
    .find(candidate => existsSync(candidate));

/** An absolute bash, so the runner is never resolved through the shim PATH. */
const BASH_PATH = locate("bash") ?? "/bin/bash";

/**
 * A PATH directory holding every tool the hook needs except one.
 *
 * Deliberately not `PATH=/nonexistent`: the hook reads its payload with `cat`,
 * so an empty PATH kills it before the interpreter probe under test and the
 * assertion would pass for the wrong reason.
 * @param omitted - The tool to leave out.
 * @returns The shim directory path.
 */
const shimWithout = (omitted: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-issue-guard-shim-"));
  shims.push(dir);
  for (const tool of SHIM_TOOLS) {
    if (tool === omitted) continue;
    const found = locate(tool);
    if (found) symlinkSync(found, path.join(dir, tool));
  }
  return dir;
};

/**
 * A throwaway project directory with a configured GitHub tracker.
 * @returns The directory path.
 */
const projectWithTracker = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-issue-guard-cfg-"));
  shims.push(dir);
  writeFileSync(
    path.join(dir, ".lisa.config.json"),
    JSON.stringify({ tracker: "github" }),
    "utf-8"
  );
  return dir;
};

describe("block-direct-issue-create.sh without its interpreters", () => {
  it.each(["jq", "python3"])(
    "allows the filing but announces on stderr when %s is unavailable",
    tool => {
      const result = spawnSync(BASH_PATH, [SCRIPT_PATH], {
        cwd: projectWithTracker(),
        env: {
          ...process.env,
          PATH: shimWithout(tool),
          CLAUDE_PROJECT_DIR: "",
          LISA_ALLOW_DIRECT_ISSUE_CREATE: "",
        },
        input: PAYLOAD,
        encoding: "utf-8",
      });

      expect(result.status).toBe(EXIT_ALLOWED);
      expect(result.stderr).toContain("block-direct-issue-create");
      expect(result.stderr).toContain(tool);
      expect(result.stderr).toContain("NOT active");
    }
  );
});
