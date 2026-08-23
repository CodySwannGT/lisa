/**
 * The bounded `execFileSync` replacement, and the proof it keeps both halves.
 *
 * `execFileSync` differs from `spawnSync` in exactly one way that callers
 * depend on: a non-zero exit THROWS, carrying the exit code, `stdout` and
 * `stderr` on the error. A conversion that dropped that would turn every "assert this
 * command fails" case into a silent pass, so the replacement has to reproduce
 * it — while still failing by name when the child is killed by its own budget
 * rather than by its own exit code.
 *
 * The distinction matters because the two look identical downstream:
 * CodySwannGT/lisa#2940. A killed child hands back EMPTY streams, so a caller
 * that only sees `stdout` cannot tell a timeout from a command that printed
 * nothing. Only the thrown diagnostic separates them.
 * @module tests/unit/helpers/bounded-exec-file-sync
 */
import type {
  spawnSync,
  SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  BOUNDED_SPAWN_BASE_MS,
  boundedExecFileSync,
  boundedSpawnSync,
  ioLatencyBudgetMs,
  ChildFailure,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

// Two cases here start a real child and wait for a real kill.
useIoLatencyBudget();

/** Label the planted-hang case uses, so the diagnostic can be matched by it. */
const PLANTED_LABEL = "a planted exec child";

/**
 * A child that blocks its own main thread and cannot be woken by anything the
 * parent does short of a signal. `Atomics.wait` rather than a timer, because a
 * timer would let the event loop drain and exit early on a slow box.
 */
const BLOCK_FOREVER =
  "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000)";

/**
 * A `spawnSync` stand-in that records the options it was handed.
 * @param recorded - Sink the observed options are appended to
 * @returns A spawn function that records and then runs the real child
 */
function recordingSpawn(
  recorded: SpawnSyncOptionsWithStringEncoding[]
): typeof spawnSync {
  return ((command: string, args: string[], options: unknown) => {
    recorded.push(options as SpawnSyncOptionsWithStringEncoding);
    // No child at all. Every case using this seam asserts on the options the
    // helper derived, never on output, and starting a real child here would
    // put an unbounded spawn inside the guard against unbounded spawns.
    return {
      pid: 0,
      output: [],
      stdout: "",
      stderr: "",
      status: 0,
      signal: null,
    };
  }) as unknown as typeof spawnSync;
}

describe("boundedExecFileSync", () => {
  it("returns the child's stdout when it succeeds", () => {
    expect(
      boundedExecFileSync({
        label: "a child that answers",
        command: process.execPath,
        args: ["-e", "process.stdout.write('answered')"],
      })
    ).toBe("answered");
  });

  it("throws on a non-zero exit, the way execFileSync does", () => {
    expect(() =>
      boundedExecFileSync({
        label: "a child that refuses",
        command: process.execPath,
        args: ["-e", "process.exit(3)"],
      })
    ).toThrow(/Command failed/u);
  });

  it("carries the exit code, stdout and stderr on the thrown error", () => {
    // Callsites assert on all three. A conversion that threw a bare Error
    // would compile and would silently make those assertions unreachable.
    let failure: unknown;
    try {
      boundedExecFileSync({
        label: "a child that refuses loudly",
        command: process.execPath,
        args: [
          "-e",
          "process.stdout.write('out');process.stderr.write('err');process.exit(7)",
        ],
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ChildFailure);
    if (!(failure instanceof ChildFailure)) return;
    expect(failure.exitCode).toBe(7);
    expect(failure.stdout).toBe("out");
    expect(failure.stderr).toBe("err");
  });

  it("fails by name when a planted child outruns its budget", () => {
    expect(() =>
      boundedExecFileSync({
        label: PLANTED_LABEL,
        command: process.execPath,
        args: ["-e", BLOCK_FOREVER],
        baseMs: 1,
      })
    ).toThrow(new RegExp(`${PLANTED_LABEL} did not complete`, "u"));
  });

  it("does not present a kill as a non-zero exit", () => {
    // The whole reason the completion assertion runs BEFORE the status check:
    // a killed child reports `status: null` and empty streams, which reads
    // exactly like a command that failed quietly.
    let message = "";
    try {
      boundedExecFileSync({
        label: PLANTED_LABEL,
        command: process.execPath,
        args: ["-e", BLOCK_FOREVER],
        baseMs: 1,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/did not complete/u);
    expect(message).not.toMatch(/Command failed/u);
  });

  it("derives the child budget from ioLatencyBudgetMs", () => {
    const recorded: SpawnSyncOptionsWithStringEncoding[] = [];

    boundedExecFileSync({
      label: "recorder",
      command: process.execPath,
      args: ["-e", ""],
      spawn: recordingSpawn(recorded),
    });

    expect(recorded[0]?.timeout).toBe(ioLatencyBudgetMs(BOUNDED_SPAWN_BASE_MS));
  });
});

describe("boundedSpawnSync option passthrough", () => {
  it("passes stdio through, so a converted callsite keeps its streams", () => {
    const recorded: SpawnSyncOptionsWithStringEncoding[] = [];

    boundedSpawnSync({
      label: "recorder",
      command: process.execPath,
      args: ["-e", ""],
      stdio: "ignore",
      spawn: recordingSpawn(recorded),
    });

    expect(recorded[0]?.stdio).toBe("ignore");
  });

  it("passes maxBuffer through, because a truncated stream is a lie", () => {
    // `execFileSync` throws ENOBUFS past its default 1MB. Several converted
    // callsites read a whole `git ls-files` of this repository and had raised
    // the ceiling deliberately; dropping it would reintroduce a failure that
    // reports a content problem rather than a size one.
    const recorded: SpawnSyncOptionsWithStringEncoding[] = [];

    boundedSpawnSync({
      label: "recorder",
      command: process.execPath,
      args: ["-e", ""],
      maxBuffer: 64 * 1024 * 1024,
      spawn: recordingSpawn(recorded),
    });

    expect(recorded[0]?.maxBuffer).toBe(64 * 1024 * 1024);
  });
});
