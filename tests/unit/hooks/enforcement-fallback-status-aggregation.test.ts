/**
 * How lisa-enforcement-fallback.sh combines the exit statuses of the guards it
 * replays a payload to.
 *
 * Only exit 2 is a refusal in Claude Code. Every other non-zero is a
 * non-blocking error: it is surfaced and the tool call proceeds. The aggregate
 * used to be the numerically largest status, so a guard that errored with 3 —
 * or died on a missing interpreter with 127 — outranked another guard's 2 and
 * silently downgraded a refusal into a warning. The command then ran.
 *
 * These tests drive the real script against stub guards, so they assert the
 * aggregation rule itself rather than any particular guard's behaviour.
 * @module tests/unit/hooks/enforcement-fallback-status-aggregation
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const BASH = "/bin/bash";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FALLBACK = path.join(
  REPO_ROOT,
  "scripts",
  "lisa-enforcement-fallback.sh"
);

/** Claude's refusal code. Anything else lets the command through. */
const BLOCKED = 2;

/** The guards the fallback replays a payload to. */
const GUARDS = [
  "block-no-verify",
  "parity-safety-net",
  "block-shell-json-parsing",
  "block-instruction-file-edits",
  "block-direct-issue-create",
] as const;

/** Throwaway project roots to remove after each case. */
const projectRoots: string[] = [];

/**
 * Build a throwaway project whose guards are stubs with fixed exit statuses.
 * @param statuses Exit status per guard name; omitted guards exit 0.
 * @returns The project root to hand the fallback as CLAUDE_PROJECT_DIR.
 */
function projectWithGuards(statuses: Readonly<Record<string, number>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-fallback-"));
  const guardDir = path.join(root, "scripts", "lisa-hooks");

  projectRoots.push(root);
  mkdirSync(guardDir, { recursive: true });

  for (const guard of GUARDS) {
    const status = statuses[guard] ?? 0;
    const script = path.join(guardDir, `${guard}.sh`);
    // Drain stdin so the fallback's `printf | bash` never takes a SIGPIPE.
    writeFileSync(
      script,
      `#!/usr/bin/env bash\ncat >/dev/null\nexit ${status}\n`
    );
    chmodSync(script, 0o755);
  }
  return root;
}

/**
 * Run the fallback against a stubbed project.
 * @param root Project root containing the stub guards.
 * @returns The fallback's exit status.
 */
function runFallback(root: string): number | null {
  return boundedSpawnSync({
    label: "lisa-enforcement-fallback.sh",
    command: BASH,
    args: [FALLBACK],
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  }).status;
}

afterEach(() => {
  for (const root of projectRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("enforcement fallback status aggregation", () => {
  it("returns 2 when a guard refuses and a later guard errors with 3", () => {
    // The regression. Under `-gt` this returned 3, which is not a refusal, so
    // the command Claude proposed ran despite a guard having blocked it.
    const root = projectWithGuards({
      "block-no-verify": 2,
      "block-instruction-file-edits": 3,
    });

    expect(runFallback(root)).toBe(BLOCKED);
  });

  it("returns 2 when the erroring guard runs BEFORE the refusing one", () => {
    // Order must not matter: 2 is sticky in one direction and dominant in the
    // other.
    const root = projectWithGuards({
      "block-no-verify": 3,
      "block-instruction-file-edits": 2,
    });

    expect(runFallback(root)).toBe(BLOCKED);
  });

  it("returns 2 when a guard dies on a missing interpreter (127)", () => {
    // The concrete case: block-shell-json-parsing ran jq under `set -e` with no
    // probe, so a container without jq exited 127 — which beat every refusal.
    const root = projectWithGuards({
      "block-no-verify": 2,
      "block-shell-json-parsing": 127,
    });

    expect(runFallback(root)).toBe(BLOCKED);
  });

  it("still reports a non-blocking error when nothing refused", () => {
    // Dominance must not swallow diagnostics. With no refusal, a guard's error
    // is still the exit status, so a broken guard stays visible.
    const root = projectWithGuards({ "parity-safety-net": 3 });

    expect(runFallback(root)).toBe(3);
  });

  it("returns 0 when every guard passes", () => {
    // A fallback that blocks everything is not enforcement, it is an outage.
    expect(runFallback(projectWithGuards({}))).toBe(0);
  });
});
