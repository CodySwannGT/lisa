/**
 * Deterministic control for the leaderless-group race after supervisor death.
 *
 * When the foreground supervisor dies, the bootstrap (the target group leader)
 * and the detached reaper both observe the closed channel at once. The reaper
 * may only signal the group while that leader is still present with its armed
 * birth; a live group whose leader is gone is refused outright. If the leader
 * simply exits on channel loss while a payload descendant still occupies its
 * group, whichever process loses that race decides whether the descendant
 * outlives the run. Under load the leader won about one run in three.
 *
 * This case removes the luck: the reaper is held at its recovery entry with
 * the `pause-recovery-before-drain` seam until the leader is observably gone,
 * which is the losing order, and only then resumed.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  isProcessAlive,
  PAYLOAD_MARKER,
  REPO_ROOT,
  temporaryTestRunDirectory,
  TEST_RUN_SOURCE_ARGS,
  testRunCompanionPids,
  waitForTestRun,
} from "../../helpers/lisa-test-run-process.js";

const testRunDirectories: string[] = [];
const registerTestRunDirectory = (directory: string): void => {
  testRunDirectories.push(directory);
};

afterEach(() => {
  for (const directory of testRunDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * Read one process's command line and state without platform-specific flags.
 * @param pid - Process to inspect
 * @returns Trimmed `ps` command and state, empty when the pid is absent
 */
function processView(pid: number): {
  readonly command: string;
  readonly state: string;
} {
  const inspect = (field: "command=" | "stat="): string =>
    boundedSpawnSync({
      label: `process ${field} inventory`,
      command: "/bin/ps",
      args: ["-o", field, "-p", String(pid)],
      baseMs: 2_000,
    }).stdout.trim();
  return { command: inspect("command="), state: inspect("stat=") };
}

/**
 * Split the supervisor's two direct companions by role.
 * @param supervisorPid - Foreground supervisor process id
 * @returns Reaper and bootstrap process ids
 */
function companionRoles(supervisorPid: number): {
  readonly reaper: number;
  readonly bootstrap: number;
} {
  const companions = testRunCompanionPids(supervisorPid);
  const reaper = companions.find(pid =>
    processView(pid).command.includes("lisa-test-run-reaper")
  );
  const bootstrap = companions.find(pid =>
    processView(pid).command.includes("lisa-test-run-bootstrap")
  );
  if (reaper === undefined || bootstrap === undefined) {
    throw new Error(
      `Expected reaper and bootstrap companions, found ${companions.join(",")}`
    );
  }
  return { reaper, bootstrap };
}

describe("lisa-test-run leaderless group recovery", () => {
  it("drains a payload descendant when the leader exits before the reaper drains", async () => {
    const base = temporaryTestRunDirectory(
      "lisa-test-run-leaderless-",
      registerTestRunDirectory
    );
    const marker = path.join(base, PAYLOAD_MARKER);
    const child = spawn(process.execPath, [...TEST_RUN_SOURCE_ARGS], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        TMPDIR: base,
        TMP: base,
        TEMP: base,
        LISA_TEST_RUN_MARKER: marker,
        LISA_TEST_RUN_MODE: "grandchild-pass",
        // Never written: the payload stays alive until something kills it.
        LISA_TEST_RUN_GRANDCHILD_RELEASE: path.join(base, "never-released"),
        LISA_TEST_RUN_TEST_FAULT: "pause-recovery-before-drain",
        LISA_TEST_SCRATCH_SUITE: "lisa",
      },
      stdio: "ignore",
    });
    const supervisorExit = new Promise<void>(resolve =>
      child.once("exit", () => resolve())
    );
    const owned: { descendant?: number; reaper?: number } = {};
    try {
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
      owned.descendant = payload.descendantPid;
      const { reaper, bootstrap } = companionRoles(child.pid ?? -1);
      owned.reaper = reaper;

      child.kill("SIGKILL");
      await supervisorExit;
      // Force the losing order: recovery is parked at its entry, and the leader
      // has already left, before the reaper may look at the group.
      await waitForTestRun(
        () => processView(reaper).state.startsWith("T"),
        "reaper parked before drain"
      );
      await waitForTestRun(
        () => !isProcessAlive(bootstrap),
        "bootstrap leader exit"
      );
      process.kill(reaper, "SIGCONT");

      await waitForTestRun(
        () => !isProcessAlive(payload.descendantPid),
        "payload descendant drain"
      );
      await waitForTestRun(
        () => !fs.existsSync(payload.root),
        "scratch root recovery"
      );
      await waitForTestRun(() => !isProcessAlive(reaper), "reaper exit");
      expect(isProcessAlive(payload.descendantPid)).toBe(false);
      expect(fs.existsSync(payload.root)).toBe(false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      if (owned.descendant !== undefined && isProcessAlive(owned.descendant)) {
        process.kill(owned.descendant, "SIGKILL");
      }
      if (owned.reaper !== undefined && isProcessAlive(owned.reaper)) {
        process.kill(owned.reaper, "SIGCONT");
      }
    }
  });
});
