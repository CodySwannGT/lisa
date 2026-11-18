import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance as monotonicClock } from "node:perf_hooks";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runHealth,
  type AgenticHealthEvaluator,
} from "../../../src/health/agentic.js";
import { startCpuStopwatch } from "../../helpers/cpu-budget.js";
import {
  SUPERLINEAR_CPU_GUARD_MS,
  collect,
  deterministicResult,
  writeFixture,
} from "./agentic-fixtures.js";

/** Deadline the abort case configures, in virtual milliseconds. */
const ABORT_DEADLINE_MS = 500;

const mocks = vi.hoisted(() => ({
  deterministic: undefined as unknown,
  runDeterministic: vi.fn(),
}));

vi.mock("../../../src/health/deterministic.js", () => ({
  runDeterministicHealth: mocks.runDeterministic,
}));

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), "lisa-health-agentic-unit-"))
  );
  await writeFixture(projectRoot);
  mocks.deterministic = deterministicResult();
  mocks.runDeterministic.mockReset();
  mocks.runDeterministic.mockImplementation(async () => mocks.deterministic);
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("runHealth hostile evaluator degradation", () => {
  it.each<[string, AgenticHealthEvaluator]>([
    ["unavailable", async () => ({ status: "unavailable" })],
    [
      "throw",
      async () => Promise.reject(new Error("private evaluator failure")),
    ],
  ])(
    "returns the exact deterministic object when the evaluator is %s",
    async (_name, evaluator) => {
      expect(await collect(projectRoot, evaluator)).toBe(mocks.deterministic);
    }
  );

  /**
   * The deadline runs on a virtual clock, and that is the whole fix for
   * CodySwannGT/lisa#2516.
   *
   * `HealthDeadline` reads two clocks: `setTimeout` for expiry and
   * `node:perf_hooks` `performance.now()` for `remainingMs()`. Vitest's fake
   * timers replace the first and `globalThis.performance`, but NOT the
   * `node:perf_hooks` export — they are separate objects here, verified by
   * measurement — so the spy below is load-bearing rather than belt-and-braces.
   * Both clocks are pointed at the same virtual time, which makes the deadline
   * advance only when this test says so.
   *
   * That matters because the real failure was never the elapsed-time
   * assertion. Under starvation the 500ms deadline expired *during evidence
   * collection*, so `runHealth` degraded before the evaluator was ever
   * invoked, and the original test — which awaited a promise the evaluator
   * resolves — hung until vitest's 10,000ms limit. That is the reported
   * `10026ms`, a test timeout wearing an assertion's clothes. Reproduced 8 of 8
   * at load 54 with 144 vitest processes, failing on the evaluator-call count.
   *
   * Freezing the clock removes the race by construction: no amount of
   * scheduling delay can consume a budget that only advances on command. The
   * pre/post checks around the boundary then pin the deadline to the exact
   * millisecond, which no real-time assertion could ever state.
   */
  it("aborts a timed-out evaluator at its exact deadline and returns exact deterministic output", async () => {
    let aborted = false;
    let calls = 0;
    let liveAtEntry: boolean | undefined;
    let evaluatorEntered!: () => void;
    const entered = new Promise<void>(resolve => {
      evaluatorEntered = resolve;
    });

    vi.useFakeTimers();
    const clock = vi
      .spyOn(monotonicClock, "now")
      .mockImplementation(() => globalThis.performance.now());
    try {
      const stopwatch = startCpuStopwatch();
      const running = runHealth(projectRoot, {
        agentic: {
          enabled: true,
          timeoutMs: ABORT_DEADLINE_MS,
          evaluator: async (_request, signal) => {
            calls += 1;
            liveAtEntry = !signal.aborted;
            evaluatorEntered();
            return new Promise(resolve => {
              signal.addEventListener(
                "abort",
                () => {
                  aborted = true;
                  resolve({ status: "unavailable" });
                },
                { once: true }
              );
            });
          },
        },
      });
      await entered;

      await vi.advanceTimersByTimeAsync(ABORT_DEADLINE_MS - 1);
      expect(aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const result = await running;
      const elapsed = stopwatch.elapsed();

      expect(result).toBe(mocks.deterministic);
      expect(calls).toBe(1);
      expect(liveAtEntry).toBe(true);
      expect(aborted).toBe(true);
      expect(elapsed.cpuMs).toBeLessThan(SUPERLINEAR_CPU_GUARD_MS);
    } finally {
      clock.mockRestore();
      vi.useRealTimers();
    }
  });

  it("degrades when completed output exceeds the final 200-finding capacity", async () => {
    mocks.deterministic = deterministicResult(151);
    const result = await collect(projectRoot, async () => ({
      status: "completed",
      judgments: Array.from({ length: 50 }, (_unused, index) => ({
        check: `agentic.capacity-${index}`,
        reason: "Bounded warning.",
      })),
    }));

    expect(result).toBe(mocks.deterministic);
  });

  it("accepts completed output at the exact 200-finding capacity", async () => {
    mocks.deterministic = deterministicResult(150);
    const result = await collect(projectRoot, async () => ({
      status: "completed",
      judgments: Array.from({ length: 50 }, (_unused, index) => ({
        check: `agentic.capacity-${index}`,
        reason: "Bounded warning.",
      })),
    }));

    expect(result.mode).toBe("full");
    expect(result.findings).toHaveLength(200);
  });
});
