/**
 * Headroom admission end to end in one process (CodySwannGT/lisa#4596): a real
 * state directory, lock and reservation files, with the machine reading, the
 * clock and process liveness stated by the test.
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { MachineReading } from "../../../src/core/admission-decision.js";
import {
  type AdmissionRequest,
  type AdmissionRuntime,
  requestAdmission,
} from "../../../src/core/admission.js";
import type { AdmissionSettings } from "../../../src/core/admission-settings.js";
import { lockAddress } from "../../../src/core/admission-lock.js";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const SELF = 900_001;

/**
 * A fresh state directory.
 * @returns Path
 */
const stateDir = (): string => {
  const root = mkdtempSync(join(tmpdir(), "lisa-test-"));
  roots.push(root);
  return root;
};

/**
 * Settings over a state directory.
 * @param dir - State directory
 * @param overrides - Fields to replace
 * @returns Settings
 */
const settings = (
  dir: string,
  overrides: Partial<AdmissionSettings> = {}
): AdmissionSettings => ({
  skipped: null,
  thresholds: {
    maxLoadPerCore: 1,
    minFreeMemoryMb: 512,
    recentWindowMs: 60_000,
  },
  maxWaitMs: 30_000,
  pollMs: 1_000,
  push: false,
  stateDir: dir,
  ...overrides,
});

/**
 * A request for `workers` workers.
 * @param dir - State directory
 * @param workers - Declared workers
 * @param overrides - Settings overrides
 * @returns Request
 */
const request = (
  dir: string,
  workers: number,
  overrides: Partial<AdmissionSettings> = {}
): AdmissionRequest => ({
  workers,
  command: "bun run typecheck",
  cwd: "/repo-b",
  environment: {},
  settings: settings(dir, overrides),
});

/**
 * A runtime with a stated machine and a clock that sleeping advances.
 * @param readings - Reading per poll; the last repeats
 * @param alive - Pids that count as alive
 * @returns Runtime plus the log it collected
 */
const runtime = (
  readings: readonly MachineReading[],
  alive: ReadonlySet<number> = new Set()
): AdmissionRuntime & { readonly lines: string[] } => {
  const lines: string[] = [];
  const state = { now: 1_800_000_000_000, polls: 0 };
  return {
    lines,
    pid: SELF,
    readMachine: () => {
      const reading = readings[Math.min(state.polls, readings.length - 1)];
      state.polls += 1;
      return reading as MachineReading;
    },
    probes: {
      isAlive: pid => pid === SELF || alive.has(pid),
      startTimes: pids =>
        new Map(pids.map(pid => [pid, `start-of-${String(pid)}`])),
    },
    now: () => state.now,
    sleep: async ms => {
      state.now += ms;
    },
    log: line => {
      lines.push(line);
    },
  };
};

const IDLE: MachineReading = { cores: 8, load1: 0, freeMemoryMb: 8192 };
const BUSY: MachineReading = { cores: 8, load1: 8, freeMemoryMb: 8192 };

/**
 * Write a reservation another run holds.
 * @param dir - State directory
 * @param pid - Its pid
 * @param fields - Overrides
 */
const holdBy = (
  dir: string,
  pid: number,
  fields: Record<string, unknown> = {}
): void => {
  writeFileSync(
    join(dir, `${String(pid)}.json`),
    JSON.stringify({
      pid,
      processStartTime: `start-of-${String(pid)}`,
      workers: 4,
      command: "bun run test:unit",
      cwd: "/repo-a",
      startedAt: 1_800_000_000_000,
      ...fields,
    })
  );
};

