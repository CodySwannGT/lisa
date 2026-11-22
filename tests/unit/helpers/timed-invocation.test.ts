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
import { currentTimedInvocation } from "../../helpers/timed-invocation.js";

describe("configured Vitest effective invocation owner", () => {
  beforeAll(async () => {
    const first = currentTimedInvocation();
    await Promise.resolve();
    expect(currentTimedInvocation().startedAtMs).toBe(first.startedAtMs);
    expect(currentTimedInvocation().timeoutMs).toBeCloseTo(10000, 9);
    return () => {
      expect(currentTimedInvocation().timeoutMs).toBeCloseTo(10000, 9);
    };
  }, 10000);
  beforeEach(async () => {
    await Promise.resolve();
    expect(currentTimedInvocation().timeoutMs).toBeCloseTo(7000, 9);
  }, 7000);
  afterEach(() => {
    expect(currentTimedInvocation().timeoutMs).toBeCloseTo(8000, 9);
  }, 8000);
  afterAll(() => {
    expect(currentTimedInvocation().timeoutMs).toBeCloseTo(9000, 9);
  }, 9000);

  it("preserves the native invocation clock across test fake timers", () => {
    const first = currentTimedInvocation();
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(50000);
      const later = currentTimedInvocation();
      expect(later.startedAtMs).toBe(first.startedAtMs);
      expect(later.timeoutMs).toBeCloseTo(3000, 9);
      expect(later.nowMs - first.nowMs).toBeLessThan(50000);
    } finally {
      vi.useRealTimers();
    }
  }, 3000);
  it.concurrent(
    "retains its own actual invocation across an async sibling",
    async () => {
      const first = currentTimedInvocation();
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(currentTimedInvocation().timeoutMs).toBeCloseTo(1000, 9);
      expect(currentTimedInvocation().startedAtMs).toBe(first.startedAtMs);
    },
    1000
  );
  it.concurrent(
    "does not inherit the sibling's timeout",
    async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      expect(currentTimedInvocation().timeoutMs).toBeCloseTo(2000, 9);
    },
    2000
  );
});
