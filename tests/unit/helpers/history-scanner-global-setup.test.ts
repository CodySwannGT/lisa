/**
 * @file history-scanner-global-setup.test.ts
 * @description The history-scanner global setup's cleanup contract
 * (CodySwannGT/lisa#4621): an interrupted preparation stops its provision
 * child before any folder is removed, every cleanup failure is reported on
 * stderr synchronously and never throws, and the scope's parent folder sits
 * where the setup's module documentation says it does. Network-free: every
 * provision child here is a stub, and none stands in for the genuine
 * acquisition proved in
 * tests/integration/history-secret-scanner-preparation.test.ts.
 * @module tests/unit/helpers/history-scanner-global-setup
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  materializeOwnedScratchRunRoot,
  prepareOwnedScratchRunRoot,
  removeOwnedScratchRunRoot,
} from "../../../src/configs/vitest/scratch-run-root-intent.js";
import { createScratchNamespaceAuthority } from "../../../src/configs/vitest/scratch-namespace-authority.js";
import { readScratchOwnerRecord } from "../../../src/configs/vitest/scratch-owner.js";
import {
  SCRATCH_SUPERVISION_LEASE_ENV,
  createScratchSupervisionLease,
} from "../../../src/configs/vitest/scratch-supervision.js";
import {
  ownedParent,
  prepareInOwnedParent,
  reclaimableDirectory,
} from "../../helpers/history-scanner-global-setup.js";
import {
  prepareHistoryScanner,
  type PreparedScope,
} from "../../helpers/history-scanner-preparation.js";
import {
  BOUNDED_SPAWN_BASE_MS,
  ioLatencyBudgetMs,
} from "../../helpers/io-latency-budget.js";

/** Basename prefix of every preparation scope. */
const SCOPE_PREFIX = "lisa-history-scanner-preparation-";

/**
 * Switches for the `node:fs` seams. `writeSync` and `rmSync` pass through to
 * the real module unless a case arms them, so every other caller in the graph
 * keeps its real behavior.
 */
const fsControl = vi.hoisted(() => ({
  failScopeRemoval: false,
  stderrWrites: [] as string[],
  stderrFailure: undefined as NodeJS.ErrnoException | undefined,
  stderrAttempts: 0,
}));

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const writeSync = vi.fn((fd: number, ...rest: unknown[]) => {
    if (fd !== process.stderr.fd)
      return (actual.writeSync as (...args: unknown[]) => number)(fd, ...rest);
    fsControl.stderrAttempts += 1;
    if (fsControl.stderrFailure !== undefined) throw fsControl.stderrFailure;
    const [data, offset] = rest;
    const pending = Buffer.isBuffer(data)
      ? data.subarray(typeof offset === "number" ? offset : 0)
      : Buffer.from(String(data), "utf8");
    fsControl.stderrWrites.push(pending.toString("utf8"));
    return pending.length;
  });
  const rmSync = vi.fn((path: fs.PathLike, options?: fs.RmOptions) => {
    if (
      fsControl.failScopeRemoval &&
      basename(String(path)).startsWith(SCOPE_PREFIX)
    ) {
      throw Object.assign(new Error("injected EBUSY removing the scope"), {
        code: "EBUSY",
      });
    }
    actual.rmSync(path, options);
  });
  return { ...actual, default: actual, rmSync, writeSync };
});

const lease = fs.mkdtempSync(join(tmpdir(), "history-scanner-global-setup-"));
const STUB_DEADLINE_MS = ioLatencyBudgetMs(BOUNDED_SPAWN_BASE_MS);

/** Kills each hanging stub child and runs its listeners, whatever a case did. */
const safetyNets: (() => void)[] = [];

/** A stub child that exits at once without provisioning anything. */
const FAILS_AT_ONCE = "process.exit(3);";

/**
 * A stub child that reports its pid and destination, then never exits.
 * @param marker - Where it reports them
 * @returns The stub's program
 */
const hangsAfterReporting = (marker: string): string =>
  `require("node:fs").writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: process.pid, destination: process.argv[1] })); setInterval(() => undefined, 1000);`;

