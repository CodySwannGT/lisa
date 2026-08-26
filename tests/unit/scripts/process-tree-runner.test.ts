/** A gate deadline reaps descendants, not only the direct shell. */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../../all/copy-overwrite/scripts/lib/bounded-spawn.mjs";
import { reapTree } from "../../../all/copy-overwrite/scripts/lib/process-tree-runner.mjs";
import { boundedSpawnSync as boundedTestSpawnSync } from "../../helpers/io-latency-budget";

const roots: string[] = [];
const GRANDCHILD_PID_FILENAME = "grandchild.pid";
const PROCESS_TREE_RUNNER = path.resolve(
  "all/copy-overwrite/scripts/lib/process-tree-runner.mjs"
);

/** Whether a PID can still execute, treating a reparented zombie as stopped. */
const processIsRunnable = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform === "win32") return true;
  const state = boundedTestSpawnSync({
    command: "ps",
    args: ["-o", "stat=", "-p", String(pid)],
    label: `inspect process ${pid}`,
  }).stdout.trim();
  return state.length > 0 && !state.startsWith("Z");
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("process-tree gate deadline", () => {
  it("polls again after escalating an unresponsive tree to SIGKILL", async () => {
    let clock = 0;
    let phase = "";
    let postKillChecks = 0;
    const signals: string[] = [];

    await reapTree(42, {
      kill: (_pid: number, signal: string) => {
        phase = signal;
        signals.push(signal);
      },
      exists: () => {
        if (phase === "SIGTERM") return true;
        postKillChecks += 1;
        return postKillChecks === 1;
      },
      now: () => clock,
      wait: async (milliseconds: number) => {
        clock += milliseconds;
      },
    });

    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(postKillChecks).toBe(2);
  });

  it("reports a supervisor failure when a tree survives SIGKILL", async () => {
    let clock = 0;

    await expect(
      reapTree(42, {
        kill: () => {},
        exists: () => true,
        now: () => clock,
        wait: async (milliseconds: number) => {
          clock += milliseconds;
        },
      })
    ).rejects.toThrow("survived SIGKILL");
  });

  it("kills a background grandchild before the supervisor returns", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-tree-"));
    roots.push(root);
    const pidFile = path.join(root, GRANDCHILD_PID_FILENAME);
    const command = `(sleep 30) & echo $! > ${JSON.stringify(pidFile)}; wait`;

    const result = boundedSpawnSync(
      process.execPath,
      [PROCESS_TREE_RUNNER, "--timeout-ms=100", "--", command],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5_000 }
    );

    expect(result.status).toBeNull();
    expect(result.signal).toBe("SIGKILL");
    const grandchild = Number(readFileSync(pidFile, "utf8").trim());
    expect(processIsRunnable(grandchild)).toBe(false);
  });

  it("waits for a SIGKILL-reaped descendant that ignores SIGTERM", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-kill-wait-"));
    roots.push(root);
    const pidFile = path.join(root, GRANDCHILD_PID_FILENAME);
    const ignoreTerm =
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
    const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
      ignoreTerm
    )} & echo $! > ${JSON.stringify(pidFile)}; wait`;

    const result = boundedSpawnSync(
      process.execPath,
      [PROCESS_TREE_RUNNER, "--timeout-ms=100", "--", command],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5_000 }
    );

    expect(result.status).toBeNull();
    expect(result.signal).toBe("SIGKILL");
    const grandchild = Number(readFileSync(pidFile, "utf8").trim());
    expect(processIsRunnable(grandchild)).toBe(false);
  });

  it("reaps a detached grandchild before relaying SIGTERM", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-signal-"));
    roots.push(root);
    const pidFile = path.join(root, GRANDCHILD_PID_FILENAME);
    const command = `(sleep 30) & echo $! > ${JSON.stringify(pidFile)}; wait`;
    const supervisor = spawn(
      process.execPath,
      [PROCESS_TREE_RUNNER, "--timeout-ms=30000", "--", command],
      { stdio: "ignore" }
    );

    const started = Date.now();
    while (!existsSync(pidFile) && Date.now() - started < 2_000) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(existsSync(pidFile)).toBe(true);
    const grandchild = Number(readFileSync(pidFile, "utf8").trim());
    supervisor.kill("SIGTERM");
    const result = await new Promise<{
      code: number | null;
      signal: string | null;
    }>(resolve =>
      supervisor.once("close", (code, signal) => resolve({ code, signal }))
    );

    expect(result).toEqual({ code: null, signal: "SIGTERM" });
    expect(processIsRunnable(grandchild)).toBe(false);
  });
});
