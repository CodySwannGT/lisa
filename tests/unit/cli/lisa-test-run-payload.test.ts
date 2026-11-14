/** The plain payload runner relays signals and reports how the payload ended. */
import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  FORWARDED_SIGNALS,
  runTestPayload,
} from "../../../src/cli/lisa-test-run-payload.js";

/** A child process double that records the signals it is sent. */
class FakeChild extends EventEmitter {
  readonly signals: NodeJS.Signals[] = [];

  /**
   * Record a signal instead of delivering it.
   * @param signal - The signal sent
   * @returns Always true, as a delivered signal would
   */
  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return true;
  }
}

/**
 * Spawn seam that hands back one fake child and records the call.
 * @returns The seam, the child and the recorded calls
 */
function fakeSpawn() {
  const child = new FakeChild();
  const calls: {
    command: string;
    args: readonly string[];
    options: SpawnOptions;
  }[] = [];
  const spawnChild = (
    command: string,
    args: readonly string[],
    options: SpawnOptions
  ): ChildProcess => {
    calls.push({ command, args, options });
    return child as unknown as ChildProcess;
  };
  return { child, calls, spawnChild };
}

describe("runTestPayload", () => {
  it("spawns the payload with inherited stdio and the given environment", async () => {
    const { child, calls, spawnChild } = fakeSpawn();
    const signalSource = new EventEmitter();
    const environment = { LISA_TEST_RUN_OWNER: "1:0" };
    const outcome = runTestPayload(["node", "suite.mjs"], environment, {
      spawnChild,
      signalSource: signalSource as unknown as NodeJS.Process,
    });
    child.emit("exit", 23, null);
    await expect(outcome).resolves.toEqual({ code: 23, signal: null });
    expect(calls).toEqual([
      {
        command: "node",
        args: ["suite.mjs"],
        options: { stdio: "inherit", env: environment },
      },
    ]);
  });

  it("relays every forwarded signal to the payload and detaches after exit", async () => {
    const { child, spawnChild } = fakeSpawn();
    const signalSource = new EventEmitter();
    const outcome = runTestPayload(
      ["node"],
      {},
      {
        spawnChild,
        signalSource: signalSource as unknown as NodeJS.Process,
      }
    );
    for (const signal of FORWARDED_SIGNALS) signalSource.emit(signal, signal);
    expect(child.signals).toEqual([...FORWARDED_SIGNALS]);
    child.emit("exit", null, "SIGTERM");
    await expect(outcome).resolves.toEqual({ code: null, signal: "SIGTERM" });
    for (const signal of FORWARDED_SIGNALS) {
      expect(signalSource.listenerCount(signal)).toBe(0);
    }
  });

  it("rejects when the payload cannot be started, and detaches", async () => {
    const { child, spawnChild } = fakeSpawn();
    const signalSource = new EventEmitter();
    const outcome = runTestPayload(
      ["missing-binary"],
      {},
      {
        spawnChild,
        signalSource: signalSource as unknown as NodeJS.Process,
      }
    );
    child.emit("error", new Error("spawn missing-binary ENOENT"));
    await expect(outcome).rejects.toThrow(/ENOENT/);
    expect(signalSource.listenerCount("SIGTERM")).toBe(0);
  });

  it("runs a real payload and returns its exit code", async () => {
    const outcome = await runTestPayload(
      [process.execPath, "-e", "process.exit(7)"],
      process.env
    );
    expect(outcome).toEqual({ code: 7, signal: null });
  });

  it("returns the signal that ended a real payload", async () => {
    const outcome = await runTestPayload(
      [process.execPath, "-e", 'process.kill(process.pid, "SIGTERM")'],
      process.env
    );
    expect(outcome).toEqual({ code: null, signal: "SIGTERM" });
  });
});
