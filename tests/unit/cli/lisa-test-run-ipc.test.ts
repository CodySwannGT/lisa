/** Ack/exit ordering controls for the parent-side protocol acknowledgement wait. */
import { fork, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { waitForMessage } from "../../../src/cli/lisa-test-run-ipc.js";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";

const ACK_FIXTURE = path.resolve(
  import.meta.dirname,
  "../../helpers/__fixtures__/ipc-ack-then-exit.mjs"
);
const RACE_ITERATIONS = 200;
const RACE_BATCH = 20;
const DISARMED = { schema: 1, type: "DISARMED" } as const;

/** Mutable child-process-shaped companion driven by explicit events. */
interface FakeCompanion extends EventEmitter {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  connected: boolean;
}

/**
 * Create a minimal evented companion for deterministic ordering controls.
 * @param exitCode - Initial terminal exit state
 * @param connected - Initial IPC channel state
 * @returns Child-process-shaped event emitter
 */
function fakeCompanion(
  exitCode: number | null = null,
  connected = true
): FakeCompanion {
  return Object.assign(new EventEmitter(), {
    exitCode,
    signalCode: null,
    connected,
  });
}

/**
 * Observe settlement within one macrotask, without waiting for a timeout.
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

/**
 * Fork the IPC fixture with the companion stdio shape the runtime uses.
 * @param mode - Fixture behaviour: "ack" or "no-ack"
 * @returns Forked protocol companion
 */
function forkCompanion(mode: "ack" | "no-ack"): ChildProcess {
  return fork(ACK_FIXTURE, [mode], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
}

/**
 * Run one real ack-then-exit companion and report how the wait settled.
 * @returns "resolved" or the rejection message
 */
async function ackThenExitOutcome(): Promise<string> {
  const child = forkCompanion("ack");
  const closed = new Promise<void>(resolve => child.once("close", resolve));
  const outcome = await waitForMessage(child, "DISARMED").then(
    () => "resolved",
    (error: Error) => error.message
  );
  await closed;
  return outcome;
}

describe("waitForMessage ack/exit ordering", () => {
  it("resolves when 'exit' is emitted before the queued acknowledgement", async () => {
    const child = fakeCompanion();
    const waiting = waitForMessage(
      child as unknown as ChildProcess,
      "DISARMED"
    );

    child.exitCode = 0;
    child.emit("exit", 0, null);
    child.emit("message", DISARMED);
    child.connected = false;
    child.emit("disconnect");
    child.emit("close", 0, null);

    await expect(waiting).resolves.toEqual(DISARMED);
  });

  it("keeps waiting while an exited companion's channel is still open", async () => {
    const child = fakeCompanion(0, true);
    const waiting = waitForMessage(
      child as unknown as ChildProcess,
      "DISARMED"
    );

    expect(await immediateSettlement(waiting)).toBe("pending");
    child.emit("message", DISARMED);
    await expect(waiting).resolves.toEqual(DISARMED);
  });

  it(
    "resolves every real companion that acks and exits in the send callback",
    async () => {
      const outcomes: string[] = [];
      for (let done = 0; done < RACE_ITERATIONS; done += RACE_BATCH) {
        const batch = Array.from({ length: RACE_BATCH }, ackThenExitOutcome);
        outcomes.push(...(await Promise.all(batch)));
      }

      expect(outcomes.filter(outcome => outcome !== "resolved")).toEqual([]);
      expect(outcomes).toHaveLength(RACE_ITERATIONS);
    },
    ioLatencyBudgetMs(120_000)
  );

  it("rejects a real companion that exits without acking and names how it exited", async () => {
    const child = forkCompanion("no-ack");

    await expect(waitForMessage(child, "DISARMED")).rejects.toThrow(
      "Protocol process exited before DISARMED (code 1, signal null)"
    );
  });

  it("rejects an already-closed companion without waiting for the ack timeout", async () => {
    const child = fakeCompanion(1, false);
    const waiting = waitForMessage(
      child as unknown as ChildProcess,
      "DISARMED"
    );

    expect(await immediateSettlement(waiting)).toBe("rejected");
    await expect(waiting).rejects.toThrow(
      "Protocol process exited before DISARMED (code 1, signal null)"
    );
  });
});
