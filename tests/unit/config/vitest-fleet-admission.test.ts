/**
 * Tests for the fleet's admission control and its honest denominator.
 *
 * ## Why the first arm is stated over ADMITTED demand
 *
 * The cap's middle layer divides the floor by the fleet size, "so the fleet's
 * total pool is bounded by the machine rather than multiplied by its own size".
 * On eighteen cores `floor(cores / 2 / fleet)` reaches the two-worker floor at a
 * fleet of five and stays there, so fleets of 5, 13, 20 and 50 all resolve to
 * two workers and the fleet's TOTAL demand is `2 x fleet` — 26 workers at
 * thirteen runs, 100 at fifty (CodySwannGT/lisa#3941).
 *
 * The existing suite checks the bound at fleet sizes 2, 3, 4, 6 and 9. Nine is
 * the last that holds: `2 x 9 = 18` is exactly the machine. **Ten breaks it.**
 * The shipped suite stops one step before the property fails, which is how the
 * defect survived a green test file.
 *
 * With a per-run floor that may not be lowered, no pool-sizing rule can bound a
 * sum over an unbounded number of runs. That is arithmetic, not a gap in the
 * divisor — which is why the fix is admission control and why the first arm is
 * stated over admitted demand rather than over `resolveMaxWorkers`.
 *
 * ## What each arm pins
 *
 *   1. Total demand stays under the machine at every fleet size, not only up to
 *      nine, and no run is sized below the measured minimum while it does.
 *   2. A run that cannot be given a safe share is HELD rather than shrunk, and
 *      says so. The control's own failure modes — unknown rank, disabled switch,
 *      expired deadline — all admit, because a load control that can prevent a
 *      run has become a correctness signal.
 *   3. **The control.** A single lane still runs at full width, and a machine too
 *      small to host one run at the minimum still admits. A fix that bounded
 *      demand by starving everyone would satisfy the arms above and be worse
 *      than the defect. The honest-denominator arm lives in
 *      `vitest-fleet-denominator.test.ts`.
 * @module tests/unit/config/vitest-fleet-admission
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_WORKERS,
  MIN_FLEET_WORKERS,
  fleetShare,
  resolveMaxWorkers,
  scratchGlobalSetup,
} from "../../../src/configs/vitest/base.js";
import {
  FLEET_ADMISSION_OFF,
  FLEET_ADMISSION_VAR,
  type FleetRunRoot,
  admissionDeadlineMs,
  admissionRank,
  admissionVerdict,
  admittedWorkerDemand,
  fleetCapacity,
} from "../../../src/configs/vitest/fleet-admission.js";
import {
  type AdmissionRuntime,
  awaitFleetAdmission,
} from "../../../src/configs/vitest/fleet-admission-global-setup.js";

/** The workstation the defect was measured on. */
const CORES = 18;

/**
 * Fleet sizes spanning the saturation point.
 *
 * Five is where the divisor first clamps; nine is the last size the shipped
 * suite checked; ten is the first that breaks the bound; fifty is the ticket's
 * own worked example.
 */
const FLEETS = [1, 2, 3, 4, 5, 6, 9, 10, 13, 20, 50] as const;

/**
 * A run root as the supervised runner actually names them.
 * @param pid - Owning process id encoded in the basename.
 * @param startedAt - Creation epoch encoded in the basename.
 * @returns One `run-<pid>-<epoch>-<suffix>` basename.
 */
const root = (pid: number, startedAt = 1788467384058): string =>
  `run-${String(pid)}-${String(startedAt)}-57071c2a`;

/** A runtime whose fleet, clock and output a test states outright. */
interface StatedRuntime {
  readonly runtime: AdmissionRuntime;
  readonly lines: string[];
  readonly waits: number[];
}

/**
 * A runtime that answers with a stated fleet and a clock the test advances.
 *
 * The clock advances only when the code waits, so a test states a timeline in
 * poll intervals instead of sleeping through one.
 * @param options - What the machine should report.
 * @param options.names - Live run-root basenames, per attempt; the last repeats.
 * @param options.self - This run's own root basename.
 * @param options.cores - Logical cores.
 * @param options.environment - Environment holding the switches.
 * @returns The runtime plus the lines and waits it recorded.
 */
const statedRuntime = (options: {
  names: readonly (readonly string[])[];
  self?: string;
  cores?: number;
  environment?: NodeJS.ProcessEnv;
}): StatedRuntime => {
  const lines: string[] = [];
  const waits: number[] = [];
  const attempts = { count: 0 };
  const clock = { ms: 0 };
  return {
    lines,
    waits,
    runtime: {
      liveNames: () => {
        const index = Math.min(attempts.count, options.names.length - 1);
        attempts.count += 1;
        return options.names[index] ?? [];
      },
      selfBasename: () => options.self,
      cores: () => options.cores ?? CORES,
      now: () => clock.ms,
      wait: (ms: number) => {
        waits.push(ms);
        clock.ms += ms;
        return Promise.resolve();
      },
      announce: (line: string) => {
        lines.push(line);
      },
      environment: options.environment ?? {},
    },
  };
};

