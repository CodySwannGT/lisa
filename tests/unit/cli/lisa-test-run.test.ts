/** Black-box contract for the foreground test supervisor and detached reaper. */
/* eslint-disable code-organization/enforce-statement-order -- fixture allocation must precede derived paths */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { spawn, spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { assertTestRunPlatform } from "../../../src/cli/lisa-test-run.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const ENTRY = path.join(REPO_ROOT, "src/cli/lisa-test-run.ts");
const FIXTURE = path.join(
  REPO_ROOT,
  "tests/helpers/__fixtures__/supervised-scratch-command.ts"
);
const temporaryDirectories: string[] = [];
const PAYLOAD_MARKER = "payload.json";

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * Run one payload through the source CLI and return its recorded scope.
 * @param mode - Payload exit arm
 * @returns Wrapper status and recorded scope
 */
function run(mode: "pass" | "fail"): {
  readonly status: number | null;
  readonly root: string;
  readonly base: string;
} {
  const base = fs.mkdtempSync(path.join(tmpdir(), "lisa-test-run-"));
  temporaryDirectories.push(base);
  const marker = path.join(base, PAYLOAD_MARKER);
  const result = boundedSpawnSync({
    label: `lisa-test-run ${mode}`,
    command: process.execPath,
    args: [
      "--import",
      "tsx",
      ENTRY,
      "--",
      process.execPath,
      "--import",
      "tsx",
      FIXTURE,
    ],
    baseMs: 15_000,
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LISA_TEST_SCRATCH_ROOT: base,
      TMPDIR: base,
      TMP: base,
      TEMP: base,
      LISA_TEST_RUN_MARKER: marker,
      LISA_TEST_RUN_MODE: mode,
      LISA_TEST_SCRATCH_SUITE: "cli",
    },
  });
  const payload = JSON.parse(fs.readFileSync(marker, "utf8")) as {
    root: string;
  };
  return { status: result.status, root: payload.root, base };
}

/**
 * Wait for one observable condition under the calibrated I/O budget.
 * @param condition - Observable predicate
 * @param label - Timeout diagnostic
 */
async function waitFor(condition: () => boolean, label: string): Promise<void> {
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
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Direct children of one process, discovered without platform-specific ps flags.
 * @param parentPid - Parent process id
 * @returns Direct child process ids
 */
function childPids(parentPid: number): readonly number[] {
  const result = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
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
 * @returns Running wrapper, payload marker, and process identities
 */
async function startWaitingRun(): Promise<{
  readonly child: ReturnType<typeof spawn>;
  readonly marker: string;
  readonly root: string;
  readonly payloadPid: number;
  readonly companionPids: readonly number[];
}> {
  const base = fs.mkdtempSync(path.join(tmpdir(), "lisa-test-run-kill-"));
  temporaryDirectories.push(base);
  const marker = path.join(base, PAYLOAD_MARKER);
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      ENTRY,
      "--",
      process.execPath,
      "--import",
      "tsx",
      FIXTURE,
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        LISA_TEST_SCRATCH_ROOT: base,
        TMPDIR: base,
        TMP: base,
        TEMP: base,
        LISA_TEST_RUN_MARKER: marker,
        LISA_TEST_RUN_MODE: "wait",
        LISA_TEST_SCRATCH_SUITE: "cli-kill",
      },
      stdio: "ignore",
    }
  );
  await waitFor(() => fs.existsSync(marker), "waiting payload marker");
  const payload = JSON.parse(fs.readFileSync(marker, "utf8")) as {
    readonly pid: number;
    readonly root: string;
  };
  const companionPids = childPids(child.pid ?? -1);
  expect(companionPids).toHaveLength(2);
  return {
    child,
    marker,
    root: payload.root,
    payloadPid: payload.pid,
    companionPids,
  };
}

