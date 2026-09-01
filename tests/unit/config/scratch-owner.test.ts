/** Regression coverage for durable scratch-root ownership. */
import * as fs from "node:fs";
import type { ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  classifyScratchOwner,
  currentProcessBirthFingerprint,
  processBirthFingerprintSnapshot,
  readScratchOwnerRecord,
  scratchPathIdentity,
  writeScratchOwnerRecord,
  type ScratchOwnerRecordV1,
} from "../../../src/configs/vitest/scratch-owner.js";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";
import {
  isProcessAlive,
  startWaitingTestRun,
  waitForTestRun,
} from "../../helpers/lisa-test-run-process.js";

/** Payload arm that catches and ignores every forwarded terminal signal. */
const IGNORE_SIGNALS = "ignore-signals" as const;

const testRunDirectories: string[] = [];
const testRunChildren: ChildProcess[] = [];
const registerTestRunDirectory = (directory: string): void => {
  testRunDirectories.push(directory);
};

afterEach(async () => {
  const running = testRunChildren.splice(0);
  const exits = running.map(child => {
    if (child.exitCode !== null || child.signalCode !== null)
      return Promise.resolve();
    return new Promise<void>(resolve => {
      child.once("exit", () => resolve());
      child.kill("SIGKILL");
    });
  });
  await Promise.all(exits);
  for (const directory of testRunDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * Start and register one real wrapper before any assertion can fail.
 * @param args - Real-wrapper fixture arguments
 * @returns Running registered wrapper
 */
async function startTrackedWaitingTestRun(
  ...args: Parameters<typeof startWaitingTestRun>
): ReturnType<typeof startWaitingTestRun> {
  const run = await startWaitingTestRun(...args);
  testRunChildren.push(run.child);
  return run;
}

const owner = (birth: string): ScratchOwnerRecordV1 => ({
  schema: 1,
  pid: 42,
  processBirthFingerprint: birth,
  createdAt: "2026-08-25T12:00:00.000Z",
  token: "test-token",
  suiteLabel: "unit",
  registeredPrefixes: ["cdk.out"],
  namespace: { canonicalPath: "/authority/lisa-scratch", dev: 1, ino: 2 },
  root: {
    canonicalPath: "/authority/lisa-scratch/run-42-1-abc",
    dev: 1,
    ino: 3,
  },
});

describe("scratch owner process identity", () => {
  it("derives a stable birth fingerprint for the current process", () => {
    const first = currentProcessBirthFingerprint();
    const second = currentProcessBirthFingerprint();

    expect(first).toMatch(/^(?:linux:|darwin:|unsupported:)/u);
    expect(second).toBe(first);
  });

  it.each([
    ["dead", false, undefined, "reclaim"],
    ["matching birth", true, "birth-a", "preserve"],
    ["reused pid", true, "birth-b", "reclaim"],
    ["ambiguous live pid", true, undefined, "preserve"],
  ] as const)("classifies a %s owner", (_label, alive, observed, expected) => {
    expect(
      classifyScratchOwner(owner("birth-a"), {
        isProcessAlive: () => alive,
        processBirthFingerprint: () => observed,
      })
    ).toBe(expected);
  });

  it("never treats a legacy unsupported birth placeholder as deletion authority", () => {
    expect(
      classifyScratchOwner(owner("unsupported:42"), {
        isProcessAlive: () => true,
        processBirthFingerprint: () => "linux:12345",
      })
    ).toBe("preserve");
  });

  it.each([
    [100, 1],
    [1_025, 5],
  ] as const)(
    "audits %i macOS owners through %i bounded bulk ps batch(es)",
    (ownerCount, expectedCalls) => {
      const calls: number[][] = [];
      const pids = Array.from({ length: ownerCount }, (_, index) => index + 10);
      const snapshot = processBirthFingerprintSnapshot(pids, {
        platform: "darwin",
        runDarwinBatch: batch => {
          calls.push([...batch]);
          return batch
            .map(pid => `${String(pid)} Mon Jan 01 00:00:00 2024`)
            .join("\n");
        },
      });

      expect(calls).toHaveLength(expectedCalls);
      expect(Math.max(...calls.map(call => call.length))).toBeLessThanOrEqual(
        256
      );
      expect(snapshot.size).toBe(ownerCount);
      expect(snapshot.get(10)).toBe("darwin:Mon Jan 01 00:00:00 2024");
      expect(snapshot.get(ownerCount + 9)).toBe(
        "darwin:Mon Jan 01 00:00:00 2024"
      );
    }
  );
});

describe("scratch owner marker path bounds", () => {
  it("admits a canonical nested path beyond the opaque-text bound", () => {
    const container = fs.mkdtempSync(
      path.join(tmpdir(), "scratch-owner-path-")
    );
    const root = path.join(container, "a".repeat(120), "b".repeat(120));
    fs.mkdirSync(root, { recursive: true });
    const record: ScratchOwnerRecordV1 = {
      ...owner("birth-a"),
      namespace: scratchPathIdentity(path.dirname(root)),
      root: scratchPathIdentity(root),
    };

    try {
      expect(
        Buffer.byteLength(record.root.canonicalPath, "utf8")
      ).toBeGreaterThan(256);
      writeScratchOwnerRecord(root, record);
      expect(readScratchOwnerRecord(root)).toEqual(record);
    } finally {
      fs.rmSync(container, { force: true, recursive: true });
    }
  });

  it("refuses a canonical path beyond the bounded marker contract", () => {
    const root = fs.mkdtempSync(path.join(tmpdir(), "scratch-owner-path-"));
    const record: ScratchOwnerRecordV1 = {
      ...owner("birth-a"),
      namespace: scratchPathIdentity(path.dirname(root)),
      root: {
        ...scratchPathIdentity(root),
        canonicalPath: `/${"a".repeat(4_096)}`,
      },
    };

    try {
      writeScratchOwnerRecord(root, record);
      expect(() => readScratchOwnerRecord(root)).toThrow(/marker schema/iu);
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("lisa-test-run signal lifecycle", () => {
  it.each(["SIGTERM", "SIGINT", "SIGHUP"] as const)(
    "captures %s at the CLI boundary, cleans, and preserves it",
    async signal => {
      const run = await startTrackedWaitingTestRun(
        process.env,
        registerTestRunDirectory
      );
      const outcome = new Promise<NodeJS.Signals | null>(resolve =>
        run.child.once("exit", (_code, observed) => resolve(observed))
      );
      run.child.kill(signal);

      expect(await outcome).toBe(signal);
      expect(fs.existsSync(run.root)).toBe(false);
      expect(isProcessAlive(run.payloadPid)).toBe(false);
      await waitForTestRun(
        () => run.companionPids.every(pid => !isProcessAlive(pid)),
        `${signal} companion exit`
      );
    }
  );

  it("preserves the original signal and cleans when forwarding loses IPC", async () => {
    const run = await startTrackedWaitingTestRun(
      process.env,
      registerTestRunDirectory,
      "wait",
      "signal-send-rejected"
    );
    const outcome = new Promise<{
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }>(resolve =>
      run.child.once("exit", (code, signal) => resolve({ code, signal }))
    );
    run.child.kill("SIGTERM");

    expect(await outcome).toEqual({ code: null, signal: "SIGTERM" });
    await waitForTestRun(
      () => !fs.existsSync(run.root),
      "rejected-send root cleanup"
    );
    expect(isProcessAlive(run.payloadPid)).toBe(false);
    await waitForTestRun(
      () => run.companionPids.every(pid => !isProcessAlive(pid)),
      "rejected-send companion exit"
    );
  });

  it.each(["SIGTERM", "SIGINT"] as const)(
    "escalates a forwarded %s when the payload ignores it",
    async signal => {
      const run = await startTrackedWaitingTestRun(
        process.env,
        registerTestRunDirectory,
        IGNORE_SIGNALS
      );
      const outcome = new Promise<NodeJS.Signals | null>(resolve =>
        run.child.once("exit", (_code, observed) => resolve(observed))
      );
      const watchdog = setTimeout(
        () => run.child.kill("SIGKILL"),
        ioLatencyBudgetMs(6_000)
      );
      run.child.kill(signal);

      const observed = await outcome;
      clearTimeout(watchdog);
      expect(observed).toBe(signal);
      expect(fs.existsSync(run.root)).toBe(false);
      expect(isProcessAlive(run.payloadPid)).toBe(false);
      await waitForTestRun(
        () => run.companionPids.every(pid => !isProcessAlive(pid)),
        `ignored-${signal} companion exit`
      );
    }
  );

  it("preserves the first terminal signal when a resistant payload receives another", async () => {
    const run = await startTrackedWaitingTestRun(
      process.env,
      registerTestRunDirectory,
      IGNORE_SIGNALS
    );
    const outcome = new Promise<NodeJS.Signals | null>(resolve =>
      run.child.once("exit", (_code, observed) => resolve(observed))
    );
    const watchdog = setTimeout(
      () => run.child.kill("SIGKILL"),
      ioLatencyBudgetMs(6_000)
    );

    // Separated in time on purpose. Two signals sent back-to-back are both
    // pending at once, and POSIX leaves the delivery order of different pending
    // signals unspecified — measured on Linux, SIGTERM is dispatched to the
    // listener ahead of an earlier SIGINT roughly 1 run in 20. Asserting on
    // send order without this gap pins kernel scheduling, not the supervisor.
    // The gap stays well inside the 1s forwarded-signal grace, so the second
    // signal still lands while the first is being honoured, which is the
    // clobber the guard has to refuse.
    run.child.kill("SIGINT");
    await new Promise(resolve => setTimeout(resolve, ioLatencyBudgetMs(250)));
    run.child.kill("SIGTERM");

    const observed = await outcome;
    clearTimeout(watchdog);
    expect(observed).toBe("SIGINT");
    expect(fs.existsSync(run.root)).toBe(false);
    expect(isProcessAlive(run.payloadPid)).toBe(false);
    await waitForTestRun(
      () => run.companionPids.every(pid => !isProcessAlive(pid)),
      "first-signal companion exit"
    );
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "still cleans when a resistant payload receives %s twice",
    async signal => {
      const run = await startTrackedWaitingTestRun(
        process.env,
        registerTestRunDirectory,
        IGNORE_SIGNALS
      );
      const outcome = new Promise<NodeJS.Signals | null>(resolve =>
        run.child.once("exit", (_code, observed) => resolve(observed))
      );
      const watchdog = setTimeout(
        () => run.child.kill("SIGKILL"),
        ioLatencyBudgetMs(6_000)
      );

      // A repeat of the SAME signal is the ordinary case — Ctrl-C pressed twice,
      // or a scheduler that re-sends SIGTERM after its own grace. The supervisor
      // must stay armed for it: an unarmed second delivery takes the default
      // disposition and kills the process mid-drain, so the exit signal still
      // looks right while the scratch root is silently left behind.
      run.child.kill(signal);
      await new Promise(resolve => setTimeout(resolve, ioLatencyBudgetMs(250)));
      run.child.kill(signal);

      const observed = await outcome;
      clearTimeout(watchdog);
      expect(observed).toBe(signal);
      expect(fs.existsSync(run.root)).toBe(false);
      expect(isProcessAlive(run.payloadPid)).toBe(false);
      await waitForTestRun(
        () => run.companionPids.every(pid => !isProcessAlive(pid)),
        `repeated-${signal} companion exit`
      );
    }
  );
});