describe("the fleet's total demand stays bounded past four runs", () => {
  it("keeps admitted demand within the machine at every fleet size", () => {
    // The property #3941 asks for. The shipped suite asserted it for fleets up
    // to nine, where `2 x 9 = 18` is exactly eighteen cores; ten is the first
    // size that breaks it, and the ticket's own example is fifty.
    const totals = FLEETS.map(fleet => admittedWorkerDemand(fleet, CORES));

    expect(totals.every(total => total <= CORES)).toBe(true);
  });

  it("is not achievable by pool sizing alone, which is why admission exists", () => {
    // Stated as a test so the reason is checked rather than asserted in prose:
    // the per-run share stops falling at the floor, so the product grows
    // linearly in the fleet size forever.
    const sizingOnly = FLEETS.map(fleet => fleetShare(CORES, fleet) * fleet);

    expect(sizingOnly.some(total => total > CORES)).toBe(true);
    expect(fleetShare(CORES, 50)).toBe(MIN_FLEET_WORKERS);
  });

  it("never sizes a run below the measured minimum while bounding the fleet", () => {
    // One worker is not a gentler version of two — it serialises the suite, and
    // the recorded result is 124 timeouts against 54. Bounding demand by going
    // below the floor would trade a visible failure for a subtler one.
    expect(
      FLEETS.every(fleet => fleetShare(CORES, fleet) >= MIN_FLEET_WORKERS)
    ).toBe(true);
  });

  it("admits as many runs as the machine can host at the minimum", () => {
    // Half of eighteen is nine; nine shared at two workers each is four runs.
    expect(fleetCapacity(CORES)).toBe(4);
    expect(fleetCapacity(64)).toBe(16);
  });

  it("runs the admission hook before the namespace sweep", () => {
    // The wiring, without which every assertion above describes code nothing
    // calls. Order is the contract: admission is the only hook that may decline
    // to start work.
    const [first] = scratchGlobalSetup();

    expect(first).toMatch(/fleet-admission-global-setup\.(?:js|ts)$/u);
    expect(scratchGlobalSetup()).toHaveLength(2);
  });
});

describe("a run that cannot be given a safe share is held, not shrunk", () => {
  /**
   * The facts a verdict is made from, with the test's own overrides applied.
   * @param over - Fields this case states differently.
   * @returns The verdict for those facts.
   */
  const verdict = (over: Partial<Parameters<typeof admissionVerdict>[0]>) =>
    admissionVerdict({
      rank: 5,
      capacity: 4,
      liveRuns: 6,
      elapsedMs: 0,
      deadlineMs: 120_000,
      enabled: true,
      ...over,
    });

  it("waits rather than starting the run at the minimum", () => {
    expect(verdict({}).admitted).toBe(false);
    expect(verdict({}).decision).toBe("wait");
  });

  it("says why it is waiting, and how to stop waiting", () => {
    // Legible to the operator rather than silent is half the acceptance
    // criterion; a control that queues a run without saying so reads as a hang.
    const notice = verdict({}).notice;

    expect(notice).toContain("waiting for a worker slot");
    expect(notice).toContain("6 run(s) live");
    expect(notice).toContain("#6");
    expect(notice).toContain("4 may execute at once");
    expect(notice).toContain(`${FLEET_ADMISSION_VAR}=${FLEET_ADMISSION_OFF}`);
  });

  it("starts anyway once the deadline expires, and says it is over capacity", () => {
    // A run that waits forever is worse than an overloaded machine: the agent
    // watching it sees a hang, kills it and retries, which is the cascade the
    // cap exists to stop, arriving through the control instead of around it.
    const expired = verdict({ elapsedMs: 120_000 });

    expect(expired.admitted).toBe(true);
    expect(expired.decision).toBe("admit-deadline-expired");
    expect(expired.notice).toContain("OVER CAPACITY");
  });

  it("ranks by age, so the queue drains oldest first and nothing starves", () => {
    const roots: readonly FleetRunRoot[] = [
      { basename: root(3, 300), pid: 3, startedAt: 300 },
      { basename: root(1, 100), pid: 1, startedAt: 100 },
      { basename: root(2, 200), pid: 2, startedAt: 200 },
    ];

    expect(admissionRank(roots, root(1, 100))).toBe(0);
    expect(admissionRank(roots, root(3, 300))).toBe(2);
  });

  it("breaks a same-millisecond tie deterministically", () => {
    // Lanes launched together routinely share a timestamp. Two runs must never
    // both believe they hold the same slot.
    const roots: readonly FleetRunRoot[] = [
      { basename: root(9, 100), pid: 9, startedAt: 100 },
      { basename: root(4, 100), pid: 4, startedAt: 100 },
    ];

    expect(admissionRank(roots, root(4, 100))).toBe(0);
    expect(admissionRank(roots, root(9, 100))).toBe(1);
  });

  it.each([
    ["the run has no rank of its own", { rank: undefined }],
    ["admission is switched off", { enabled: false }],
  ])("admits when %s", (_label, over) => {
    // Every unknown admits. This runs before a single test does, so a mistake
    // must be able to make the control weaker, never able to prevent a run.
    expect(verdict(over).admitted).toBe(true);
  });

  it("admits silently when it admits for a reason nobody needs to read", () => {
    expect(verdict({ rank: 0 }).notice).toBe("");
    expect(verdict({ enabled: false }).notice).toBe("");
  });
});