const stubArgv =
  (script: string) =>
  (destination: string): readonly [string, ...string[]] => [
    process.execPath,
    "-e",
    script,
    destination,
  ];

/** A running preparation, and the exit listeners it registered, in run order. */
interface RunningPreparation {
  readonly pending: Promise<PreparedScope>;
  readonly pid: number;
  readonly scope: string;
  readonly parent: string;
  readonly listeners: readonly (() => void)[];
}

/**
 * Start the setup's preparation with a stub child that has not exited.
 * @param name - Distinguishes this case's marker file
 * @returns The running preparation
 */
async function startHangingPreparation(
  name: string
): Promise<RunningPreparation> {
  const marker = join(lease, `${name}.json`);
  const before = process.listeners("exit");
  const pending = prepareInOwnedParent({
    argv: stubArgv(hangsAfterReporting(marker)),
  });
  await vi.waitFor(() => expect(fs.existsSync(marker)).toBe(true), {
    timeout: STUB_DEADLINE_MS,
    interval: 20,
  });
  const reported = JSON.parse(fs.readFileSync(marker, "utf8")) as {
    readonly pid: number;
    readonly destination: string;
  };
  const scope = dirname(reported.destination);
  const listeners = process
    .listeners("exit")
    .filter(listener => !before.includes(listener)) as (() => void)[];
  safetyNets.push(() => {
    const killIfAlive = (): void => {
      if (alive(reported.pid)) process.kill(reported.pid, "SIGKILL");
    };
    for (const run of [killIfAlive, ...listeners]) {
      try {
        run();
      } catch {
        // A case that already failed must not also leak its stub child.
      }
    }
  });
  return {
    pending,
    pid: reported.pid,
    scope,
    parent: dirname(scope),
    listeners,
  };
}

/**
 * Whether a process is still alive.
 * @param pid - The process
 * @returns Whether signal 0 reaches it
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
 * Every stderr line a case captured.
 * @returns The captured text
 */
const stderrText = (): string => fsControl.stderrWrites.join("");

