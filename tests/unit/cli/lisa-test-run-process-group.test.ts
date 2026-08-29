/** Fail-closed process-birth and companion lifecycle controls. */
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  stopBootstrap,
  waitForMessage,
  waitForPayload,
} from "../../../src/cli/lisa-test-run-ipc.js";
import {
  drainTestRunTarget,
  type TestRunTargetIntent,
} from "../../../src/cli/lisa-test-run-process-group.js";
import { rejectOnReaperExit } from "../../../src/cli/lisa-test-run-runtime.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

const TARGET: TestRunTargetIntent = {
  pid: 4242,
  pgid: 4242,
  processBirthFingerprint: "armed-birth",
};

/**
 * Create a minimal evented companion for deterministic IPC controls.
 * @param exitCode - Initial terminal exit state
 * @returns Child-process-shaped event emitter
 */
function protocolCompanion(exitCode: number | null = null): ChildProcess {
  return Object.assign(new EventEmitter(), {
    connected: true,
    exitCode,
    signalCode: null,
    send: (
      _message: unknown,
      callback: (error: Error | null) => void
    ): boolean => {
      callback(null);
      return true;
    },
  }) as ChildProcess;
}

/**
 * Observe immediate settlement without waiting for a broken protocol timeout.
 * @param promise - Companion wait to observe
 * @returns Immediate resolution, rejection, or pending state
 */
async function immediateSettlement(promise: Promise<unknown>): Promise<string> {
  return await Promise.race([
    promise.then(
      () => "resolved",
      () => "rejected"
    ),
    new Promise<string>(resolve => setImmediate(() => resolve("pending"))),
  ]);
}

describe("test-run companion terminal state", () => {
  it("settles waits that begin after a companion is already terminal", async () => {
    const child = protocolCompanion(1);

    expect(
      await Promise.all([
        immediateSettlement(waitForMessage(child, "NEVER")),
        immediateSettlement(waitForPayload(child)),
        immediateSettlement(rejectOnReaperExit(child)),
      ])
    ).toEqual(["rejected", "rejected", "rejected"]);
  });

  it("rechecks terminal state after listeners are registered", async () => {
    const child = protocolCompanion();
    const originalOnce = child.once.bind(child);
    child.once = ((event: string, listener: (...args: unknown[]) => void) => {
      const result = originalOnce(event, listener);
      if (event === "exit") child.exitCode = 1;
      return result;
    }) as typeof child.once;
    const waiting = waitForMessage(child, "NEVER");
    const observed = await immediateSettlement(waiting);
    child.emit("exit", 1, null);
    await waiting.catch(() => undefined);

    expect(observed).toBe("rejected");
  });

  it("bounds bootstrap shutdown when STOP is accepted but exit never arrives", async () => {
    vi.useFakeTimers();
    const child = protocolCompanion();
    const stopping = stopBootstrap(child);
    const observed = stopping.then(
      () => "resolved",
      () => "rejected"
    );
    try {
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await observed).toBe("rejected");
    } finally {
      child.emit("exit", 0, null);
      await stopping.catch(() => undefined);
      vi.useRealTimers();
    }
  });

  it("disconnects the reaper only from the DISARMED send callback", () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "src/cli/lisa-test-run-reaper.ts"),
      "utf8"
    );
    expect(source).toMatch(
      /sendAcknowledgement\(state, "DISARMED", undefined, \{\}, \(\) => \{/u
    );
  });
});

describe("test-run process-group birth authority", () => {
  it("refuses a live recycled group when its armed leader is absent", async () => {
    const signal = vi.fn();

    await expect(
      drainTestRunTarget(TARGET, {
        probes: {
          isProcessAlive: () => false,
          processBirthFingerprint: () => {
            throw new Error("an absent leader has no birth authority");
          },
          processGroupAlive: () => true,
          signalGroup: signal,
          delay: async () => undefined,
        },
      })
    ).rejects.toThrow(/leader is absent.*refusing group signal/iu);
    expect(signal).not.toHaveBeenCalled();
  });

  it("accepts an already-absent leader and group without signalling", async () => {
    const signal = vi.fn();

    await expect(
      drainTestRunTarget(TARGET, {
        probes: {
          isProcessAlive: () => false,
          processBirthFingerprint: () => undefined,
          processGroupAlive: () => false,
          signalGroup: signal,
          delay: async () => undefined,
        },
      })
    ).resolves.toBeUndefined();
    expect(signal).not.toHaveBeenCalled();
  });

  it("retries an unavailable live birth probe then fails without signalling", async () => {
    const birth = vi.fn<() => string | undefined>(() => undefined);
    const signal = vi.fn();

    await expect(
      drainTestRunTarget(TARGET, {
        probes: {
          isProcessAlive: () => true,
          processBirthFingerprint: birth,
          processGroupAlive: () => true,
          signalGroup: signal,
          delay: async () => undefined,
        },
      })
    ).rejects.toThrow(/remained unavailable/iu);
    expect(birth.mock.calls.length).toBeGreaterThan(1);
    expect(signal).not.toHaveBeenCalled();
  });

  it("refuses a mismatched live birth without signalling a recycled group", async () => {
    const signal = vi.fn();

    await expect(
      drainTestRunTarget(TARGET, {
        probes: {
          isProcessAlive: () => true,
          processBirthFingerprint: () => "recycled-birth",
          processGroupAlive: () => true,
          signalGroup: signal,
          delay: async () => undefined,
        },
      })
    ).rejects.toThrow(/fingerprint changed/iu);
    expect(signal).not.toHaveBeenCalled();
  });

  it("revalidates the leader birth before escalating to SIGKILL", async () => {
    vi.useFakeTimers();
    const signal = vi.fn();
    const leaderAlive = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    try {
      await expect(
        drainTestRunTarget(TARGET, {
          probes: {
            isProcessAlive: leaderAlive,
            processBirthFingerprint: () => "armed-birth",
            processGroupAlive: () => true,
            signalGroup: signal,
            delay: async milliseconds => {
              await vi.advanceTimersByTimeAsync(milliseconds);
            },
          },
        })
      ).rejects.toThrow(/leader is absent.*refusing group signal/iu);
      expect(signal).toHaveBeenCalledTimes(1);
      expect(signal).toHaveBeenCalledWith(TARGET.pgid, "SIGTERM");
    } finally {
      vi.useRealTimers();
    }
  });
});
