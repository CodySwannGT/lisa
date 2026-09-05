/** A gate deadline reaps descendants, not only the direct shell. */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../../all/copy-overwrite/scripts/lib/bounded-spawn.mjs";
import {
  killWindowsTree,
  posixTreeExists,
  processGroupHasRunnableMember,
  reapTree,
  supervise,
  windowsTreeExists,
} from "../../../all/copy-overwrite/scripts/lib/process-tree-runner.mjs";
import {
  boundedSpawnSync as boundedTestSpawnSync,
  ioLatencyBudgetMs,
} from "../../helpers/io-latency-budget";

const roots: string[] = [];
const BLOCKING_CHILD_FILENAME = "blocking-child.mjs";
const GRANDCHILD_PID_FILENAME = "grandchild.pid";
const LISTENER_REPORT_FILENAME = "listener-report.json";
const POSIX_AUTHORITY_DENIED_MESSAGE = "synthetic authority denied";
const PROCESS_TREE_RUNNER = path.resolve(
  "all/copy-overwrite/scripts/lib/process-tree-runner.mjs"
);
const LONG_RUNNER_TIMEOUT_ARGUMENT = "--timeout-ms=30000";
/**
 * Enough measured-machine time for the planted Node descendant to start and
 * write its PID before the supervisor deliberately expires. A fixed 100ms
 * raced process startup under the full suite and made the cleanup assertion
 * vacuous by failing before a descendant existed.
 */
const FIXTURE_RUNNER_TIMEOUT_ARGUMENT = `--timeout-ms=${String(
  ioLatencyBudgetMs(500)
)}`;

interface ProcessObservation {
  readonly state: string;
  readonly identity: string;
}

/** Read one stable POSIX process identity, excluding absent and zombie PIDs. */
const readProcessObservation = (
  pid: number
): ProcessObservation | undefined => {
  try {
    process.kill(pid, 0);
  } catch {
    return undefined;
  }
  const observation = boundedTestSpawnSync({
    command: "ps",
    args: ["-o", "stat=,pgid=,lstart=,command=", "-p", String(pid)],
    label: `identify process ${pid}`,
  }).stdout.trim();
  const [state, ...identity] = observation.split(/\s+/u);
  if (!state || state.startsWith("Z") || identity.length === 0) {
    return undefined;
  }
  return { state, identity: identity.join(" ") };
};

/** Wait for a real-process condition within the measured I/O budget. */
const waitForProcessCondition = async (
  predicate: () => boolean
): Promise<boolean> => {
  const deadline = Date.now() + ioLatencyBudgetMs(2_000);
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return predicate();
};

/** Find every non-zombie process whose command carries one unique test token. */
const findTokenProcesses = (token: string): readonly number[] => {
  const rows = boundedTestSpawnSync({
    command: "ps",
    args: ["-axo", "pid=,stat=,command="],
    label: `find planted process for ${token}`,
  }).stdout.split("\n");
  return rows.flatMap(row => {
    if (!row.includes(token)) return [];
    const match = /^\s*(\d+)\s+(\S+)\s+/u.exec(row);
    if (!match?.[1] || match[2]?.startsWith("Z")) return [];
    return [Number(match[1])];
  });
};

/** Resume and kill only processes carrying an unguessable per-test token. */
const killTokenProcesses = (token: string): void => {
  for (const pid of findTokenProcesses(token)) {
    if (pid === process.pid) continue;
    for (const signal of ["SIGCONT", "SIGKILL"] as const) {
      try {
        process.kill(pid, signal);
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "ESRCH"
        ) {
          throw error;
        }
      }
    }
  }
};

/** Quote one path for the platform shell used by the process-tree runner. */
const shellQuote = (value: string): string =>
  process.platform === "win32"
    ? `"${value.replaceAll('"', '""')}"`
    : `'${value.replaceAll("'", `'"'"'`)}'`;

