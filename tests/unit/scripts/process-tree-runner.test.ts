/** A gate deadline reaps descendants, not only the direct shell. */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../../all/copy-overwrite/scripts/lib/bounded-spawn.mjs";
import {
  killWindowsTree,
  reapTree,
  supervise,
  windowsTreeExists,
} from "../../../all/copy-overwrite/scripts/lib/process-tree-runner.mjs";
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
  it("checks a positive Windows PID instead of assuming the tree is gone", () => {
    const probes: Array<[number, number]> = [];

    expect(
      windowsTreeExists(42, (pid: number, signal: number) => {
        probes.push([pid, signal]);
      })
    ).toBe(true);
    expect(probes).toEqual([[42, 0]]);
    expect(
      windowsTreeExists(43, () => {
        throw new Error("absent");
      })
    ).toBe(false);
  });

  it("surfaces a failed forced taskkill while the Windows root is alive", () => {
    const invocations: string[][] = [];

    expect(() =>
      killWindowsTree(
        42,
        "SIGKILL",
        (_command: string, args: readonly string[]) => {
          invocations.push([...args]);
          return { error: undefined, signal: null, status: 1 } as never;
        },
        () => true
      )
    ).toThrow("taskkill /pid 42 /T /F failed (1)");
    expect(invocations).toEqual([["/pid", "42", "/T", "/F"]]);
  });

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

  it("forces escalation after a graceful native termination failure", async () => {
    let clock = 0;
    const signals: string[] = [];

    await reapTree(42, {
      kill: (_pid: number, signal: string) => {
        signals.push(signal);
        if (signal === "SIGTERM") throw new Error("taskkill failed");
      },
      exists: () => signals.at(-1) !== "SIGKILL",
      now: () => clock,
      wait: async (milliseconds: number) => {
        clock += milliseconds;
      },
    });

    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it.skipIf(process.platform === "win32")(
    "rejects supervision when the timeout reaper fails",
    async () => {
      await expect(
        supervise("sleep 30", 20, async (pid: number) => {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            // The group may have exited between the timeout and the test reap.
          }
          throw new Error("forced reap failed");
        })
      ).rejects.toThrow("forced reap failed");
    }
  );

  it.skipIf(process.platform === "win32")(
    "keeps termination handlers active until close-time reaping settles",
    async () => {
      const before = new Map(
        ["SIGINT", "SIGTERM", "SIGHUP"].map(signal => [
          signal,
          process.listenerCount(signal),
        ])
      );
      let markStarted = () => {};
      let releaseReap = () => {};
      const started = new Promise<void>(resolve => {
        markStarted = resolve;
      });
      const pendingReap = new Promise<void>(resolve => {
        releaseReap = resolve;
      });
      const supervised = supervise(":", 5_000, async () => {
        markStarted();
        await pendingReap;
      });

      await started;
      for (const [signal, count] of before) {
        expect(process.listenerCount(signal)).toBe(count + 1);
      }
      releaseReap();
      await supervised;
      for (const [signal, count] of before) {
        expect(process.listenerCount(signal)).toBe(count);
      }
    }
  );

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
