/** Shared real-process fixtures for the lisa-test-run black-box contracts. */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { expect } from "vitest";

import { boundedSpawnSync, ioLatencyBudgetMs } from "./io-latency-budget.js";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
export const TEST_RUN_ENTRY = path.join(REPO_ROOT, "src/cli/lisa-test-run.ts");
export const SUPERVISED_SCRATCH_FIXTURE = path.join(
  REPO_ROOT,
  "tests/helpers/__fixtures__/supervised-scratch-command.ts"
);
export const PAYLOAD_MARKER = "payload.json";
export const SCRATCH_NAMESPACE = "lisa-scratch";
export const SCRATCH_OWNER_FILE = ".lisa-scratch-owner.json";
export const OPAQUE_CONTROL = "lisa-test-run-opaque-environment-control";
export const TEST_RUN_SOURCE_ARGS = [
  "--import",
  "tsx",
  TEST_RUN_ENTRY,
  "--profile",
  "lisa",
  "--adapter",
  "vitest",
  "--",
  process.execPath,
  "--import",
  "tsx",
  SUPERVISED_SCRATCH_FIXTURE,
] as const;

/**
 * Allocate one fixture base and hand teardown ownership to the calling suite.
 * @param prefix - Direct temporary basename prefix
 * @param register - Suite-local teardown registry
 * @returns Registered fixture base
 */
export function temporaryTestRunDirectory(
  prefix: string,
  register: (directory: string) => void
): string {
  const base = fs.mkdtempSync(path.join(tmpdir(), prefix));
  register(base);
  return base;
}

/**
 * Run one payload through the source CLI and return its recorded scope.
 * @param environment - Calling test process environment
 * @param register - Suite-local teardown registry
 * @param mode - Payload exit arm
 * @param fault - Optional STOP transport fault
 * @returns Wrapper status and recorded scope
 */
export function runTestSupervisor(
  environment: NodeJS.ProcessEnv,
  register: (directory: string) => void,
  mode: "pass" | "fail",
  fault?: "stop-send-closed" | "stop-send-rejected"
): {
  readonly status: number | null;
  readonly root: string;
  readonly base: string;
  readonly stderr: string;
} {
  const base = temporaryTestRunDirectory("lisa-test-run-", register);
  const marker = path.join(base, PAYLOAD_MARKER);
  const result = boundedSpawnSync({
    label: `lisa-test-run ${mode}`,
    command: process.execPath,
    args: [...TEST_RUN_SOURCE_ARGS],
    baseMs: 15_000,
    cwd: REPO_ROOT,
    env: {
      ...environment,
      TMPDIR: base,
      TMP: base,
      TEMP: base,
      LISA_TEST_RUN_MARKER: marker,
      LISA_TEST_RUN_MODE: mode,
      LISA_TEST_SCRATCH_SUITE: "lisa",
      ...(fault === undefined ? {} : { LISA_TEST_RUN_TEST_FAULT: fault }),
    },
  });
  const payload = JSON.parse(fs.readFileSync(marker, "utf8")) as {
    root: string;
  };
  return {
    status: result.status,
    root: payload.root,
    base,
    stderr: result.stderr,
  };
}

/**
 * Wait for one observable condition under the calibrated I/O budget.
 * @param condition - Observable predicate
 * @param label - Timeout diagnostic
 */