/**
 * Create a Node descendant that records its own PID before blocking.
 *
 * @param input - Fixture paths and signal behavior.
 * @returns A cross-platform shell command that starts the descendant.
 */
const blockingNodeCommand = (input: {
  root: string;
  pidFile: string;
  ignoreSigterm?: boolean;
}): string => {
  const scriptFile = path.join(input.root, BLOCKING_CHILD_FILENAME);
  const source = [
    `import { writeFileSync } from "node:fs";`,
    `writeFileSync(${JSON.stringify(input.pidFile)}, String(process.pid));`,
    input.ignoreSigterm ? `process.on("SIGTERM", () => {});` : "",
    `setInterval(() => {}, 1_000);`,
  ]
    .filter(Boolean)
    .join("\n");
  writeFileSync(scriptFile, source);
  return `${shellQuote(process.execPath)} ${shellQuote(scriptFile)}`;
};

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
    // ESRCH, not a bare Error. Until #3848 this branch swallowed EVERY throw as
    // "the tree is gone", so an EPERM — a probe that could not ask — read as an
    // absence and left a live tree behind, recorded as reaped. Only the
    // absent-process code proves absence now, exactly as `posixTreeExists` and
    // `killTree` in the same file already required.
    expect(
      windowsTreeExists(43, () => {
        throw Object.assign(new Error("absent"), { code: "ESRCH" });
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

  it("keeps a POSIX group unknown when ps cannot see its row after EPERM", () => {
    const denied = Object.assign(new Error(POSIX_AUTHORITY_DENIED_MESSAGE), {
      code: "EPERM",
    });
    const absent = Object.assign(new Error("synthetic group absent"), {
      code: "ESRCH",
    });
    let probes = 0;

    const inspect = (pid: number): boolean | undefined =>
      processGroupHasRunnableMember(
        pid,
        () =>
          ({
            error: undefined,
            signal: null,
            status: 0,
            stdout: "  41 S\n  43 Z\n",
          }) as never
      );
    const probe = (): void => {
      probes += 1;
      throw probes === 1 ? denied : absent;
    };

    expect(inspect(42)).toBeUndefined();
    expect(posixTreeExists(42, probe, inspect)).toBe(false);
    expect(probes).toBe(2);
  });

  it("fails a POSIX group probe closed when restricted visibility persists", () => {
    const denied = Object.assign(new Error(POSIX_AUTHORITY_DENIED_MESSAGE), {
      code: "EPERM",
    });

    expect(() =>
      posixTreeExists(
        42,
        () => {
          throw denied;
        },
        () => undefined
      )
    ).toThrow(POSIX_AUTHORITY_DENIED_MESSAGE);
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

  it("attempts forced cleanup before reporting uncertain authority", async () => {
    const signals: string[] = [];

    await expect(
      reapTree(42, {
        kill: (_pid: number, signal: string) => {
          signals.push(signal);
          throw new Error(`synthetic ${signal} authority denied`);
        },
        exists: () => {
          throw new Error("synthetic observation authority denied");
        },
        now: Date.now,
        wait: async () => {},
      })
    ).rejects.toThrow("synthetic SIGKILL authority denied");
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
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
      const before = new Map(
        ["SIGINT", "SIGTERM", "SIGHUP"].map(signal => [
          signal,
          process.listenerCount(signal),
        ])
      );
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
      for (const [signal, count] of before) {
        expect(process.listenerCount(signal)).toBe(count);
      }
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

  it("cleans pre-armed handlers when spawn throws before the deadline exists", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-spawn-throw-"));
    roots.push(root);
    const preloadFile = path.join(root, "throwing-spawn.mjs");
    const listenerReport = path.join(root, LISTENER_REPORT_FILENAME);
    writeFileSync(
      preloadFile,
      `import childProcess from "node:child_process";
import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
const baseline = Object.fromEntries(signals.map(signal => [signal, process.listenerCount(signal)]));
process.on("exit", () => {
  writeFileSync(${JSON.stringify(listenerReport)}, JSON.stringify({
    signalDeltas: Object.fromEntries(signals.map(signal => [signal, process.listenerCount(signal) - baseline[signal]])),
  }));
});
childProcess.spawn = () => {
  throw new Error("synthetic synchronous spawn failure");
};
syncBuiltinESMExports();
`
    );

    const result = boundedSpawnSync(
      process.execPath,
      [
        "--import",
        preloadFile,
        PROCESS_TREE_RUNNER,
        LONG_RUNNER_TIMEOUT_ARGUMENT,
        "--",
        ":",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: ioLatencyBudgetMs(5_000),
      }
    );

    expect(result.status).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stderr).toContain("synthetic synchronous spawn failure");
    expect(result.stderr).not.toContain("Cannot access 'deadline'");
    expect(JSON.parse(readFileSync(listenerReport, "utf8"))).toEqual({
      signalDeltas: { SIGINT: 0, SIGTERM: 0, SIGHUP: 0 },
    });
  });

  it("routes a late spawn error when no child PID was assigned", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-spawn-error-"));
    roots.push(root);
    const preloadFile = path.join(root, "missing-pid-spawn.mjs");
    const listenerReport = path.join(root, LISTENER_REPORT_FILENAME);
    writeFileSync(
      preloadFile,
      `import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
const baseline = Object.fromEntries(signals.map(signal => [signal, process.listenerCount(signal)]));
childProcess.spawn = () => {
  const child = new EventEmitter();
  child.pid = undefined;
  queueMicrotask(() => {
    const atError = child.listenerCount("error");
    child.emit("error", new Error("synthetic late spawn error"));
    writeFileSync(${JSON.stringify(listenerReport)}, JSON.stringify({
      atError,
      afterError: child.listenerCount("error"),
      signalDeltas: Object.fromEntries(signals.map(signal => [signal, process.listenerCount(signal) - baseline[signal]])),
    }));
  });
  return child;
};
syncBuiltinESMExports();
`
    );

    const result = boundedSpawnSync(
      process.execPath,
      [
        "--import",
        preloadFile,
        PROCESS_TREE_RUNNER,
        LONG_RUNNER_TIMEOUT_ARGUMENT,
        "--",
        ":",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: ioLatencyBudgetMs(5_000),
      }
    );

    expect(result.status).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stderr).toContain(
      "gate process tree did not start: synthetic late spawn error"
    );
    expect(result.stderr).not.toContain("Unhandled 'error' event");
    expect(JSON.parse(readFileSync(listenerReport, "utf8"))).toEqual({
      atError: 1,
      afterError: 0,
      signalDeltas: { SIGINT: 0, SIGTERM: 0, SIGHUP: 0 },
    });
  });

  it("kills a background grandchild before the supervisor returns", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-tree-"));
    roots.push(root);
    const pidFile = path.join(root, GRANDCHILD_PID_FILENAME);
    const command = blockingNodeCommand({ root, pidFile });

    const result = boundedSpawnSync(
      process.execPath,
      [PROCESS_TREE_RUNNER, FIXTURE_RUNNER_TIMEOUT_ARGUMENT, "--", command],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: ioLatencyBudgetMs(5_000),
      }
    );

    expect(result.status).toBeNull();
    expect(result.signal).toBe("SIGKILL");
    const grandchild = Number(readFileSync(pidFile, "utf8").trim());
    expect(grandchild).toBeGreaterThan(0);
    // A PID can be reused between the supervisor exit and this assertion when
    // the full suite is creating hundreds of processes. Prove the planted
    // descendant is gone by its unguessable fixture path, not by whichever
    // process happens to own the same integer now.
    expect(
      findTokenProcesses(path.join(root, BLOCKING_CHILD_FILENAME))
    ).toEqual([]);
  });

  it("waits for a SIGKILL-reaped descendant that ignores SIGTERM", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-kill-wait-"));
    roots.push(root);
    const pidFile = path.join(root, GRANDCHILD_PID_FILENAME);
    const command = blockingNodeCommand({
      root,
      pidFile,
      ignoreSigterm: true,
    });

    const result = boundedSpawnSync(
      process.execPath,
      [PROCESS_TREE_RUNNER, FIXTURE_RUNNER_TIMEOUT_ARGUMENT, "--", command],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: ioLatencyBudgetMs(5_000),
      }
    );

    expect(result.status).toBeNull();
    expect(result.signal).toBe("SIGKILL");
    const grandchild = Number(readFileSync(pidFile, "utf8").trim());
    expect(grandchild).toBeGreaterThan(0);
    expect(
      findTokenProcesses(path.join(root, BLOCKING_CHILD_FILENAME))
    ).toEqual([]);
  });

  it("reaps a detached grandchild before relaying SIGTERM", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-signal-"));
    roots.push(root);
    const pidFile = path.join(root, GRANDCHILD_PID_FILENAME);
    const command = blockingNodeCommand({ root, pidFile });
    const supervisor = spawn(
      process.execPath,
      [PROCESS_TREE_RUNNER, LONG_RUNNER_TIMEOUT_ARGUMENT, "--", command],
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

  it("keeps signal handlers installed while an unresponsive tree is reaped", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-double-signal-"));
    roots.push(root);
    const pidFile = path.join(root, GRANDCHILD_PID_FILENAME);
    const command = blockingNodeCommand({
      root,
      pidFile,
      ignoreSigterm: true,
    });
    const supervisor = spawn(
      process.execPath,
      [PROCESS_TREE_RUNNER, LONG_RUNNER_TIMEOUT_ARGUMENT, "--", command],
      { stdio: "ignore" }
    );

    const started = Date.now();
    while (!existsSync(pidFile) && Date.now() - started < 2_000) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(existsSync(pidFile)).toBe(true);
    const grandchild = Number(readFileSync(pidFile, "utf8").trim());
    const closed = new Promise<{
      code: number | null;
      signal: string | null;
    }>(resolve =>
      supervisor.once("close", (code, signal) => resolve({ code, signal }))
    );
    supervisor.kill("SIGTERM");
    await new Promise(resolve => setTimeout(resolve, 100));
    supervisor.kill("SIGTERM");
    const result = await closed;

    expect(result).toEqual({ code: null, signal: "SIGTERM" });
    expect(processIsRunnable(grandchild)).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "arms signal cleanup before a detached child can stop the supervisor",
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-signal-race-"));
      roots.push(root);
      const pidFile = path.join(root, GRANDCHILD_PID_FILENAME);
      const identityToken = path.join(root, "planted-grandchild");
      const preloadFile = path.join(root, "stop-after-spawn.mjs");
      writeFileSync(
        preloadFile,
        `import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const spawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = spawn(...args);
  process.emit("SIGTERM");
  process.emit("SIGINT");
  process.kill(process.pid, "SIGSTOP");
  return child;
};
syncBuiltinESMExports();
`
      );
      const keepAlive = "setInterval(() => {}, 1000);";
      const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
        keepAlive
      )} ${JSON.stringify(identityToken)} & echo $! > ${JSON.stringify(
        pidFile
      )}; wait`;
      const supervisor = spawn(
        process.execPath,
        [
          "--import",
          preloadFile,
          PROCESS_TREE_RUNNER,
          LONG_RUNNER_TIMEOUT_ARGUMENT,
          "--",
          command,
        ],
        { stdio: "ignore" }
      );
      let supervisorIdentity: string | undefined;
      let grandchild: number | undefined;
      let grandchildIdentity: string | undefined;

      try {
        supervisorIdentity = readProcessObservation(
          supervisor.pid ?? -1
        )?.identity;
        expect(await waitForProcessCondition(() => existsSync(pidFile))).toBe(
          true
        );
        grandchild = Number(readFileSync(pidFile, "utf8").trim());
        grandchildIdentity = readProcessObservation(grandchild)?.identity;
        expect(grandchildIdentity).toContain(identityToken);
        expect(
          await waitForProcessCondition(
            () =>
              readProcessObservation(supervisor.pid ?? -1)?.state.startsWith(
                "T"
              ) ?? false
          )
        ).toBe(true);
        expect(
          supervisorIdentity ??
            readProcessObservation(supervisor.pid ?? -1)?.identity
        ).toContain(preloadFile);

        const completion = new Promise<{
          code: number | null;
          signal: string | null;
        }>(resolve =>
          supervisor.once("exit", (code, signal) => resolve({ code, signal }))
        );
        expect(supervisor.kill("SIGTERM")).toBe(true);
        expect(supervisor.kill("SIGCONT")).toBe(true);
        expect(await completion).toEqual({ code: null, signal: "SIGTERM" });
        expect(readProcessObservation(grandchild)?.identity).not.toBe(
          grandchildIdentity
        );
      } finally {
        killTokenProcesses(identityToken);
        killTokenProcesses(preloadFile);
      }
    }
  );

  it.skipIf(process.platform === "win32")(
    "fails closed when process-group cleanup authority is uncertain",
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-reap-denied-"));
      roots.push(root);
      const pidFile = path.join(root, GRANDCHILD_PID_FILENAME);
      const handlersReadyFile = path.join(root, "handlers-ready");
      const listenerReport = path.join(root, LISTENER_REPORT_FILENAME);
      const identityToken = path.join(root, "planted-uncertain-grandchild");
      const preloadFile = path.join(root, "deny-group-authority.mjs");
      writeFileSync(
        preloadFile,
        `import { writeFileSync } from "node:fs";
const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
const baseline = Object.fromEntries(signals.map(signal => [signal, process.listenerCount(signal)]));
const kill = process.kill.bind(process);
const on = process.on.bind(process);
const armed = new Set();
on("exit", () => {
  writeFileSync(${JSON.stringify(listenerReport)}, JSON.stringify({
    signalDeltas: Object.fromEntries(signals.map(signal => [signal, process.listenerCount(signal) - baseline[signal]])),
  }));
});
process.kill = (pid, signal) => {
  if (pid < 0) {
    const error = new Error("synthetic group authority denied");
    error.code = "EPERM";
    throw error;
  }
  return kill(pid, signal);
};
process.on = (event, listener) => {
  const result = on(event, listener);
  if (signals.includes(event)) armed.add(event);
  if (armed.size === 3) writeFileSync(${JSON.stringify(
    handlersReadyFile
  )}, "ready");
  return result;
};
`
      );
      const keepAlive = "setInterval(() => {}, 1000);";
      const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
        keepAlive
      )} ${JSON.stringify(identityToken)} & echo $! > ${JSON.stringify(
        pidFile
      )}; wait`;
      const supervisor = spawn(
        process.execPath,
        [
          "--import",
          preloadFile,
          PROCESS_TREE_RUNNER,
          LONG_RUNNER_TIMEOUT_ARGUMENT,
          "--",
          command,
        ],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
      let supervisorIdentity: string | undefined;
      let stderr = "";
      supervisor.stderr?.on("data", chunk => {
        stderr += String(chunk);
      });
      let grandchild: number | undefined;
      let grandchildIdentity: string | undefined;

      try {
        supervisorIdentity = readProcessObservation(
          supervisor.pid ?? -1
        )?.identity;
        expect(
          await waitForProcessCondition(
            () => existsSync(pidFile) && existsSync(handlersReadyFile)
          )
        ).toBe(true);
        grandchild = Number(readFileSync(pidFile, "utf8").trim());
        grandchildIdentity = readProcessObservation(grandchild)?.identity;
        expect(grandchildIdentity).toContain(identityToken);
        expect(
          supervisorIdentity ??
            readProcessObservation(supervisor.pid ?? -1)?.identity
        ).toContain(preloadFile);

        const completion = new Promise<{
          code: number | null;
          signal: string | null;
        }>(resolve =>
          supervisor.once("exit", (code, signal) => resolve({ code, signal }))
        );
        expect(supervisor.kill("SIGTERM")).toBe(true);
        const boundedCompletion = await Promise.race([
          completion,
          new Promise<{ code: null; signal: "TEST_TIMEOUT" }>(resolve =>
            setTimeout(
              () => resolve({ code: null, signal: "TEST_TIMEOUT" }),
              ioLatencyBudgetMs(2_000)
            )
          ),
        ]);
        expect(boundedCompletion).toEqual({ code: 1, signal: null });
        expect(
          await waitForProcessCondition(() =>
            stderr.includes("gate process-tree supervisor failed")
          )
        ).toBe(true);
        expect(stderr).toContain("gate process-tree supervisor failed:");
        expect(stderr).toContain("synthetic group authority denied");
        expect(stderr).not.toContain("received SIGTERM");
        expect(readProcessObservation(grandchild)?.identity).toBe(
          grandchildIdentity
        );
        expect(JSON.parse(readFileSync(listenerReport, "utf8"))).toEqual({
          signalDeltas: { SIGINT: 0, SIGTERM: 0, SIGHUP: 0 },
        });
      } finally {
        killTokenProcesses(identityToken);
        killTokenProcesses(preloadFile);
      }
    }
  );

  it.skipIf(process.platform === "win32")(
    "keeps an identical second signal caught until reaping settles",
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-double-signal-"));
      roots.push(root);
      const pidFile = path.join(root, GRANDCHILD_PID_FILENAME);
      const childReadyFile = path.join(root, "child-ready");
      const reapStartedFile = path.join(root, "reap-started");
      const identityToken = path.join(root, "planted-double-signal-child");
      const preloadFile = path.join(root, "observe-reap-start.mjs");
      writeFileSync(
        preloadFile,
        `import { writeFileSync } from "node:fs";
const kill = process.kill.bind(process);
process.kill = (pid, signal) => {
  if (pid < 0 && signal === "SIGTERM") {
    writeFileSync(${JSON.stringify(reapStartedFile)}, "started");
  }
  return kill(pid, signal);
};
`
      );
      const ignoreTerm = `require("node:fs").writeFileSync(${JSON.stringify(
        childReadyFile
      )}, "ready"); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);`;
      const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
        ignoreTerm
      )} ${JSON.stringify(identityToken)} & echo $! > ${JSON.stringify(
        pidFile
      )}; wait`;
      const supervisor = spawn(
        process.execPath,
        [
          "--import",
          preloadFile,
          PROCESS_TREE_RUNNER,
          LONG_RUNNER_TIMEOUT_ARGUMENT,
          "--",
          command,
        ],
        { stdio: "ignore" }
      );
      let grandchild: number | undefined;
      let grandchildIdentity: string | undefined;

      try {
        expect(
          await waitForProcessCondition(
            () => existsSync(pidFile) && existsSync(childReadyFile)
          )
        ).toBe(true);
        grandchild = Number(readFileSync(pidFile, "utf8").trim());
        grandchildIdentity = readProcessObservation(grandchild)?.identity;
        expect(grandchildIdentity).toContain(identityToken);

        const completion = new Promise<{
          code: number | null;
          signal: string | null;
        }>(resolve =>
          supervisor.once("exit", (code, signal) => resolve({ code, signal }))
        );
        expect(supervisor.kill("SIGTERM")).toBe(true);
        expect(
          await waitForProcessCondition(() => existsSync(reapStartedFile))
        ).toBe(true);
        expect(supervisor.kill("SIGTERM")).toBe(true);
        expect(await completion).toEqual({ code: null, signal: "SIGTERM" });
        expect(readProcessObservation(grandchild)?.identity).not.toBe(
          grandchildIdentity
        );
      } finally {
        killTokenProcesses(identityToken);
        killTokenProcesses(preloadFile);
      }
    }
  );
});