describe("lisa-test-run", () => {
  it("refuses an unsupported platform before protocol startup", () => {
    expect(() => assertTestRunPlatform("win32")).toThrow(/Darwin or Linux/iu);
  });
  it.each([
    ["pass", 0],
    ["fail", 23],
  ] as const)("preserves %s after proving scratch absence", (mode, status) => {
    const result = run(mode);

    expect(result.status).toBe(status);
    expect(result.root).toContain(`${path.sep}lisa-scratch${path.sep}`);
    expect(fs.existsSync(result.root)).toBe(false);
    expect(fs.readdirSync(path.join(result.base, "lisa-scratch"))).toEqual([]);
  });

  it("rejects a missing separator or command as usage exit 2", () => {
    const result = boundedSpawnSync({
      label: "lisa-test-run usage",
      command: process.execPath,
      args: ["--import", "tsx", ENTRY],
      baseMs: 2_000,
      cwd: REPO_ROOT,
      env: process.env,
    });
    expect(result.status).toBe(2);
  });

  it("makes raw unsupervised Lisa Vitest setup fail actionably", () => {
    const base = fs.mkdtempSync(path.join(tmpdir(), "lisa-test-run-raw-"));
    temporaryDirectories.push(base);
    const marker = path.join(base, PAYLOAD_MARKER);
    const inherited = { ...process.env };
    delete inherited["LISA_TEST_RUN_LEASE"];
    const result = boundedSpawnSync({
      label: "raw unsupervised scratch setup",
      command: process.execPath,
      args: ["--import", "tsx", FIXTURE],
      baseMs: 5_000,
      cwd: REPO_ROOT,
      env: {
        ...inherited,
        TMPDIR: base,
        TMP: base,
        TEMP: base,
        LISA_TEST_RUN_MARKER: marker,
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("lisa-test-run -- vitest");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it.each(["reaper-startup", "kill-reaper-after-root"])(
    "fails closed on %s without starting a payload",
    fault => {
      const base = fs.mkdtempSync(path.join(tmpdir(), "lisa-test-run-fault-"));
      temporaryDirectories.push(base);
      const marker = path.join(base, PAYLOAD_MARKER);
      const result = boundedSpawnSync({
        label: fault,
        command: process.execPath,
        args: [
          "--import",
          "tsx",
          ENTRY,
          "--",
          process.execPath,
          "--import",
          "tsx",
          FIXTURE,
        ],
        baseMs: 15_000,
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          LISA_TEST_SCRATCH_ROOT: base,
          TMPDIR: base,
          TMP: base,
          TEMP: base,
          LISA_TEST_RUN_MARKER: marker,
          LISA_TEST_RUN_TEST_FAULT: fault,
        },
      });
      expect(result.status).toBe(1);
      expect(fs.existsSync(marker)).toBe(false);
      expect(fs.readdirSync(path.join(base, "lisa-scratch"))).toEqual([]);
    }
  );

  it("lets the detached reaper drain and clean after supervisor SIGKILL", async () => {
    const run = await startWaitingRun();
    const exited = new Promise<void>(resolve =>
      run.child.once("exit", () => resolve())
    );
    run.child.kill("SIGKILL");
    await exited;
    await waitFor(() => !fs.existsSync(run.root), "detached scratch cleanup");
    await waitFor(() => !alive(run.payloadPid), "payload group drain");
    await waitFor(
      () => run.companionPids.every(pid => !alive(pid)),
      `companion exit (${run.companionPids.map(pid => `${String(pid)}:${String(alive(pid))}`).join(",")})`
    );
    expect(fs.existsSync(run.root)).toBe(false);
  });

  it("cleans before preserving a catchable signal", async () => {
    const run = await startWaitingRun();
    const outcome = new Promise<NodeJS.Signals | null>(resolve =>
      run.child.once("exit", (_code, signal) => resolve(signal))
    );
    run.child.kill("SIGTERM");
    expect(await outcome).toBe("SIGTERM");
    expect(fs.existsSync(run.root)).toBe(false);
    await waitFor(
      () => run.companionPids.every(pid => !alive(pid)),
      "signal-path companion exit"
    );
  });
});
/* eslint-enable code-organization/enforce-statement-order -- end fixture allocation helpers */
