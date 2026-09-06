/**
 * Interrupting a gate run tears its process tree down instead of orphaning it.
 *
 * The measured defect (CodySwannGT/lisa#3829): killing the gate runner reported
 * success, `pgrep` for it returned nothing, and eleven processes carried on —
 * because the supervisor holding the only handle to the detached group was
 * reparented to pid 1 and kept running.
 *
 * Every real-process case here is an A/B against the CONTROL fixture below,
 * which is the supervisor's pre-fix behaviour with exactly one thing removed:
 * the interrupt watch. Without that control the passing cases prove nothing —
 * a machine that reaped orphans on its own would satisfy them too.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  interruptionReason,
  interruptionReport,
  isWatchablePid,
  parseWatchPids,
  supervise,
} from "../../../all/copy-overwrite/scripts/lib/process-tree-runner.mjs";
import {
  boundedSpawnSync as boundedTestSpawnSync,
  ioLatencyBudgetMs,
} from "../../helpers/io-latency-budget.js";

const PROCESS_TREE_RUNNER = path.resolve(
  "all/copy-overwrite/scripts/lib/process-tree-runner.mjs"
);

/**
 * How long a planted descendant survives if every teardown in this file fails.
 *
 * A ceiling, not a budget. The suite asserts long before it, and it exists only
 * so that a case killed mid-run cannot leave a process behind for a machine
 * that has previously had its process cap exhausted by exactly this shape.
 */
const PLANTED_LIFETIME_MS = 15_000;

const roots: string[] = [];
const tokens: string[] = [];

/** Quote one value for /bin/sh. POSIX-only; every case here skips Windows. */
const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", `'"'"'`)}'`;

/** A planted descendant that keeps its unique token visible in `ps`. */
const plantedCommand = (token: string): string =>
  [
    shellQuote(process.execPath),
    "-e",
    shellQuote(`setTimeout(() => {}, ${String(PLANTED_LIFETIME_MS)})`),
    token,
  ].join(" ");

/** Every non-zombie pid whose command carries one unguessable test token. */
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

/** Kill only processes carrying an unguessable per-test token. */
const killTokenProcesses = (token: string): void => {
  for (const pid of findTokenProcesses(token)) {
    if (pid === process.pid) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, which is the state this is trying to reach.
    }
  }
};

/** Wait for a real-process condition within the measured I/O budget. */
const waitForProcessCondition = async (
  predicate: () => boolean
): Promise<boolean> => {
  const deadline = Date.now() + ioLatencyBudgetMs(4_000);
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return predicate();
};

/** A token no other run on this machine can collide with. */
const freshToken = (label: string): string => {
  const token = `lisa3829-${label}-${String(process.pid)}-${randomBytes(4).toString("hex")}`;
  tokens.push(token);
  return token;
};

const freshRoot = (label: string): string => {
  const root = mkdtempSync(path.join(tmpdir(), `lisa-3829-${label}-`));
  roots.push(root);
  return root;
};

/**
 * The pre-fix supervisor: a detached group, and nothing watching the caller.
 *
 * One difference from the shipped supervisor — no interrupt watch — so the
 * control isolates the wiring under test rather than the whole file.
 */
const CONTROL_SUPERVISOR = [
  `import { spawn } from "node:child_process";`,
  `spawn("/bin/sh", ["-c", process.argv[2]], {`,
  `  detached: true,`,
  `  stdio: "ignore",`,
  `});`,
  `setInterval(() => {}, 1000);`,
].join("\n");

/** A synchronous parent, exactly as the gate runner starts a supervisor. */
const SYNC_PARENT = [
  `import { spawnSync } from "node:child_process";`,
  `import { openSync } from "node:fs";`,
  `const [supervisor, command, reportFile, ...extra] = process.argv.slice(2);`,
  `spawnSync(process.execPath, [supervisor, ...extra, command], {`,
  `  stdio: ["ignore", "ignore", openSync(reportFile, "a")],`,
  `});`,
].join("\n");

interface PlantedRun {
  readonly parentPid: number;
  readonly token: string;
  readonly reportFile: string;
}

/**
 * Start a supervisor under a synchronous parent and wait for its descendant.
 *
 * @param input - Which supervisor to run and how to invoke it.
 * @returns The parent pid, the planted token, and where stderr was recorded.
 */
