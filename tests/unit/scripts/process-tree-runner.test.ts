/** A gate deadline reaps descendants, not only the direct shell. */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
const CAPTURE_DESCRIPTOR_ARGUMENT = "--capture-fd=3";
const DIRECT_ARGUMENT_FLAG = "--direct-argv";
const EMPTY_ARGUMENT_EXECUTABLE = "/usr/bin/true";
const KEEP_ALIVE_SOURCE = "setInterval(() => {}, 1000);";
const ENTRY_MODES = ["linux", "darwin"].includes(process.platform)
  ? [false, true]
  : [false];
/** Both entry modes exercise the same native lifetime and diagnostic machinery. */
const supervisorTail = (command: string, direct: boolean): string[] =>
  direct
    ? [DIRECT_ARGUMENT_FLAG, "--", "/bin/sh", "-c", command]
    : ["--", command];
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

/** The uncertain-cleanup fixture must establish its planted child before signalling. */
const uncertainChildReady = (
  pidFile: string,
  handlersReadyFile: string,
  identityToken: string
): boolean => {
  if (!existsSync(pidFile) || !existsSync(handlersReadyFile)) return false;
  const value = readFileSync(pidFile, "utf8").trim();
  if (!/^[1-9]\d*$/u.test(value)) return false;
  const pid = Number(value);
  return (
    Number.isSafeInteger(pid) &&
    (readProcessObservation(pid)?.identity.includes(identityToken) ?? false)
  );
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
    : `'${value.replaceAll("'", "'\"'\"'")}'`;

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

describe.skipIf(!["linux", "darwin"].includes(process.platform))(
  "literal supervisor arguments",
  () => {
    it("preserves stdin, cwd, environment and every literal without shell expansion", () => {
      const root = mkdtempSync(path.join(tmpdir(), "lisa-direct argv-"));
      roots.push(root);
      const marker = path.join(root, "shell-side-effect");
      const entry = path.join(root, "literal fixture.mjs");
      const executable = path.join(root, "real node with spaces");
      symlinkSync(process.execPath, executable);
      const args = [
        "",
        "a'b",
        "line\nΩ",
        "; exit 17",
        `$(touch ${marker})`,
        `\`touch ${marker}\``,
        "$HOME",
        "--",
        "--capture-fd=9",
        DIRECT_ARGUMENT_FLAG,
      ];
      writeFileSync(
        entry,
        `let input = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => process.stdout.write(JSON.stringify({
  args: process.argv.slice(2), input, cwd: process.cwd(), marker: process.env.LISA_DIRECT_MARKER
})));`
      );
      const result = boundedTestSpawnSync({
        label: "real literal supervisor",
        command: process.execPath,
        args: [
          PROCESS_TREE_RUNNER,
          LONG_RUNNER_TIMEOUT_ARGUMENT,
          DIRECT_ARGUMENT_FLAG,
          "--",
          executable,
          entry,
          ...args,
        ],
        cwd: root,
        input: "literal stdin\nΩ",
        env: { ...process.env, LISA_DIRECT_MARKER: "inherited" },
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        args,
        input: "literal stdin\nΩ",
        cwd: root,
        marker: "inherited",
      });
      expect(existsSync(marker)).toBe(false);
    });

    it("selects direct execution for an empty API array and snapshots before setup", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "lisa-direct-snapshot-"));
      roots.push(root);
      const output = path.join(root, "snapshot.json");
      const args = [
        "-e",
        `require('node:fs').writeFileSync(${JSON.stringify(output)}, 'original')`,
      ];
      await supervise(process.execPath, 5000, undefined, {
        directArgs: args,
        get detect() {
          args[1] = "process.exit(17)";
          return () => null;
        },
      });
      expect(readFileSync(output, "utf8")).toBe("original");
      expect(
        await supervise(EMPTY_ARGUMENT_EXECUTABLE, 5000, undefined, {
          directArgs: [],
        })
      ).toEqual({ code: 0, signal: null });
    });

    it("refuses invalid API vectors and deadlines before installing signal handlers", () => {
      const baseline = ["SIGINT", "SIGTERM", "SIGHUP"].map(signal =>
        process.listenerCount(signal)
      );
      for (const [command, args, timeout] of [
        ["", [], 5000],
        [42, [], 5000],
        [process.execPath, ["\0"], 5000],
        [process.execPath, [42], 5000],
        [process.execPath, null, 5000],
        [process.execPath, Array(512).fill(""), 5000],
        [process.execPath, ["Ω".repeat(32769)], 5000],
        [process.execPath, Array(8).fill("\\".repeat(40000)), 5000],
        [process.execPath, [], 0],
        [process.execPath, [], 1.5],
        [process.execPath, [], 1800001],
      ]) {
        expect(() =>
          Reflect.apply(supervise, undefined, [
            command,
            timeout,
            undefined,
            { directArgs: args },
          ])
        ).toThrow();
        expect(
          ["SIGINT", "SIGTERM", "SIGHUP"].map(signal =>
            process.listenerCount(signal)
          )
        ).toEqual(baseline);
      }
    });

    it.each([
      [DIRECT_ARGUMENT_FLAG],
      [LONG_RUNNER_TIMEOUT_ARGUMENT, DIRECT_ARGUMENT_FLAG, "--"],
      [LONG_RUNNER_TIMEOUT_ARGUMENT, DIRECT_ARGUMENT_FLAG, "--", ""],
      [
        LONG_RUNNER_TIMEOUT_ARGUMENT,
        DIRECT_ARGUMENT_FLAG,
        DIRECT_ARGUMENT_FLAG,
        "--",
        EMPTY_ARGUMENT_EXECUTABLE,
      ],
      [
        LONG_RUNNER_TIMEOUT_ARGUMENT,
        "--timeout-ms=1",
        DIRECT_ARGUMENT_FLAG,
        "--",
        EMPTY_ARGUMENT_EXECUTABLE,
      ],
      [
        "--timeout-ms=1.5",
        DIRECT_ARGUMENT_FLAG,
        "--",
        EMPTY_ARGUMENT_EXECUTABLE,
      ],
      [
        "--timeout-ms=1800001",
        DIRECT_ARGUMENT_FLAG,
        "--",
        EMPTY_ARGUMENT_EXECUTABLE,
      ],
      [
        LONG_RUNNER_TIMEOUT_ARGUMENT,
        "--watch-pid=1",
        DIRECT_ARGUMENT_FLAG,
        "--",
        EMPTY_ARGUMENT_EXECUTABLE,
      ],
      [
        LONG_RUNNER_TIMEOUT_ARGUMENT,
        "--watch-pid=2.5",
        DIRECT_ARGUMENT_FLAG,
        "--",
        EMPTY_ARGUMENT_EXECUTABLE,
      ],
      [
        LONG_RUNNER_TIMEOUT_ARGUMENT,
        "--unknown",
        DIRECT_ARGUMENT_FLAG,
        "--",
        EMPTY_ARGUMENT_EXECUTABLE,
      ],
      [
        LONG_RUNNER_TIMEOUT_ARGUMENT,
        CAPTURE_DESCRIPTOR_ARGUMENT,
        CAPTURE_DESCRIPTOR_ARGUMENT,
        DIRECT_ARGUMENT_FLAG,
        "--",
        EMPTY_ARGUMENT_EXECUTABLE,
      ],
      [
        LONG_RUNNER_TIMEOUT_ARGUMENT,
        "--capture-fd=9",
        DIRECT_ARGUMENT_FLAG,
        "--",
        EMPTY_ARGUMENT_EXECUTABLE,
      ],
      [
        LONG_RUNNER_TIMEOUT_ARGUMENT,
        DIRECT_ARGUMENT_FLAG,
        "--",
        EMPTY_ARGUMENT_EXECUTABLE,
        ...Array(509).fill(""),
      ],
    ])("rejects a closed-prefix or complete-vector violation %#", (...args) => {
      const result = boundedTestSpawnSync({
        label: "direct prefix refusal",
        command: process.execPath,
        args: [PROCESS_TREE_RUNNER, ...args],
      });
      expect(result.status).toBe(1);
      expect(result.signal).toBeNull();
    });

    it("routes a genuine ENOENT without leaking prearmed handlers", async () => {
      const baseline = ["SIGINT", "SIGTERM", "SIGHUP"].map(signal =>
        process.listenerCount(signal)
      );
      await expect(
        supervise("/no-such-lisa-direct-executable", 5000, undefined, {
          directArgs: [],
        })
      ).rejects.toThrow("did not start");
      expect(
        ["SIGINT", "SIGTERM", "SIGHUP"].map(signal =>
          process.listenerCount(signal)
        )
      ).toEqual(baseline);
    });

    it("counts the actual outer preload and entry at the exact CLI boundary", () => {
      const root = mkdtempSync(path.join(tmpdir(), "lisa-direct-final-bound-"));
      roots.push(root);
      const entry = path.join(root, "child.cjs");
      const preload = path.join(root, "passive-preload.mjs");
      const permitted = path.join(root, "permitted");
      const refused = path.join(root, "refused");
      writeFileSync(
        entry,
        "require('node:fs').writeFileSync(process.argv[2], 'launched');"
      );
      writeFileSync(preload, "export const passive = true;");
      const invocation = (marker: string): string[] => [
        PROCESS_TREE_RUNNER,
        LONG_RUNNER_TIMEOUT_ARGUMENT,
        DIRECT_ARGUMENT_FLAG,
        "--",
        process.execPath,
        entry,
        marker,
        ...Array<string>(505).fill(""),
      ];
      expect(invocation(permitted)).toHaveLength(512);
      const positive = boundedTestSpawnSync({
        label: "complete direct vector boundary",
        command: process.execPath,
        args: invocation(permitted),
      });
      expect(positive.status).toBe(0);
      expect(readFileSync(permitted, "utf8")).toBe("launched");
      const negative = boundedTestSpawnSync({
        label: "actual preload overhead refusal",
        command: process.execPath,
        args: ["--import", preload, ...invocation(refused)],
      });
      expect(negative.status).toBe(1);
      expect(negative.stderr).toContain("unbounded direct argument vector");
      expect(existsSync(refused)).toBe(false);
    });
  }
);

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

  it.each(ENTRY_MODES)(
    "cleans pre-armed handlers when spawn throws (direct %s)",
    direct => {
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
          ...supervisorTail(":", direct),
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
    }
  );

  it.each(ENTRY_MODES)(
    "routes a late spawn error without a PID (direct %s)",
    direct => {
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
          ...supervisorTail(":", direct),
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
    }
  );

  it.each(ENTRY_MODES)(
    "kills a grandchild before returning (direct %s)",
    direct => {
      const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-tree-"));
      roots.push(root);
      const pidFile = path.join(root, GRANDCHILD_PID_FILENAME);
      const command = blockingNodeCommand({ root, pidFile });

      const result = boundedSpawnSync(
        process.execPath,
        [
          PROCESS_TREE_RUNNER,
          FIXTURE_RUNNER_TIMEOUT_ARGUMENT,
          ...supervisorTail(command, direct),
        ],
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
    }
  );

  it.each(ENTRY_MODES)(
    "waits for a TERM-ignoring descendant (direct %s)",
    direct => {
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
        [
          PROCESS_TREE_RUNNER,
          FIXTURE_RUNNER_TIMEOUT_ARGUMENT,
          ...supervisorTail(command, direct),
        ],
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
    }
  );

  it.each(ENTRY_MODES)(
    "reaps a grandchild before relaying SIGTERM (direct %s)",
    async direct => {
      const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-signal-"));
      roots.push(root);
      const pidFile = path.join(root, GRANDCHILD_PID_FILENAME);
      const command = blockingNodeCommand({ root, pidFile });
      const supervisor = spawn(
        process.execPath,
        [
          PROCESS_TREE_RUNNER,
          LONG_RUNNER_TIMEOUT_ARGUMENT,
          ...supervisorTail(command, direct),
        ],
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
    }
  );

  it.each(ENTRY_MODES)(
    "keeps signal handlers through reaping (direct %s)",
    async direct => {
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
        [
          PROCESS_TREE_RUNNER,
          LONG_RUNNER_TIMEOUT_ARGUMENT,
          ...supervisorTail(command, direct),
        ],
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
    }
  );

  it.skipIf(process.platform === "win32").each(ENTRY_MODES)(
    "arms signal cleanup before the child can stop its supervisor (direct %s)",
    async direct => {
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
      const keepAlive = KEEP_ALIVE_SOURCE;
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
          ...supervisorTail(command, direct),
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
    "does not mistake an empty native PID redirection for a ready child",
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-empty-pid-"));
      roots.push(root);
      const pidFile = path.join(root, GRANDCHILD_PID_FILENAME);
      const readyFile = path.join(root, "handlers-ready");
      const token = path.join(root, "planted-empty-pid-child");
      const command = `echo() { printf opened >&2; IFS= read -r release; command echo "$@"; }; ${shellQuote(process.execPath)} -e ${shellQuote(KEEP_ALIVE_SOURCE)} ${shellQuote(token)} & echo $! > ${shellQuote(pidFile)}; wait`;
      const shell = spawn("/bin/sh", ["-c", command], {
        detached: true,
        stdio: ["pipe", "ignore", "pipe"],
      });
      const closed = new Promise(resolve => shell.once("close", resolve));
      let diagnostic = "";
      shell.stderr.on("data", chunk => {
        diagnostic += String(chunk);
      });
      try {
        writeFileSync(readyFile, "ready");
        expect(
          await waitForProcessCondition(() => diagnostic.includes("opened"))
        ).toBe(true);
        expect(existsSync(pidFile)).toBe(true);
        expect(readFileSync(pidFile, "utf8").trim()).toBe("");
        expect(uncertainChildReady(pidFile, readyFile, token)).toBe(false);
        shell.stdin.write("continue\n");
        expect(
          await waitForProcessCondition(() =>
            uncertainChildReady(pidFile, readyFile, token)
          )
        ).toBe(true);
        expect(
          readProcessObservation(Number(readFileSync(pidFile, "utf8").trim()))
            ?.identity
        ).toContain(token);
      } finally {
        killTokenProcesses(token);
        await closed;
        expect(findTokenProcesses(token)).toEqual([]);
      }
    }
  );

  it.skipIf(process.platform === "win32").each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "fails closed for uncertain cleanup (capture %s, direct %s)",
    async (capture, direct) => {
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
      const keepAlive = KEEP_ALIVE_SOURCE;
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
          ...(capture ? [CAPTURE_DESCRIPTOR_ARGUMENT] : []),
          ...supervisorTail(command, direct),
        ],
        { stdio: ["ignore", "ignore", "pipe", "ignore"] }
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
          await waitForProcessCondition(() =>
            uncertainChildReady(pidFile, handlersReadyFile, identityToken)
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

  it.skipIf(process.platform === "win32").each(ENTRY_MODES)(
    "keeps an identical second signal caught through reaping (direct %s)",
    async direct => {
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
          ...supervisorTail(command, direct),
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

describe.skipIf(process.platform === "win32")(
  "supervisor diagnostic capture",
  () => {
    it.each(ENTRY_MODES)(
      "retains bounded tail and real exit 17 (direct %s)",
      direct => {
        const source =
          'process.stdout.write("a".repeat(700000) + "TAIL"); process.exitCode = 17;';
        const result = boundedSpawnSync(
          process.execPath,
          [
            PROCESS_TREE_RUNNER,
            LONG_RUNNER_TIMEOUT_ARGUMENT,
            CAPTURE_DESCRIPTOR_ARGUMENT,
            ...(direct
              ? [DIRECT_ARGUMENT_FLAG, "--", process.execPath, "-e", source]
              : [
                  "--",
                  `${shellQuote(process.execPath)} -e ${shellQuote(source)}`,
                ]),
          ],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe", "pipe"],
            maxBuffer: 2 * 1024 * 1024,
            timeout: ioLatencyBudgetMs(5_000),
          }
        );
        expect(result.status).toBe(17);
        expect(result.stdout).toHaveLength(700004);
        expect(result.output[3]).toHaveLength(512 * 1024);
        expect(String(result.output[3])).toMatch(/TAIL$/u);
      }
    );

    it.each(ENTRY_MODES)(
      "streams before command termination (direct %s)",
      async direct => {
        const source =
          'process.stdout.write("STREAM-READY\\n"); setTimeout(() => process.exit(17), 700);';
        const child = spawn(
          process.execPath,
          [
            PROCESS_TREE_RUNNER,
            LONG_RUNNER_TIMEOUT_ARGUMENT,
            CAPTURE_DESCRIPTOR_ARGUMENT,
            ...(direct
              ? [DIRECT_ARGUMENT_FLAG, "--", process.execPath, "-e", source]
              : [
                  "--",
                  `${shellQuote(process.execPath)} -e ${shellQuote(source)}`,
                ]),
          ],
          { stdio: ["ignore", "pipe", "pipe", "pipe"] }
        );
        let streamed = "";
        let ended = false;
        child.stdout?.on("data", chunk => {
          streamed += String(chunk);
        });
        child.stdio[3]?.on("data", () => {});
        const completion = new Promise<{
          code: number | null;
          signal: string | null;
        }>(resolve => {
          child.once("close", (code, signal) => {
            ended = true;
            resolve({ code, signal });
          });
        });
        try {
          expect(
            await waitForProcessCondition(() =>
              streamed.includes("STREAM-READY")
            )
          ).toBe(true);
          expect(ended).toBe(false);
          expect(await completion).toEqual({ code: 17, signal: null });
        } finally {
          if (!ended) child.kill("SIGTERM");
          await completion;
        }
      }
    );

    it.each(ENTRY_MODES)(
      "retains no-verdict identity after capture deadline (direct %s)",
      direct => {
        const result = boundedSpawnSync(
          process.execPath,
          [
            PROCESS_TREE_RUNNER,
            FIXTURE_RUNNER_TIMEOUT_ARGUMENT,
            CAPTURE_DESCRIPTOR_ARGUMENT,
            ...supervisorTail("printf 'TIMEOUT-READY\\n'; sleep 30", direct),
          ],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe", "pipe"],
            timeout: ioLatencyBudgetMs(5_000),
          }
        );
        expect(result.status).toBeNull();
        expect(result.signal).toBe("SIGKILL");
        expect(String(result.output[3])).toContain("TIMEOUT-READY");
      }
    );

    it.each(ENTRY_MODES)(
      "keeps exit 17 with unavailable descriptor (direct %s)",
      direct => {
        const root = mkdtempSync(
          path.join(tmpdir(), "lisa-gate-capture-fault-")
        );
        roots.push(root);
        const attempts = path.join(root, "attempts");
        const result = boundedSpawnSync(
          process.execPath,
          [
            PROCESS_TREE_RUNNER,
            LONG_RUNNER_TIMEOUT_ARGUMENT,
            CAPTURE_DESCRIPTOR_ARGUMENT,
            ...supervisorTail(
              `printf 'once\\n' >> ${shellQuote(attempts)}; printf 'diagnostic'; exit 17`,
              direct
            ),
          ],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: ioLatencyBudgetMs(5_000),
          }
        );
        expect(result.status).toBe(17);
        expect(result.stderr).toContain("OS verdict retained");
        expect(readFileSync(attempts, "utf8")).toBe("once\n");
      }
    );

    it.each(ENTRY_MODES)(
      "fails boundedly without output close (direct %s)",
      direct => {
        const root = mkdtempSync(
          path.join(tmpdir(), "lisa-gate-capture-drain-")
        );
        roots.push(root);
        const preloadFile = path.join(root, "missing-close-notification.mjs");
        writeFileSync(
          preloadFile,
          `import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const spawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = spawn(...args);
  const once = child.once.bind(child);
  child.once = (event, listener) => event === "close" ? child : once(event, listener);
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
            CAPTURE_DESCRIPTOR_ARGUMENT,
            ...supervisorTail("printf 'drain-control'; exit 17", direct),
          ],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe", "pipe"],
            timeout: ioLatencyBudgetMs(5_000),
          }
        );
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("diagnostic output did not close");
      }
    );

    it.each(ENTRY_MODES)(
      "reaps pipe-holding descendants before returning (direct %s)",
      direct => {
        const root = mkdtempSync(
          path.join(tmpdir(), "lisa-gate-capture-pipe-")
        );
        roots.push(root);
        const pidFile = path.join(root, GRANDCHILD_PID_FILENAME);
        const command = blockingNodeCommand({ root, pidFile });
        const result = boundedSpawnSync(
          process.execPath,
          [
            PROCESS_TREE_RUNNER,
            FIXTURE_RUNNER_TIMEOUT_ARGUMENT,
            CAPTURE_DESCRIPTOR_ARGUMENT,
            ...supervisorTail(
              `${command} & while test ! -f ${shellQuote(pidFile)}; do sleep 0.01; done; exit 17`,
              direct
            ),
          ],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe", "pipe"],
            timeout: ioLatencyBudgetMs(5_000),
          }
        );
        expect(result.status).toBe(17);
        expect(processIsRunnable(Number(readFileSync(pidFile, "utf8")))).toBe(
          false
        );
      }
    );
  }
);
