import type {
  SpawnSyncOptions,
  SpawnSyncReturns,
  spawnSync,
} from "node:child_process";
import type { ChildBudgetObservation } from "../../helpers/fresh-child-budget.js";
import type { TimedInvocation } from "../../helpers/timed-invocation.js";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  TestRunner,
  vi,
} from "vitest";
const p = vi.hoisted(() => ({
  now: 0,
  reference: 18,
  journal: [] as Array<{ kind: string } & Record<string, unknown>>,
}));
vi.mock("node:child_process", async original => ({
  ...(await original<typeof import("node:child_process")>()),
  spawnSync: (_command: string, _args: string[], options: SpawnSyncOptions) => {
    p.journal.push({
      kind: "reference",
      cost: p.reference,
      bound: options.timeout,
    });
    const bound = options.timeout ?? 0;
    p.now += Math.min(p.reference, bound);
    return p.reference < bound
      ? { status: 0, signal: null }
      : {
          status: null,
          signal: "SIGKILL",
          error: new Error("controlled reference timeout"),
        };
  },
}));
let helper: typeof import("../../helpers/io-latency-budget.js");
const key = Symbol.for("lisa.boundedChildInvocation.v1");
const scope = globalThis as unknown as Record<
  symbol,
  () => TimedInvocation | undefined
>;
let originalReader: () => TimedInvocation | undefined;
beforeAll(async () => {
  helper = await import("../../helpers/io-latency-budget.js");
  originalReader = scope[key]!;
});
afterAll(() => {
  Object.defineProperty(scope, key, { value: originalReader });
  console.log(
    `WINDOW_REGRESSION_JOURNAL ${JSON.stringify({
      classification:
        "VIRTUAL consumed age/reference/target inputs; actual Vitest effective invocation timeout/start; no OS processes",
      entries: p.journal,
    })}`
  );
});
/**
 * Control clock inputs while retaining the actual Vitest invocation override.
 * @param age - Virtual age of this actual invocation
 * @param reference - Virtual reference cost
 * @returns The actual registered invocation, before clock adaptation
 */
function control(age: number, reference: number) {
  const actual = originalReader();
  const task = TestRunner.getCurrentTest();
  if (!actual)
    throw Error(
      "Missing actual Vitest timed invocation; harness setup failure"
    );
  p.now = age;
  p.reference = reference;
  Object.defineProperty(scope, key, {
    value: () => ({ ...actual, nowMs: actual.startedAtMs + p.now }),
  });
  vi.spyOn(performance, "now").mockImplementation(() => p.now);
  if (task?.result?.startTime !== undefined)
    vi.spyOn(vi, "getRealSystemTime").mockImplementation(
      () => task.result!.startTime! + p.now
    );
  return actual;
}
/**
 * Exercise the unchanged real owner with a controlled transport primitive.
 * @param label - Journal identity
 * @param baseMs - Existing quiet child base
 * @param cost - Virtual healthy work or intentional noncompletion cost
 * @returns Actual owner decision and completion/refusal facts
 */
function child(label: string, baseMs = 6000, cost = 1) {
  let reading: ChildBudgetObservation | undefined;
  let dispatched: { bound: number; started: number } | undefined;
  let error: string | undefined;
  try {
    helper.boundedSpawnSync({
      label,
      command: process.execPath,
      args: [],
      baseMs,
      observeBudget: value => {
        reading = value;
      },
      spawn: ((
        _command: string,
        _args: string[],
        options: SpawnSyncOptions
      ) => {
        const bound = options.timeout ?? 0;
        dispatched = { bound, started: p.now };
        p.now += Math.min(cost, bound);
        return {
          pid: 0,
          status: cost <= bound ? 0 : null,
          signal: cost <= bound ? null : "SIGKILL",
          stdout: "healthy",
          stderr: "",
          output: [null, "healthy", ""],
          ...(cost <= bound
            ? {}
            : { error: new Error("controlled target timeout") }),
        } satisfies SpawnSyncReturns<string>;
      }) as typeof spawnSync,
    });
  } catch (e) {
    error = (e as Error).message;
  }
  const result = { label, reading, dispatched, error, finished: p.now };
  p.journal.push({ kind: "owner-result", ...result });
  return result;
}
describe("R1 actual owner late flat cases", () => {
  it.each([48000, 50000])(
    "admits healthy work at age%s without a total40percent cutoff",
    age => {
      control(age, 18);
      try {
        const r = child("late-flat");
        expect(r.error).toBeUndefined();
        expect(r.dispatched?.bound).toBe(6000);
        expect(r.finished).toBe(age + 19);
      } finally {
        vi.restoreAllMocks();
        Object.defineProperty(scope, key, { value: originalReader });
      }
    }
  );
  it("truly exhausted parent refuses before reference/target", () => {
    control(120000, 18);
    try {
      const before = p.journal.length;
      const r = child("exhausted");
      expect(r.error).toMatch(/headroom/);
      expect(r.dispatched).toBeUndefined();
      expect(p.journal.slice(before).some(x => x.kind === "reference")).toBe(
        false
      );
    } finally {
      vi.restoreAllMocks();
      Object.defineProperty(scope, key, { value: originalReader });
    }
  });
});
describe("R2 actual hook override and one consumed window", () => {
  let actual: TimedInvocation;
  let early: ReturnType<typeof child>;
  let late: ReturnType<typeof child>;
  let repeated: ReturnType<typeof child>;
  let exhausted: ReturnType<typeof child>;
  beforeAll(() => {
    actual = control(0, 72);
    try {
      early = child("hook-early", 400, 1);
      p.now = 9000;
      late = child("hook-late", 400, 10000);
      repeated = child("hook-repeated", 400, 10000);
      p.now = 10000;
      exhausted = child("hook-exhausted", 400);
    } finally {
      vi.restoreAllMocks();
      Object.defineProperty(scope, key, { value: originalReader });
    }
  }, 10000);
  it("the actual hook override reaches the budget decision", () => {
    expect(actual.timeoutMs).toBeCloseTo(10000, 9);
    expect(early.error).toBeUndefined();
    expect(early.reading!.parentBudgetMs).toBeCloseTo(10000, 9);
    expect(early.reading!.timeoutMs).toBeCloseTo(1600, 9);
  });
  it("late hook calibration and target stay before that same deadline", () => {
    expect(late.reading!.parentElapsedMs).toBe(9000);
    expect(late.reading!.calibrationMs).toBe(72);
    expect(late.finished).toBeLessThan(10000);
    expect(late.dispatched!.bound).toBeLessThan(928);
    expect(
      late.dispatched!.bound * 2.5 + late.reading!.calibrationMs
    ).toBeLessThanOrEqual(10000 - late.reading!.parentElapsedMs);
    expect(late.error).toMatch(/controlled target timeout/);
  });
  it("repeated call spends the original hook window rather than renewing", () => {
    expect(repeated.error).toBeDefined();
    expect(repeated.reading!.parentBudgetMs).toBeCloseTo(10000, 9);
    expect(repeated.reading!.parentElapsedMs).toBe(late.finished);
    expect(
      repeated.dispatched!.bound * 2.5 + repeated.reading!.calibrationMs
    ).toBeLessThanOrEqual(10000 - late.finished);
    expect(repeated.finished).toBeLessThan(10000);
    expect(exhausted.error).toMatch(/headroom/);
    expect(exhausted.dispatched).toBeUndefined();
  });
});
