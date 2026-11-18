/**
 * Every wait in the Sonar hook has a ceiling, so an abandoned hook exits
 * instead of leaking.
 *
 * CodySwannGT/lisa#5038. Four `sonar-secrets.sh claude-prompt-submit` processes
 * were found on one workstation, each orphaned to PID 1 with no children, 2h,
 * 2h, 5h and 146h old. No children means the shell was blocked in a builtin:
 * the stdin drain waited for an EOF that a caller who gave up on the hook never
 * sent. `sonar hook` had no ceiling either. These cases stage both, with the
 * real generated shim under `/bin/bash`, and require the hook to exit 0 inside
 * its bound and to leave no member of its process group behind.
 * @module tests/unit/hooks/sonar-hook-bounds
 */
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import {
  awaitCloseWithin,
  groupHasMembers,
  killGroupAndAwaitClose,
  watchChild,
  type WatchedChild,
} from "./support/process-group.js";
import {
  BASH,
  FINDING,
  HOOK_DEADLINE_ENV,
  HOOK_RUN_BUDGET_MS,
  KILL_CLOSE_BASE_MS,
  PROMPT_EVENT,
  SOURCE,
  stubSonar,
} from "./support/sonar-secrets-fixtures.js";

// Spawns `/bin/bash` against the real shim, like the other Sonar suites.
useIoLatencyBudget();

/**
 * Quiet-box bound for the hook to close once its one-second ceiling expires.
 *
 * The staged ceiling is one second; the rest is a `bash` start and a stub
 * `sonar` start, whose cost grows with load. Scaled by the worker's measured
 * slowdown, it stays far under the case's own budget, so a hook that never
 * exits fails naming its pid, exit and output rather than as a case timeout.
 */
const SELF_EXIT_BASE_MS = 10_000;

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A stub `sonar` that reads its input and then never answers.
 *
 * It `exec`s, so the scanner is one process, as the real CLI (a single native
 * executable) is. It keeps the stdout it was handed, which is what a hung
 * network call looks like from the hook's side.
 * @returns Directory holding the stub, to be prepended to PATH
 */
function hungSonar(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-sonar-hung-bin-"));
  const stub = path.join(dir, "sonar");
  scratch.push(dir);
  writeFileSync(
    stub,
    ["#!/bin/bash", "cat >/dev/null", "exec /bin/sleep 300"].join("\n")
  );
  chmodSync(stub, 0o755);
  return dir;
}

/**
 * Start the hook detached, so it leads its own process group.
 * @param bin - Directory holding the stub `sonar`
 * @param env - Ceilings to stage, applied after the scaled defaults
 * @returns The watched hook
 */
function startHook(
  bin: string,
  env: Readonly<Record<string, string>>
): WatchedChild {
  const child = spawn(BASH, [SOURCE, PROMPT_EVENT], {
    detached: true,
    env: {
      ...process.env,
      PATH: [bin, process.env.PATH].join(path.delimiter),
      ...HOOK_DEADLINE_ENV,
      ...env,
    },
  });
  // Watched from spawn, before any await (CodySwannGT/lisa#5034).
  return watchChild(child);
}

/**
 * The hook's pid, which is also its process group's id.
 * @param hook - The watched hook
 * @returns The pid
 */
function pidOf(hook: WatchedChild): number {
  const { pid } = hook.child;
  if (pid === undefined) throw new Error("the hook has no PID");
  return pid;
}

describe("an abandoned hook exits instead of leaking", () => {
  it("exits 0 within its stdin bound when the caller never closes stdin", async () => {
    const hook = startHook(stubSonar(FINDING), {
      LISA_SONAR_STDIN_TIMEOUT_S: "1",
    });
    try {
      // The whole envelope, then nothing: the write end stays open for good,
      // which is what a caller that abandoned the hook leaves behind.
      hook.child.stdin?.write(JSON.stringify({ prompt: "hello" }));

      const closed = await awaitCloseWithin(
        hook,
        SELF_EXIT_BASE_MS,
        "with its stdin held open past a 1s bound"
      );

      expect(closed).toEqual({ code: 0, signal: null });
      expect(hook.describe()).toContain("did not finish arriving within 1s");
      expect(groupHasMembers(pidOf(hook))).toBe(false);
    } finally {
      await killGroupAndAwaitClose(hook, KILL_CLOSE_BASE_MS);
    }
  });

  it("exits 0 within its scanner ceiling and kills a scanner that never answers", async () => {
    const hook = startHook(hungSonar(), { LISA_SONAR_SCAN_TIMEOUT_S: "1" });
    try {
      hook.child.stdin?.end(JSON.stringify({ prompt: "hello" }));

      const closed = await awaitCloseWithin(
        hook,
        SELF_EXIT_BASE_MS,
        "with a scanner that never answers past a 1s ceiling"
      );

      expect(closed).toEqual({ code: 0, signal: null });
      expect(hook.describe()).toContain(
        "secret scanner did not answer within 1s"
      );
      // The stub `sleep` shares the hook's group; a scanner left running is a
      // member of it.
      expect(groupHasMembers(pidOf(hook))).toBe(false);
    } finally {
      await killGroupAndAwaitClose(hook, KILL_CLOSE_BASE_MS);
    }
  });
});

describe("the stdin bound never costs the drain", () => {
  it("still drains a payload larger than a pipe buffer with an unparseable bound", () => {
    // `read -t garbage` fails at once without reading, which would close the
    // pipe on a writer still in flight: the EPIPE of CodySwannGT/lisa#2949.
    // An unparseable value falls back to the shipped ten seconds instead.
    const emptyBin = mkdtempSync(path.join(tmpdir(), "lisa-empty-bin-"));
    scratch.push(emptyBin);
    const result = boundedSpawnSync({
      label: "the sonar hook wrapper with an unparseable stdin bound",
      command: BASH,
      args: [SOURCE, PROMPT_EVENT],
      baseMs: HOOK_RUN_BUDGET_MS,
      input: "x".repeat(1024 * 1024),
      env: {
        PATH: emptyBin,
        LISA_SONAR_STDIN_TIMEOUT_S: "garbage",
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });
});