const plantRun = async (input: {
  readonly label: string;
  readonly supervisor: "shipped" | "control";
  readonly extraArgs?: readonly string[];
}): Promise<PlantedRun> => {
  const root = freshRoot(input.label);
  const token = freshToken(input.label);
  const reportFile = path.join(root, "report.txt");
  writeFileSync(reportFile, "");
  const parentFile = path.join(root, "parent.mjs");
  writeFileSync(parentFile, SYNC_PARENT);

  let supervisorFile = PROCESS_TREE_RUNNER;
  const extra = [...(input.extraArgs ?? [])];
  if (input.supervisor === "control") {
    supervisorFile = path.join(root, "control.mjs");
    writeFileSync(supervisorFile, CONTROL_SUPERVISOR);
  } else {
    extra.unshift(`--timeout-ms=${String(PLANTED_LIFETIME_MS)}`);
    extra.push("--");
  }

  const parent = spawn(
    process.execPath,
    [parentFile, supervisorFile, plantedCommand(token), reportFile, ...extra],
    { stdio: "ignore" }
  );
  parent.unref();
  const parentPid = parent.pid ?? 0;
  expect(parentPid).toBeGreaterThan(1);
  expect(
    await waitForProcessCondition(() => findTokenProcesses(token).length > 0)
  ).toBe(true);
  return { parentPid, token, reportFile };
};

/** Whether a pid is still a live process. */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Kill one pid and wait for the kernel to agree it is gone. */
const killAndAwait = async (pid: number): Promise<void> => {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  await waitForProcessCondition(() => !alive(pid));
};

