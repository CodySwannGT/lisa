import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  spawnSync,
  SpawnSyncOptions,
  SpawnSyncReturns,
} from "node:child_process";
import {
  containingChildWindow,
  runBoundedChild,
} from "../../helpers/bounded-child-runner.js";
import type { ChildBudgetObservation } from "../../helpers/fresh-child-budget.js";

import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";

const CASE_LIMIT = ioLatencyBudgetMs(1_000);
const CAPTURE_AGE = CASE_LIMIT - 100;

const profile = vi.hoisted(() => ({
  now: 0,
  references: 0,
  journal: [] as unknown[],
}));
vi.mock("node:child_process", async original => ({
  ...(await original<typeof import("node:child_process")>()),
  spawnSync: () => {
    profile.references++;
    profile.now += 18;
    return { status: 0, signal: null };
  },
}));
let helper: typeof import("../../helpers/io-latency-budget.js");
const key = Symbol.for("lisa.boundedChildInvocation.v1");
const scope = globalThis as unknown as Record<
  symbol,
  () => { startedAtMs: number; nowMs: number; timeoutMs: number }
>;
let originalReader: (typeof scope)[symbol];
beforeAll(async () => {
  helper = await import("../../helpers/io-latency-budget.js");
  originalReader = scope[key]!;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(scope, key, { value: originalReader });
});
afterAll(() => {
  console.log(
    `DEADLINE_GAP_JOURNAL ${JSON.stringify({ classification: "CONTROLLED VIRTUAL gap/reference/target; actual Vitest1000ms invocation owner; no OS processes", entries: profile.journal })}`
  );
});

describe.each([false, true])(
  "immutable invocation transfer, fakeTimers=%s",
  fake => {
    it.each([0, 40, 100])(
      "charges capture-to-admission gap%s to the original deadline",
      gap => {
        const actual = originalReader!();
        const epoch = 1700000000000;
        let reading: ChildBudgetObservation | undefined;
        let bound: number | undefined;
        let failure: Error | undefined;
        expect(actual.timeoutMs).toBeCloseTo(CASE_LIMIT, 9);
        profile.now = CAPTURE_AGE;
        profile.references = 0;
        if (fake) {
          vi.useFakeTimers();
          vi.spyOn(vi, "getRealSystemTime").mockImplementation(
            () => epoch + profile.now
          );
        } else
          vi.spyOn(performance, "now").mockImplementation(() => profile.now);
        Object.defineProperty(scope, key, {
          value: () => ({ ...actual, nowMs: actual.startedAtMs + profile.now }),
        });
        const window = containingChildWindow(false, 1 / 2.5, 0.5);
        if (!window) throw new Error("Expected a timed case");
        const policy = {
          baseMs: 40,
          quietReferenceMs: 18,
          maxSlowdown: 8,
          referenceDeadlineMs: 30000,
          ...window,
        };
        profile.now += gap;
        try {
          runBoundedChild(
            {
              label: "deadline-gap",
              command: process.execPath,
              args: [],
              observeBudget: value => {
                reading = value;
              },
              spawn: ((_command, _args, options) => {
                bound = options!.timeout as number;
                profile.now += 1;
                return {
                  pid: 0,
                  output: [null, "healthy", ""],
                  stdout: "healthy",
                  stderr: "",
                  status: 0,
                  signal: null,
                } satisfies SpawnSyncReturns<string>;
              }) as typeof spawnSync,
            },
            policy,
            helper.assertChildCompleted
          );
        } catch (e) {
          failure = e as Error;
        }
        profile.journal.push({
          fake,
          gap,
          capturedAge: CAPTURE_AGE,
          actualInvocationStartedAtMs: actual.startedAtMs,
          actualInvocationDeadlineMs: actual.startedAtMs + actual.timeoutMs,
          policy,
          reading,
          bound,
          failure: failure?.message,
          references: profile.references,
          finishedVirtualMs: profile.now,
        });
        if (gap === 100) {
          expect(failure?.message).toMatch(/headroom/);
          expect(profile.references).toBe(0);
          expect(bound).toBeUndefined();
        } else {
          expect(failure).toBeUndefined();
          expect(profile.references).toBe(1);
          expect(bound).toBe(gap === 40 ? 16 : 32);
          expect(bound! * 2.5).toBeLessThanOrEqual(
            CASE_LIMIT - (CAPTURE_AGE + gap + 18)
          );
          expect(profile.now).toBe(CAPTURE_AGE + gap + 19);
        }
      },
      CASE_LIMIT
    );
  }
);

describe("scaled deadline at target dispatch", () => {
  it.each([
    [40, 22],
    [62, undefined],
  ])("charges a %sms delay after selection", (delay, expectedTimeout) => {
    profile.now = 0;
    profile.references = 0;
    let ticks = 0;
    const now = () => {
      if (++ticks === 5) profile.now += delay;
      return profile.now;
    };
    const policy = {
      baseMs: 80,
      quietReferenceMs: 18,
      maxSlowdown: 8,
      referenceDeadlineMs: 100,
      parentBudgetMs: 160,
      parentElapsedMs: 0,
      parentShare: 0.5,
      parentTotalMargin: true,
      parentScope: "controlled parent window",
      parentWindow: {
        startedAtMs: 0,
        deadlineMs: 160,
        capturedAtMs: 0,
        nativeStartedAtMs: 0,
        nativeDeadlineMs: 160,
        clockDomain: "performance" as const,
        now,
      },
    };
    const spawn = vi.fn(
      (_command: string, _args: string[], options: SpawnSyncOptions) => ({
        pid: 0,
        output: [null, String(options.timeout), ""],
        stdout: String(options.timeout),
        stderr: "",
        status: 0,
        signal: null,
      })
    );
    const run = () =>
      runBoundedChild(
        {
          label: "dispatch gap",
          command: process.execPath,
          args: [],
          spawn: spawn as unknown as typeof spawnSync,
        },
        policy,
        helper.assertChildCompleted
      );

    if (expectedTimeout === undefined) {
      expect(run).toThrow(/no child was dispatched/);
      expect(spawn).not.toHaveBeenCalled();
    } else {
      expect(run().stdout).toBe(String(expectedTimeout));
    }
    expect(profile.references).toBe(1);
  });
});
