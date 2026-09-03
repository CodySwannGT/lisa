/**
 * Tests for how a run learns it is one of several.
 *
 * The cap shipped with three layers and only one of them reached anybody. Its
 * fleet divisor required `LISA_FLEET_CONCURRENCY`, and nothing set it — one
 * occurrence in the whole tree, at its own declaration — so every consumer got
 * the floor, and the layer that addresses multi-agent contention was inert by
 * default (CodySwannGT/lisa#3665).
 *
 * The load-bearing assertion here is the FIRST one: with nothing set, a run
 * that has live siblings must divide. That is what fails against the shipped
 * code, which returns the floor whatever else is running.
 *
 * The rest guard the direction this can do harm. Discovery reads a shared
 * directory on the config path of every run in every downstream project, so it
 * must never throttle a lone developer, never throw, and never treat an
 * abandoned root as a live competitor.
 * @module tests/unit/config/vitest-fleet-discovery
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_WORKERS,
  discoverFleetConcurrency,
  FLEET_CONCURRENCY_VAR,
  MAX_WORKERS_OVERRIDE_VAR,
  MIN_FLEET_WORKERS,
  resolveMaxWorkers,
} from "../../../src/configs/vitest/base.js";

/** The workstation the defect was measured on. */
const CORES = 18;

/** This test process, so a fixture can exclude it the way discovery does. */
const SELF = 4242;

/**
 * A run root as the supervised runner actually names them.
 *
 * The shape is copied from a live namespace rather than invented: a fixture
 * that does not parse would make every assertion below pass for the wrong
 * reason — discovery would count zero siblings either way.
 * @param pid - Owning process id encoded in the basename
 * @returns One `run-<pid>-<epoch>-<suffix>` basename.
 */
const root = (pid: number): string =>
  `run-${String(pid)}-1788467384058-57071c2a`;

/**
 * Discovery against a stated namespace rather than the real one.
 * @param names - Directory entries the namespace holds
 * @param alivePids - Which pids the kernel probe reports as live
 * @returns The discovered fleet size.
 */
const discover = (
  names: readonly string[],
  alivePids: readonly number[] = []
): number =>
  discoverFleetConcurrency({
    namespaceDir: () => "/nowhere",
    readDir: () => names,
    isAlive: (pid: number) => alivePids.includes(pid),
    self: SELF,
  });

describe("a run with nothing set still divides when siblings are live", () => {
  it("counts live sibling runs and includes itself", () => {
    // THE regression assertion. Against the shipped code this whole path did
    // not exist and the resolver returned the floor regardless of siblings.
    expect(discover([root(11), root(22)], [11, 22])).toBe(3);
  });

  it("divides the floor by the discovered count with no environment at all", () => {
    // Half of 18 is 9; 9 shared between 3 runs is 3 each. Nothing is exported.
    const workers = resolveMaxWorkers({}, CORES, () => 3);

    expect(workers).toBe(3);
    expect(workers).not.toBe(DEFAULT_MAX_WORKERS);
  });

  it("bounds the fleet's total pool at every fleet size it can discover", () => {
    // Each run's share times the fleet size must stay within the machine, or
    // the cap still multiplies by N and the 21x sighting returns at a larger N.
    const totals = [2, 3, 4, 6, 9].map(
      fleet => (resolveMaxWorkers({}, CORES, () => fleet) as number) * fleet
    );

    expect(totals.every(total => total <= CORES)).toBe(true);
  });
});

describe("discovery does not throttle a run that is alone", () => {
  it("returns 1 for an empty namespace", () => {
    expect(discover([])).toBe(1);
  });

  it("leaves a lone run on the floor", () => {
    expect(resolveMaxWorkers({}, CORES, () => 1)).toBe(DEFAULT_MAX_WORKERS);
  });

  it("ignores its own run root, whichever order the config loads in", () => {
    // The config may load before or after this run registers its own root.
    // Both orders must give the same answer, so our pid is excluded rather
    // than subtracted — subtracting would undercount by one in one order.
    expect(discover([root(SELF)])).toBe(1);
    expect(discover([root(SELF), root(11)], [11])).toBe(2);
  });

  it("ignores an abandoned root whose owner is gone", () => {
    // A killed run leaves its root behind. Counting it would throttle every
    // subsequent run for a fleet that no longer exists.
    expect(discover([root(11), root(22)], [11])).toBe(2);
  });

  it("ignores entries that are not run roots", () => {
    expect(discover(["notes.txt", "lisa-gate-run-abc", root(11)], [11])).toBe(
      2
    );
  });
});

describe("discovery fails open, because it runs on the config path", () => {
  it("returns 1 when the namespace cannot be read", () => {
    // A throw here does not degrade a test run, it prevents one.
    const reading = (): number =>
      discoverFleetConcurrency({
        namespaceDir: () => "/nowhere",
        readDir: () => {
          throw new Error("ENOENT: no such file or directory");
        },
        self: SELF,
      });

    expect(reading).not.toThrow();
    expect(reading()).toBe(1);
  });

  it("returns 1 when the liveness probe is refused by the platform", () => {
    const reading = (): number =>
      discoverFleetConcurrency({
        namespaceDir: () => "/nowhere",
        readDir: () => [root(11)],
        isAlive: () => {
          throw new Error("ENOSYS");
        },
        self: SELF,
      });

    expect(reading).not.toThrow();
    expect(reading()).toBe(1);
  });

  it("reads the real namespace when nothing is injected", () => {
    // The default path is what production uses; a test that only ever injects
    // proves the injected path and nothing else.
    const live = discoverFleetConcurrency();

    expect(Number.isInteger(live)).toBe(true);
    expect(live).toBeGreaterThanOrEqual(1);
  });
});

describe("a stated fleet size outranks what discovery sees", () => {
  it("prefers the stated count over the observed one", () => {
    // "We are six" describes an intent — six runs are coming, even if only two
    // have started. A count of what is live must not contradict it.
    expect(
      resolveMaxWorkers({ [FLEET_CONCURRENCY_VAR]: "6" }, CORES, () => 2)
    ).toBe(MIN_FLEET_WORKERS);
  });

  it("does not consult discovery at all when a count is stated", () => {
    const consulted = { current: false };
    resolveMaxWorkers({ [FLEET_CONCURRENCY_VAR]: "3" }, CORES, () => {
      consulted.current = true;
      return 9;
    });

    expect(consulted.current).toBe(false);
  });

  it("falls back to discovery when the stated value is malformed", () => {
    // A typo is no information, not a fleet of one. Reading it as either would
    // silently disable the layer this issue exists to make reachable.
    expect(
      resolveMaxWorkers({ [FLEET_CONCURRENCY_VAR]: "six" }, CORES, () => 3)
    ).toBe(3);
  });

  it("lets the override outrank both, in either direction", () => {
    expect(
      resolveMaxWorkers({ [MAX_WORKERS_OVERRIDE_VAR]: "17" }, CORES, () => 6)
    ).toBe(17);
    expect(
      resolveMaxWorkers({ [MAX_WORKERS_OVERRIDE_VAR]: "1" }, CORES, () => 6)
    ).toBe(1);
  });

  it("never lets discovery serialise a run, however many siblings it finds", () => {
    expect(resolveMaxWorkers({}, CORES, () => 500)).toBe(MIN_FLEET_WORKERS);
  });
});