afterEach(() => {
  fsControl.failScopeRemoval = false;
  for (const net of safetyNets.splice(0)) net();
  fsControl.stderrWrites.length = 0;
  fsControl.stderrFailure = undefined;
  fsControl.stderrAttempts = 0;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(() => {
  fs.rmSync(lease, { recursive: true, force: true });
  expect(fs.existsSync(lease)).toBe(false);
});

describe("an interrupted preparation", () => {
  it("stops the provision child before removing any folder", async () => {
    const running = await startHangingPreparation("exit-order");
    expect(running.listeners).toHaveLength(2);
    const [first, ...rest] = running.listeners;

    first?.();
    expect(fs.existsSync(running.parent)).toBe(true);
    await vi.waitFor(() => expect(alive(running.pid)).toBe(false), {
      timeout: STUB_DEADLINE_MS,
    });
    for (const listener of rest) listener();

    const { preparation, dispose } = await running.pending;
    dispose();
    expect(preparation.ok).toBe(false);
    expect(alive(running.pid)).toBe(false);
    expect(fs.existsSync(running.scope)).toBe(false);
    expect(fs.existsSync(running.parent)).toBe(false);
  });
});

describe("a failed release of the parent folder", () => {
  const failingParent = (): ReturnType<typeof ownedParent> => {
    const path = fs.mkdtempSync(join(lease, "parent-"));
    return ownedParent({
      path,
      remove: () => {
        throw new Error("injected release failure");
      },
    });
  };

  it("is written to stderr synchronously, before the release returns", () => {
    const write = vi.spyOn(process.stderr, "write");
    const parent = failingParent();

    expect(() => parent.release()).not.toThrow();

    expect(stderrText()).toContain(
      "its scratch scope could not be released (injected release failure)"
    );
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ["gives up after a bounded number of EAGAIN retries", "EAGAIN", 100],
    ["stops at once when stderr refuses the write outright", "EBADF", 1],
  ])("%s, without throwing", (_name, code, attempts) => {
    fsControl.stderrFailure = Object.assign(new Error(code), { code });
    const parent = failingParent();

    expect(() => parent.release()).not.toThrow();

    expect(fsControl.stderrAttempts).toBe(attempts);
  });
});

describe("a failed removal of the preparation scope", () => {
  it("neither throws from its exit listener nor skips the parent's release", async () => {
    const running = await startHangingPreparation("removal-at-exit");
    fsControl.failScopeRemoval = true;

    for (const listener of running.listeners)
      expect(() => listener()).not.toThrow();

    expect(stderrText()).toContain(
      "its preparation scope could not be removed (injected EBUSY removing the scope)"
    );
    expect(fs.existsSync(running.parent)).toBe(false);
    fsControl.failScopeRemoval = false;
    const { dispose } = await running.pending;
    dispose();
  });

  it("keeps the failure path's own reason and still releases the parent at teardown", async () => {
    fsControl.failScopeRemoval = true;

    const { preparation, dispose } = await prepareInOwnedParent({
      argv: stubArgv(FAILS_AT_ONCE),
    });

    if (preparation.ok) throw new Error("The stub acquisition succeeded.");
    expect(preparation.reason).not.toMatch(/unexpectedly/u);
    expect(stderrText()).toContain(
      "its preparation scope could not be removed"
    );
    const scope = dirname(String(preparation.evidence?.argv.at(-1)));
    const parent = dirname(scope);
    expect(fs.existsSync(parent)).toBe(true);

    expect(() => dispose()).not.toThrow();

    expect(fs.existsSync(scope)).toBe(false);
    expect(fs.existsSync(parent)).toBe(false);
  });
});

describe("where the scope lives", () => {
  /**
   * Prepare once with a stub child, and check the scope sits directly inside.
   * @param parent - The scope's parent
   */
  async function expectScopeDirectlyIn(parent: string): Promise<void> {
    const { preparation, dispose } = await prepareHistoryScanner({
      argv: stubArgv(FAILS_AT_ONCE),
      deadlineMs: STUB_DEADLINE_MS,
      parent,
    });
    const scope = dirname(String(preparation.evidence?.argv.at(-1)));
    dispose();
    expect(dirname(scope)).toBe(parent);
    expect(basename(scope).startsWith(SCOPE_PREFIX)).toBe(true);
  }

  it("is a supervised worker scope inside the leased suite root when a lease is held", async () => {
    const intent = prepareOwnedScratchRunRoot();
    const suiteRoot = materializeOwnedScratchRunRoot(intent);
    vi.stubEnv(
      SCRATCH_SUPERVISION_LEASE_ENV,
      JSON.stringify(
        createScratchSupervisionLease(intent, {
          suiteLabel: "unit",
          registeredPrefixes: [],
        })
      )
    );
    const workerIn = (path: string): void => {
      expect(dirname(path)).toBe(suiteRoot.path);
      expect(basename(path).startsWith(`worker-${String(process.pid)}-`)).toBe(
        true
      );
    };
    try {
      const directory = reclaimableDirectory();
      workerIn(directory.path);
      await expectScopeDirectlyIn(directory.path);
      directory.remove();
      expect(fs.existsSync(directory.path)).toBe(false);

      const { preparation, dispose } = await prepareInOwnedParent({
        argv: stubArgv(FAILS_AT_ONCE),
      });
      const setupScope = dirname(String(preparation.evidence?.argv.at(-1)));
      expect(basename(setupScope).startsWith(SCOPE_PREFIX)).toBe(true);
      workerIn(dirname(setupScope));
      dispose();
      expect(fs.existsSync(dirname(setupScope))).toBe(false);
    } finally {
      removeOwnedScratchRunRoot(suiteRoot);
    }
  });

  it("is an owned scratch run root of this process without a lease", async () => {
    vi.stubEnv(SCRATCH_SUPERVISION_LEASE_ENV, "");
    const directory = reclaimableDirectory();
    try {
      expect(dirname(directory.path)).toBe(
        createScratchNamespaceAuthority().namespace.canonicalPath
      );
      expect(readScratchOwnerRecord(directory.path)).toMatchObject({
        pid: process.pid,
        root: { canonicalPath: directory.path },
      });
      await expectScopeDirectlyIn(directory.path);
    } finally {
      directory.remove();
    }
    expect(fs.existsSync(directory.path)).toBe(false);
  });
});