export async function waitForTestRun(
  condition: () => boolean,
  label: string
): Promise<void> {
  const deadline = Date.now() + ioLatencyBudgetMs(10_000);
  while (!condition() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (!condition()) throw new Error(`Timed out waiting for ${label}`);
}

/**
 * Whether a pid still resolves to any process.
 * @param pid - Process to probe
 * @returns Whether the pid exists
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Direct supervisor companions discovered without platform-specific ps flags.
 * @param parentPid - Parent process id
 * @returns Direct reaper/bootstrap process ids
 */
export function testRunCompanionPids(parentPid: number): readonly number[] {
  const result = boundedSpawnSync({
    label: "supervisor child process inventory",
    command: "/bin/ps",
    args: ["-axo", "pid=,ppid=,command="],
    baseMs: 2_000,
  });
  return result.stdout
    .split("\n")
    .map(line => line.trim().split(/\s+/u))
    .filter(
      fields =>
        Number(fields[1]) === parentPid &&
        fields
          .slice(2)
          .some(field => /lisa-test-run-(?:reaper|bootstrap)/u.test(field))
    )
    .map(fields => Number(fields[0]));
}

/**
 * Start a payload that remains alive until the wrapper is signalled.
 * @param environment - Calling test process environment
 * @param register - Suite-local teardown registry
 * @param mode - Whether the payload honors catchable signals
 * @param fault - Optional forwarded-signal transport fault
 * @returns Running wrapper, payload marker, and process identities
 */
export async function startWaitingTestRun(
  environment: NodeJS.ProcessEnv,
  register: (directory: string) => void,
  mode: "wait" | "ignore-signals" = "wait",
  fault?: "signal-send-rejected"
): Promise<{
  readonly child: ReturnType<typeof spawn>;
  readonly marker: string;
  readonly root: string;
  readonly payloadPid: number;
  readonly companionPids: readonly number[];
}> {
  const base = temporaryTestRunDirectory("lisa-test-run-kill-", register);
  const marker = path.join(base, PAYLOAD_MARKER);
  const child = spawn(process.execPath, [...TEST_RUN_SOURCE_ARGS], {
    cwd: REPO_ROOT,
    env: {
      ...environment,
      TMPDIR: base,
      TMP: base,
      TEMP: base,
      LISA_TEST_RUN_MARKER: marker,
      LISA_TEST_RUN_MODE: mode,
      LISA_TEST_SCRATCH_SUITE: "lisa",
      LISA_TEST_RUN_OPAQUE_CONTROL: OPAQUE_CONTROL,
      ...(fault === undefined ? {} : { LISA_TEST_RUN_TEST_FAULT: fault }),
    },
    stdio: "ignore",
  });
  await waitForTestRun(
    () =>
      fs.existsSync(marker) &&
      fs.readFileSync(marker, "utf8").trim().endsWith("}"),
    "complete waiting payload marker"
  );
  const payload = JSON.parse(fs.readFileSync(marker, "utf8")) as {
    readonly pid: number;
    readonly root: string;
    readonly opaque: string;
  };
  const companionPids = testRunCompanionPids(child.pid ?? -1);
  expect(payload.opaque).toBe(OPAQUE_CONTROL);
  expect(companionPids).toHaveLength(2);
  return {
    child,
    marker,
    root: payload.root,
    payloadPid: payload.pid,
    companionPids,
  };
}

/**
 * Start a payload that exits while an unref'ed descendant remains.
 * @param environment - Calling test process environment
 * @param register - Suite-local teardown registry
 * @param mode - Original payload result to preserve
 * @returns Running wrapper and every identity that must be gone on return
 */
export async function startGrandchildTestRun(
  environment: NodeJS.ProcessEnv,
  register: (directory: string) => void,
  mode: "grandchild-pass" | "grandchild-fail" | "grandchild-sigkill"
): Promise<{
  readonly child: ReturnType<typeof spawn>;
  readonly root: string;
  readonly descendantPid: number;
  readonly companionPids: readonly number[];
}> {
  const base = temporaryTestRunDirectory("lisa-test-run-grandchild-", register);
  const marker = path.join(base, PAYLOAD_MARKER);
  const child = spawn(process.execPath, [...TEST_RUN_SOURCE_ARGS], {
    cwd: REPO_ROOT,
    env: {
      ...environment,
      TMPDIR: base,
      TMP: base,
      TEMP: base,
      LISA_TEST_RUN_MARKER: marker,
      LISA_TEST_RUN_MODE: mode,
      LISA_TEST_SCRATCH_SUITE: "lisa",
    },
    stdio: "ignore",
  });
  await waitForTestRun(
    () =>
      fs.existsSync(marker) &&
      fs.readFileSync(marker, "utf8").trim().endsWith("}"),
    "grandchild payload marker"
  );
  const payload = JSON.parse(fs.readFileSync(marker, "utf8")) as {
    readonly root: string;
    readonly descendantPid: number;
  };
  const companionPids = testRunCompanionPids(child.pid ?? -1);
  expect(companionPids).toHaveLength(2);
  return {
    child,
    root: payload.root,
    descendantPid: payload.descendantPid,
    companionPids,
  };
}
