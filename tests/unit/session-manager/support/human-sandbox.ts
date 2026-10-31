/**
 * Shared fixtures for the "mark and move on" CLI suites
 * (CodySwannGT/lisa#4555, part 3): a GitHub project whose human-needed label
 * and blocked role are custom (so a hard-coded name would fail), a runner
 * whose PATH holds only the stubs and system dirs (so no real `gh`, `claude`
 * or `bws` can be reached), and a helper that records a pending question.
 * @module tests/unit/session-manager/support/human-sandbox
 */
import { statSync } from "node:fs";
import path from "node:path";

import {
  MANAGER,
  makeSandbox,
  runCli,
  STUB_BIN,
  type RunOptions,
  type RunResult,
  type Sandbox,
} from "./cli-harness.js";
import { stubOnlyPath } from "./provider-sandbox.js";

export const REF = "example-org/demo-repo#7";
export const QUESTION = "Should the export be CSV or JSON?";
export const MARKER = "[lisa-session-manager-question]";
export const OPERATOR = "op-login";
export const TRUSTED = "trusted-login";
export const WORKER_QUESTION = "worker-question";
export const CUSTOM_LABEL = "custom:needs-person";
export const CUSTOM_BLOCKED = "custom:blocked";

/** Capacity limits loose enough that the host can never make a spawn flaky. */
export const LOOSE_CAPACITY = {
  maxWorkers: 6,
  gbPerWorker: 1,
  reserveGb: 0,
  cpuFraction: 1,
  maxLoadPerCore: 1000,
};

/** A manager block with no channel, operators and trusted authors. */
export const BLOCK = {
  name: MANAGER,
  capacity: LOOSE_CAPACITY,
  operatorIds: [OPERATOR],
  trustedAuthorIds: [TRUSTED],
};

/**
 * Run the CLI with only the stubs and system dirs on PATH, refusing to run
 * at all if a stub that shadows a real tool has lost its executable bit.
 * @param sandbox - Project sandbox
 * @param args - CLI arguments
 * @param options - stdin, extra env and agents fixture
 * @returns CLI result
 */
export function runStubOnly(
  sandbox: Sandbox,
  args: readonly string[],
  options: RunOptions = {}
): RunResult {
  for (const stub of ["gh", "claude", "vm_stat"]) {
    if ((statSync(path.join(STUB_BIN, stub)).mode & 0o111) === 0) {
      throw new Error(`stub ${stub} is not executable; refusing to run`);
    }
  }
  return runCli(sandbox, args, {
    ...options,
    env: { PATH: stubOnlyPath(), ...options.env },
  });
}

/**
 * A GitHub project whose human-needed label and blocked role are custom.
 * @param sessionManager - Block override
 * @returns Sandbox
 */
export function githubSandbox(
  sessionManager: Record<string, unknown> = BLOCK
): Sandbox {
  return makeSandbox({
    sessionManager,
    extraConfig: {
      github: {
        org: "example-org",
        repo: "demo-repo",
        labels: {
          build: {
            ready: "status:ready",
            blocked: CUSTOM_BLOCKED,
            human_needed: CUSTOM_LABEL,
          },
        },
      },
    },
  });
}

/**
 * Record a pending question on REF.
 * @param sandbox - Project sandbox
 * @param kind - Question kind
 * @returns CLI result
 */
export function ask(sandbox: Sandbox, kind = WORKER_QUESTION): RunResult {
  return runStubOnly(sandbox, ["ledger", "set-question", REF, "--kind", kind], {
    input: QUESTION,
  });
}