describe("the wait itself holds the run and then releases it", () => {
  it("waits while it is over capacity and admits once a slot frees", async () => {
    const busy = [
      root(1, 100),
      root(2, 200),
      root(3, 300),
      root(4, 400),
      root(5, 500),
    ];
    const stated = statedRuntime({
      names: [busy, busy, busy.slice(1)],
      self: root(5, 500),
    });

    const outcome = await awaitFleetAdmission(stated.runtime);

    expect(outcome.admitted).toBe(true);
    expect(stated.waits.length).toBeGreaterThan(0);
  });

  it("announces the queue once rather than on every poll", async () => {
    const busy = [
      root(1, 100),
      root(2, 200),
      root(3, 300),
      root(4, 400),
      root(5, 500),
    ];
    const stated = statedRuntime({
      names: [busy, busy, busy, busy.slice(1)],
      self: root(5, 500),
    });

    await awaitFleetAdmission(stated.runtime);

    expect(stated.lines).toHaveLength(1);
    expect(stated.lines[0]).toContain("waiting for a worker slot");
  });

  it("admits immediately when the switch is off, without waiting at all", async () => {
    const busy = [
      root(1, 100),
      root(2, 200),
      root(3, 300),
      root(4, 400),
      root(5, 500),
    ];
    const stated = statedRuntime({
      names: [busy],
      self: root(5, 500),
      environment: { [FLEET_ADMISSION_VAR]: FLEET_ADMISSION_OFF },
    });

    const outcome = await awaitFleetAdmission(stated.runtime);

    expect(outcome.admitted).toBe(true);
    expect(stated.waits).toHaveLength(0);
  });

  it("admits when reading the fleet throws, rather than preventing the run", async () => {
    const runtime: AdmissionRuntime = {
      liveNames: () => {
        throw new Error("namespace unreadable");
      },
      selfBasename: () => root(5, 500),
      cores: () => CORES,
      now: () => 0,
      wait: () => Promise.resolve(),
      announce: () => undefined,
      environment: {},
    };

    await expect(awaitFleetAdmission(runtime)).resolves.toMatchObject({
      admitted: true,
    });
  });

  it("reads the deadline an operator states, and ignores a malformed one", () => {
    expect(
      admissionDeadlineMs({ LISA_FLEET_ADMISSION_DEADLINE_MS: "5000" })
    ).toBe(5000);
    expect(
      admissionDeadlineMs({ LISA_FLEET_ADMISSION_DEADLINE_MS: "soon" })
    ).toBe(120_000);
  });
});

describe("the control: a lone run and a small machine are untouched", () => {
  it("leaves a single lane at full width", () => {
    // A fix that bounded total demand by starving everyone would satisfy every
    // arm above and be worse than the defect.
    expect(resolveMaxWorkers({}, CORES, () => 1)).toBe(DEFAULT_MAX_WORKERS);
    expect(admittedWorkerDemand(1, CORES)).toBeLessThanOrEqual(CORES);
  });

  it("admits the first run immediately, with nothing to say", () => {
    const stated = statedRuntime({
      names: [[root(5, 500)]],
      self: root(5, 500),
    });

    expect(stated.runtime.selfBasename()).toBe(root(5, 500));
    expect(
      admissionVerdict({
        rank: 0,
        capacity: 4,
        liveRuns: 1,
        elapsedMs: 0,
        deadlineMs: 120_000,
        enabled: true,
      })
    ).toEqual({ decision: "admit-alone", admitted: true, notice: "" });
  });

  it("never refuses every run on a machine too small to host one", () => {
    // Two cores: half is one, which cannot host a two-worker run. A capacity of
    // zero would refuse every run on every small CI runner.
    expect(fleetCapacity(2)).toBe(1);
    expect(fleetCapacity(1)).toBe(1);
  });

  it("still divides for the fleet sizes the shipped suite already checked", () => {
    // The pre-existing behaviour, unchanged: half of 18 is 9, shared by 3 runs.
    expect(resolveMaxWorkers({}, CORES, () => 3)).toBe(3);
    expect(resolveMaxWorkers({}, 64, () => 4)).toBe(8);
  });
});
