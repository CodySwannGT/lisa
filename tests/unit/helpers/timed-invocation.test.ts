import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";
import { currentTimedInvocation } from "../../helpers/timed-invocation.js";

describe("configured Vitest effective invocation owner", () => {
  beforeAll(async () => {
    const first = currentTimedInvocation();
    await Promise.resolve();
    expect(currentTimedInvocation().startedAtMs).toBe(first.startedAtMs);
    expect(currentTimedInvocation().timeoutMs).toBeCloseTo(
      ioLatencyBudgetMs(10000),
      9
    );
    return () => {
      expect(currentTimedInvocation().timeoutMs).toBeCloseTo(
        ioLatencyBudgetMs(10000),
        9
      );
    };
  }, ioLatencyBudgetMs(10000));
  beforeEach(async () => {
    await Promise.resolve();
    expect(currentTimedInvocation().timeoutMs).toBeCloseTo(
      ioLatencyBudgetMs(7000),
      9
    );
  }, ioLatencyBudgetMs(7000));
  afterEach(() => {
    expect(currentTimedInvocation().timeoutMs).toBeCloseTo(
      ioLatencyBudgetMs(8000),
      9
    );
  }, ioLatencyBudgetMs(8000));
  afterAll(() => {
    expect(currentTimedInvocation().timeoutMs).toBeCloseTo(
      ioLatencyBudgetMs(9000),
      9
    );
  }, ioLatencyBudgetMs(9000));

  it(
    "preserves the native invocation clock across test fake timers",
    () => {
      const first = currentTimedInvocation();
      vi.useFakeTimers();
      try {
        vi.advanceTimersByTime(50000);
        const later = currentTimedInvocation();
        expect(later.startedAtMs).toBe(first.startedAtMs);
        expect(later.timeoutMs).toBeCloseTo(ioLatencyBudgetMs(3000), 9);
        expect(later.nowMs - first.nowMs).toBeLessThan(50000);
      } finally {
        vi.useRealTimers();
      }
    },
    ioLatencyBudgetMs(3000)
  );
  it.concurrent(
    "retains its own actual invocation across an async sibling",
    async () => {
      const first = currentTimedInvocation();
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(currentTimedInvocation().timeoutMs).toBeCloseTo(
        ioLatencyBudgetMs(1000),
        9
      );
      expect(currentTimedInvocation().startedAtMs).toBe(first.startedAtMs);
    },
    ioLatencyBudgetMs(1000)
  );
  it.concurrent(
    "does not inherit the sibling's timeout",
    async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      expect(currentTimedInvocation().timeoutMs).toBeCloseTo(
        ioLatencyBudgetMs(2000),
        9
      );
    },
    ioLatencyBudgetMs(2000)
  );
});
