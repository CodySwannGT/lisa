/**
 * The headroom rule (CodySwannGT/lisa#4596), with stated load, memory, clock
 * and reservations — no machine involved.
 */
import { describe, expect, it } from "vitest";

import {
  type AdmissionReservation,
  decideHeadroom,
  describeHolders,
  type HeadroomInput,
  recentlyReservedWorkers,
} from "../../../src/core/admission-decision.js";

const NOW = 1_800_000_000_000;

const thresholds = {
  maxLoadPerCore: 1,
  minFreeMemoryMb: 512,
  recentWindowMs: 60_000,
};

/**
 * A reservation admitted `ageMs` ago.
 * @param pid - Process id
 * @param workers - Granted workers
 * @param ageMs - Age in milliseconds
 * @returns Reservation
 */
const reservation = (
  pid: number,
  workers: number,
  ageMs: number
): AdmissionReservation => ({
  pid,
  processStartTime: null,
  workers,
  command: "bun run typecheck",
  cwd: `/repo-${String(pid)}`,
  startedAt: NOW - ageMs,
});

/**
 * A decision input with overrides.
 * @param overrides - Fields to replace
 * @returns Input
 */
const input = (overrides: Partial<HeadroomInput> = {}): HeadroomInput => ({
  reading: { cores: 10, load1: 0, freeMemoryMb: 8192 },
  reservations: [],
  now: NOW,
  workers: 4,
  minimumWorkers: 4,
  thresholds,
  ...overrides,
});

describe("decideHeadroom", () => {
  it("admits an idle machine with the declared workers", () => {
    expect(decideHeadroom(input())).toMatchObject({
      admit: true,
      granted: 4,
      headroom: 10,
    });
  });

  it("subtracts load1 as busy cores", () => {
    const decision = decideHeadroom(
      input({ reading: { cores: 10, load1: 7.5, freeMemoryMb: 8192 } })
    );
    expect(decision.admit).toBe(false);
    expect(decision.headroom).toBe(2);
    expect(decision.reason).toMatch(/needs 4 worker\(s\).*headroom is 2/u);
  });

  it("counts reservations from the last 60 s, which load1 cannot see yet", () => {
    const decision = decideHeadroom(
      input({
        reservations: [reservation(11, 4, 1_000), reservation(12, 4, 59_000)],
      })
    );
    expect(decision.admit).toBe(false);
    expect(decision.headroom).toBe(2);
  });

  it("ignores older reservations, whose work load1 already shows", () => {
    expect(
      decideHeadroom(input({ reservations: [reservation(11, 8, 60_000)] }))
        .admit
    ).toBe(true);
  });

  it("a first run's fresh reservation stops a second from double-admitting", () => {
    const exactlyOne = input({
      reading: { cores: 4, load1: 0, freeMemoryMb: 8192 },
    });
    const first = decideHeadroom(exactlyOne);
    expect(first.admit).toBe(true);
    const second = decideHeadroom({
      ...exactlyOne,
      reservations: [reservation(11, first.granted, 0)],
    });
    expect(second.admit).toBe(false);
  });

  it("sizes a sizable run to the headroom", () => {
    expect(
      decideHeadroom(
        input({
          reading: { cores: 10, load1: 7, freeMemoryMb: 8192 },
          minimumWorkers: 2,
        })
      )
    ).toMatchObject({ admit: true, granted: 3 });
  });

  it("waits below the minimum even when sizable", () => {
    expect(
      decideHeadroom(
        input({
          reading: { cores: 10, load1: 9, freeMemoryMb: 8192 },
          minimumWorkers: 2,
        })
      ).admit
    ).toBe(false);
  });

  it("clamps demand to the machine so a small host is not starved forever", () => {
    expect(
      decideHeadroom(
        input({
          reading: { cores: 2, load1: 0, freeMemoryMb: 8192 },
          workers: 8,
          minimumWorkers: 8,
        })
      )
    ).toMatchObject({ admit: true, granted: 2 });
  });

  it("honours maxLoadPerCore", () => {
    expect(
      decideHeadroom(
        input({ thresholds: { ...thresholds, maxLoadPerCore: 0.01 } })
      ).admit
    ).toBe(false);
  });

  it("waits while free memory is under the floor", () => {
    const decision = decideHeadroom(
      input({ reading: { cores: 10, load1: 0, freeMemoryMb: 100 } })
    );
    expect(decision.admit).toBe(false);
    expect(decision.reason).toMatch(/100 MB of memory is free/u);
  });
});

describe("recentlyReservedWorkers", () => {
  it("sums only the reservations inside the window", () => {
    expect(
      recentlyReservedWorkers(
        [
          reservation(1, 2, 0),
          reservation(2, 3, 30_000),
          reservation(3, 5, 90_000),
        ],
        NOW,
        60_000
      )
    ).toBe(5);
  });
});

describe("describeHolders", () => {
  it("names each run's pid, command, repository and workers", () => {
    expect(describeHolders([reservation(42, 4, 5_000)], NOW)).toBe(
      "pid 42: `bun run typecheck` in /repo-42 (4 worker(s), 5s ago)"
    );
  });

  it("says when no Lisa run holds the machine", () => {
    expect(describeHolders([], NOW)).toMatch(/no Lisa run holds/u);
  });
});
