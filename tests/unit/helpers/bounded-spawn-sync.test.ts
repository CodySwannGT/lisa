/**
 * The bounded child-process start, and the proof that its bound bites.
 *
 * Split out of `io-latency-budget.test.ts` because that file is at its
 * `max-lines` ceiling and the ceiling is a threshold, not a suggestion.
 *
 * CodySwannGT/lisa#2906: `assertChildCompleted` already existed and already
 * said the right thing, and four fixture spawns still shipped with no
 * `timeout:` at all — because nothing made the pair inseparable. An API that
 * cannot be called without both is the control; a doc comment asking for both
 * is not.
 * @module tests/unit/helpers/bounded-spawn-sync
 */
import { spawnSync } from "node:child_process";
import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  BOUNDED_SPAWN_BASE_MS,
  boundedSpawnSync,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

// Two cases here start a real child and wait for a real kill.
useIoLatencyBudget();

/** Label the planted-hang cases use, so the diagnostic can be matched by it. */
const PLANTED_LABEL = "a planted child";

/**
 * A child that blocks its own main thread and cannot be woken by anything the
 * parent does short of a signal. `Atomics.wait` rather than a timer, because a
 * timer would let the event loop drain and exit early on a slow box.
 */
const BLOCK_FOREVER =
  "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000)";

/**
 * A `spawnSync` stand-in that records the options it was handed.
 *
 * The budget arithmetic has to be provable without a slow machine, and the
 * only observable of a timeout that never fires is the number itself.
 * @param recorded - Sink the observed options are appended to
 * @returns A spawn function that records and then runs the real child
 */
function recordingSpawn(
  recorded: SpawnSyncOptionsWithStringEncoding[]
): typeof spawnSync {
  return ((command: string, args: string[], options: unknown) => {
    recorded.push(options as SpawnSyncOptionsWithStringEncoding);
    return spawnSync(
      command,
      args,
      options as SpawnSyncOptionsWithStringEncoding
    );
  }) as typeof spawnSync;
}
describe("boundedSpawnSync", () => {
  // CodySwannGT/lisa#2906. `assertChildCompleted` already existed and already
  // said the right thing — and four fixture spawns still shipped with no
  // `timeout:` at all, because nothing made the pair inseparable. An API that
  // cannot be called without both is the control; a doc comment asking for both
  // is not.

  it("derives the child budget from ioLatencyBudgetMs", () => {
    const recorded: SpawnSyncOptionsWithStringEncoding[] = [];

    boundedSpawnSync({
      label: "recorder",
      command: process.execPath,
      args: ["-e", ""],
      baseMs: 30_000,
      spawn: recordingSpawn(recorded),
    });

    expect(recorded[0]?.timeout).toBe(ioLatencyBudgetMs(30_000));
  });

  it("defaults to the recorded fixture-child base budget", () => {
    const recorded: SpawnSyncOptionsWithStringEncoding[] = [];

    boundedSpawnSync({
      label: "recorder",
      command: process.execPath,
      args: ["-e", ""],
      spawn: recordingSpawn(recorded),
    });

    expect(recorded[0]?.timeout).toBe(ioLatencyBudgetMs(BOUNDED_SPAWN_BASE_MS));
  });

  it("reaps with SIGKILL, because the hang it exists for was uninterruptible", () => {
    // The child observed for 15:04 in CodySwannGT/lisa#2906 sat at 0% CPU in
    // state `U`. A catchable signal is not obviously enough for that, and a
    // fixture child has no cleanup worth waiting for.
    const recorded: SpawnSyncOptionsWithStringEncoding[] = [];

    boundedSpawnSync({
      label: "recorder",
      command: process.execPath,
      args: ["-e", ""],
      spawn: recordingSpawn(recorded),
    });

    expect(recorded[0]?.killSignal).toBe("SIGKILL");
  });

  it("returns the child's own output when it completes", () => {
    const completed = boundedSpawnSync({
      label: "a child that answers",
      command: process.execPath,
      args: ["-e", "process.stdout.write('answered')"],
    });

    expect(completed.stdout).toBe("answered");
  });

  it("returns a non-zero exit rather than throwing, because that is a verdict", () => {
    // A gate that reports a failing project exits non-zero on purpose. Only a
    // kill is an infrastructure event; an exit code is the thing under test.
    const completed = boundedSpawnSync({
      label: "a child that refuses",
      command: process.execPath,
      args: ["-e", "process.exit(3)"],
    });

    expect(completed.status).toBe(3);
  });

  it("fails by name when a planted child outruns its budget", () => {
    expect(() =>
      boundedSpawnSync({
        label: PLANTED_LABEL,
        command: process.execPath,
        args: ["-e", BLOCK_FOREVER],
        baseMs: 1,
      })
    ).toThrow(new RegExp(`${PLANTED_LABEL} did not complete`, "u"));
  });

  it("does not describe a kill as a comparison of two strings", () => {
    // The whole point. A killed `spawnSync` hands back EMPTY streams, so
    // without this the case downstream fails with `expected '' to be ...` and
    // never mentions time.
    let message = "";
    try {
      boundedSpawnSync({
        label: PLANTED_LABEL,
        command: process.execPath,
        args: ["-e", BLOCK_FOREVER],
        baseMs: 1,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/did not complete/u);
    expect(message).not.toMatch(/expected/u);
  });

  it("passes the same case once the plant is removed", () => {
    expect(() =>
      boundedSpawnSync({
        label: PLANTED_LABEL,
        command: process.execPath,
        args: ["-e", ""],
      })
    ).not.toThrow();
  });
});