afterEach(() => {
  for (const token of tokens.splice(0)) killTokenProcesses(token);
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("a gate run that is interrupted takes its descendants with it", () => {
  it.skipIf(process.platform === "win32")(
    "CONTROL: a supervisor with no interrupt watch orphans its tree",
    async () => {
      const run = await plantRun({ label: "control", supervisor: "control" });
      await killAndAwait(run.parentPid);

      // The same settle the shipped supervisor is given below, so the two
      // cases differ in the wiring and not in how long each was watched.
      await new Promise(resolve =>
        setTimeout(resolve, ioLatencyBudgetMs(2_000))
      );

      const survivors = findTokenProcesses(run.token);
      expect(survivors.length).toBeGreaterThan(0);
      // The orphan signature from the incident report: reparented, still live.
      const ppids = boundedTestSpawnSync({
        command: "ps",
        args: ["-o", "ppid=", "-p", survivors.map(String).join(",")],
        label: "read orphan parents",
      }).stdout;
      expect(ppids).toMatch(/(^|\n)\s*1\s*$/mu);
    }
  );

  it.skipIf(process.platform === "win32")(
    "the shipped supervisor reaps its tree when its run is killed",
    async () => {
      const run = await plantRun({ label: "orphan", supervisor: "shipped" });
      await killAndAwait(run.parentPid);

      expect(
        await waitForProcessCondition(
          () => findTokenProcesses(run.token).length === 0
        )
      ).toBe(true);
    }
  );

  it.skipIf(process.platform === "win32")(
    "says it was interrupted and what it terminated",
    async () => {
      const run = await plantRun({ label: "report", supervisor: "shipped" });
      await killAndAwait(run.parentPid);
      expect(
        await waitForProcessCondition(
          () => findTokenProcesses(run.token).length === 0
        )
      ).toBe(true);

      expect(
        await waitForProcessCondition(() =>
          readFileSync(run.reportFile, "utf8").includes("INTERRUPTED")
        )
      ).toBe(true);
      const report = readFileSync(run.reportFile, "utf8");
      expect(report).toContain(`(pid ${String(run.parentPid)}) exited`);
      expect(report).toContain("terminated its process tree");
      expect(report).toContain("Nothing was proved by it");
    }
  );

  it.skipIf(process.platform === "win32")(
    "stops when a watched pid further up the chain dies",
    async () => {
      // The gate runner's own case: the supervisor's parent is alive and well,
      // and the process that MATTERS — the hook two levels up — is not.
      const bystander = spawn(
        process.execPath,
        ["-e", `setTimeout(() => {}, ${String(PLANTED_LIFETIME_MS)})`],
        { stdio: "ignore" }
      );
      bystander.unref();
      const watched = bystander.pid ?? 0;
      expect(watched).toBeGreaterThan(1);

      const run = await plantRun({
        label: "watchpid",
        supervisor: "shipped",
        extraArgs: [`--watch-pid=${String(watched)}`],
      });
      expect(alive(run.parentPid)).toBe(true);

      await killAndAwait(watched);
      expect(
        await waitForProcessCondition(
          () => findTokenProcesses(run.token).length === 0
        )
      ).toBe(true);
      expect(readFileSync(run.reportFile, "utf8")).toContain(
        `(pid ${String(watched)}) exited`
      );
      await killAndAwait(run.parentPid);
    }
  );
});

describe("what counts as an interrupted run", () => {
  it("reports orphaning by the parent pid it was started under", () => {
    expect(
      interruptionReason({ launchParentPid: 4242, currentParentPid: 1 })
    ).toBe("the run that started it (pid 4242) exited");
  });

  it("keeps running while the launching parent is unchanged", () => {
    expect(
      interruptionReason({ launchParentPid: 4242, currentParentPid: 4242 })
    ).toBeNull();
  });

  it("reports a watched pid that is provably gone", () => {
    expect(
      interruptionReason({
        launchParentPid: 42,
        currentParentPid: 42,
        watchPids: [7, 9],
        gone: pid => pid === 9,
      })
    ).toBe("the run it serves (pid 9) exited");
  });

  it("refuses to stop a run on a pid whose absence was never proved", () => {
    // The direction that matters: a refused probe must not tear down a gate
    // run that is still executing correctly.
    expect(
      interruptionReason({
        launchParentPid: 42,
        currentParentPid: 42,
        watchPids: [7],
        gone: () => false,
      })
    ).toBeNull();
  });

  it("never arms a watch on a pid that cannot die", () => {
    expect(isWatchablePid(1)).toBe(false);
    expect(isWatchablePid(0)).toBe(false);
    expect(isWatchablePid(-3)).toBe(false);
    expect(isWatchablePid(2)).toBe(true);
    expect(
      interruptionReason({ launchParentPid: 1, currentParentPid: 5 })
    ).toBeNull();
  });

  it("keeps only watchable pids from the command line, in order", () => {
    expect(
      parseWatchPids([
        "--timeout-ms=5",
        "--watch-pid=31",
        "--watch-pid=1",
        "--watch-pid=abc",
        "--watch-pid=31",
        "--watch-pid=44",
      ])
    ).toEqual([31, 44]);
  });

  it("names the run, the reason, and the tree in one line", () => {
    const line = interruptionReport("the run that started it exited", 918);
    expect(line).toContain("INTERRUPTED");
    expect(line).toContain("the run that started it exited");
    expect(line).toContain("group 918");
  });
});

describe("the supervisor's interrupt watch", () => {
  it.skipIf(process.platform === "win32")(
    "reaps through the same single reap the deadline uses, and reports once",
    async () => {
      const reaped: number[] = [];
      const reported: string[] = [];
      const exited = new Promise<void>(resolve => {
        const original = process.kill.bind(process);
        const restore = (): void => {
          process.kill = original;
        };
        process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
          if (pid === process.pid) {
            restore();
            resolve();
            return true;
          }
          return original(pid, signal as NodeJS.Signals);
        }) as typeof process.kill;
      });

      const running = supervise(
        `${shellQuote(process.execPath)} -e ${shellQuote(
          "setTimeout(() => {}, 5000)"
        )}`,
        PLANTED_LIFETIME_MS,
        async (pid: number) => {
          reaped.push(pid);
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            // The group may already have exited.
          }
        },
        {
          detect: () => "the run that started it (pid 4242) exited",
          pollMs: 10,
          report: line => reported.push(line),
        }
      ).catch(() => undefined);

      await exited;
      expect(running).toBeInstanceOf(Promise);
      expect(reaped).toHaveLength(1);
      expect(reported).toHaveLength(1);
      expect(reported[0]).toContain("INTERRUPTED");
      expect(reported[0]).toContain(`group ${String(reaped[0])}`);
    }
  );

  it.skipIf(process.platform === "win32")(
    "leaves a run alone while its detector says nothing is wrong",
    async () => {
      const reported: string[] = [];
      const result = await supervise(":", PLANTED_LIFETIME_MS, undefined, {
        detect: () => null,
        pollMs: 5,
        report: line => reported.push(line),
      });
      expect(result.code).toBe(0);
      expect(reported).toEqual([]);
    }
  );
});