describe("requestAdmission", () => {
  it("admits an idle machine at once and records a reservation it can release", async () => {
    const dir = stateDir();
    const seams = runtime([IDLE]);
    const outcome = await requestAdmission(request(dir, 4), seams);
    expect(outcome).toMatchObject({ kind: "admitted", granted: 4 });
    expect(readdirSync(dir)).toContain(`${String(SELF)}.json`);
    expect(seams.lines.join("\n")).toMatch(
      /admitted `bun run typecheck` with 4/u
    );
    if (outcome.kind === "admitted") outcome.release();
    expect(existsSync(join(dir, `${String(SELF)}.json`))).toBe(false);
  });

  it("two runs on an idle machine are both admitted", async () => {
    const dir = stateDir();
    const first = await requestAdmission(request(dir, 4), runtime([IDLE]));
    const second = await requestAdmission(request(dir, 4), {
      ...runtime([IDLE], new Set([SELF])),
      pid: SELF + 1,
    });
    expect(first.kind).toBe("admitted");
    expect(second.kind).toBe("admitted");
  });

  it("the second of two runs with headroom for one waits on the first's reservation", async () => {
    const dir = stateDir();
    const machine = { cores: 4, load1: 0, freeMemoryMb: 8192 };
    expect(
      (await requestAdmission(request(dir, 4), runtime([machine]))).kind
    ).toBe("admitted");
    const second = runtime([machine], new Set([SELF]));
    const outcome = await requestAdmission(
      request(dir, 4, { maxWaitMs: 2_000 }),
      { ...second, pid: SELF + 1 }
    );
    expect(outcome.kind).toBe("refused");
  });

  it("waits naming the holders, then starts as soon as headroom returns", async () => {
    const dir = stateDir();
    holdBy(dir, 4242);
    const seams = runtime([BUSY, BUSY, IDLE], new Set([4242]));
    const outcome = await requestAdmission(request(dir, 4), seams);
    expect(outcome.kind).toBe("admitted");
    const log = seams.lines.join("\n");
    expect(log).toMatch(/waiting for headroom/u);
    expect(log).toMatch(/pid 4242: `bun run test:unit` in \/repo-a/u);
    // Announced once, not once per poll.
    expect(log.match(/waiting for headroom/gu)).toHaveLength(1);
  });

  it("refuses after the bound, naming the busy runs, and never starts", async () => {
    const dir = stateDir();
    holdBy(dir, 4242);
    const outcome = await requestAdmission(
      request(dir, 4, { maxWaitMs: 5_000, push: true }),
      runtime([BUSY], new Set([4242]))
    );
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.message).toMatch(/refused `bun run typecheck` after 5s/u);
    expect(outcome.message).toMatch(/pid 4242/u);
    expect(outcome.message).toMatch(/Nothing was started/u);
    expect(outcome.message).toMatch(/lisa check/u);
    expect(readdirSync(dir)).not.toContain(`${String(SELF)}.json`);
  });

  it("ignores and removes a dead run's reservation", async () => {
    const dir = stateDir();
    holdBy(dir, 4242, { workers: 8 });
    const outcome = await requestAdmission(request(dir, 8), runtime([IDLE]));
    expect(outcome.kind).toBe("admitted");
    expect(existsSync(join(dir, "4242.json"))).toBe(false);
  });

  it("ignores and removes a reservation whose pid was reused", async () => {
    const dir = stateDir();
    holdBy(dir, 4242, { workers: 8, processStartTime: "an earlier process" });
    const outcome = await requestAdmission(
      request(dir, 8),
      runtime([IDLE], new Set([4242]))
    );
    expect(outcome.kind).toBe("admitted");
    expect(existsSync(join(dir, "4242.json"))).toBe(false);
  });

  it("counts a reservation made from another repository", async () => {
    const dir = stateDir();
    holdBy(dir, 4242, { workers: 8, cwd: "/repo-a" });
    const outcome = await requestAdmission(
      request(dir, 4, { maxWaitMs: 1_000 }),
      runtime([IDLE], new Set([4242]))
    );
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused")
      expect(outcome.message).toMatch(/\/repo-a/u);
  });

  it("starts immediately and says so when admission is switched off", async () => {
    const dir = stateDir();
    const seams = runtime([BUSY]);
    const outcome = await requestAdmission(
      request(dir, 4, { skipped: "admission is off (LISA_ADMISSION=off)" }),
      seams
    );
    expect(outcome).toEqual({ kind: "skipped", granted: 4 });
    expect(seams.lines.join("\n")).toMatch(/admission is off/u);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("does not reserve again inside a parent's reservation", async () => {
    const dir = stateDir();
    const outcome = await requestAdmission(
      {
        ...request(dir, 4),
        environment: {
          LISA_ADMISSION_HOLDER: String(process.pid),
          LISA_ADMITTED_WORKERS: "2",
        },
      },
      runtime([BUSY])
    );
    expect(outcome).toEqual({ kind: "skipped", granted: 2 });
  });
});

describe("the decision lock never blocks a run without bound", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map(server => new Promise(resolve => server.close(resolve)))
    );
  });

  /**
   * Listen on the state's lock address and never let go, the way a holder
   * suspended with Ctrl-Z, or another user listening there, would.
   * @param dir - State directory
   * @returns Once listening
   */
  const holdLockForever = async (dir: string): Promise<void> => {
    const server = createServer(connection => connection.destroy());
    servers.push(server);
    await new Promise<void>(resolve =>
      server.listen(lockAddress(dir), resolve)
    );
  };

  it(
    "starts now, in one line, when the lock stays held past the wait bound",
    { timeout: ioLatencyBudgetMs(10_000) },
    async () => {
      const dir = stateDir();
      await holdLockForever(dir);
      const seams = runtime([IDLE]);
      const outcome = await requestAdmission(
        request(dir, 4, { maxWaitMs: 3_000 }),
        seams
      );
      expect(outcome).toEqual({ kind: "skipped", granted: 4 });
      const lines = seams.lines.filter(line => /decision lock/u.test(line));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/starting now without admission/u);
      expect(readdirSync(dir)).not.toContain(`${String(SELF)}.json`);
    }
  );

  it(
    "never deletes a non-socket file at the lock path, and starts now saying why",
    { timeout: ioLatencyBudgetMs(10_000) },
    async () => {
      const dir = stateDir();
      const planted = lockAddress(dir);
      writeFileSync(planted, "not a lock\n");
      const seams = runtime([IDLE]);
      const outcome = await requestAdmission(request(dir, 4), seams);
      expect(outcome).toEqual({ kind: "skipped", granted: 4 });
      expect(readFileSync(planted, "utf8")).toBe("not a lock\n");
      expect(seams.lines.join("\n")).toMatch(
        /is not a socket.*starting now without admission/u
      );
    }
  );
});
