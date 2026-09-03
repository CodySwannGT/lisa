/**
 * Tests for the Vitest worker-pool cap every stack inherits.
 *
 * Vitest sizes its pool to the machine, not to what else is running on it, so
 * *k* concurrent agents claimed *k* × cores. Measured on one 18-core
 * workstation: `load1` 378, 38 live vitest processes, and gates that stopped
 * returning verdicts and started being terminated by signal
 * (CodySwannGT/lisa#3630).
 *
 * The assertions that carry weight are the two the issue calls falsifiable.
 * First, that the cap is BOUNDED INDEPENDENTLY OF N — a cap that shrinks each
 * run's pool but still multiplies by fleet size has not fixed anything. Second,
 * that the divisor never reaches one worker: a serialised suite makes every
 * file wait behind every other file, which is how `--maxWorkers=4` produced 124
 * timeouts against the default's 54 (`vitest.config.local.ts`). A smaller
 * number is not automatically a safer one, and this suite is what stops a
 * future tightening from trading a visible kill for an invisible timeout.
 *
 * The structural test at the end is the regression control from the issue's
 * Validation Journey: it walks the shipped stack factories rather than trusting
 * this module, so the cap cannot silently vanish from a preset while the
 * resolver's own unit tests stay green.
 * @module tests/unit/config/vitest-worker-cap
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_WORKERS,
  FLEET_CONCURRENCY_VAR,
  MAX_WORKERS_OVERRIDE_VAR,
  MIN_FLEET_WORKERS,
  resolveMaxWorkers,
} from "../../../src/configs/vitest/base.js";

/** The workstation the defect was measured on. */
const CORES = 18;

/** Stack factories that ship to downstream projects. */
const SHIPPED_STACKS = [
  "typescript",
  "nestjs",
  "cdk",
  "phaser",
  "harper-fabric",
] as const;

/**
 * Resolve against a stated environment rather than the test runner's own.
 *
 * Injected, never mutated: a suite that sets a real environment variable leaks
 * it into every file sharing the worker, and the assertion then depends on
 * collection order.
 * @param environment - The environment the run is to be resolved against
 * @param cores - Logical cores to resolve against; defaults to the measured host
 * @returns The resolved `maxWorkers` value.
 */
const resolve = (
  environment: NodeJS.ProcessEnv,
  cores = CORES
): number | string => resolveMaxWorkers(environment, cores);

describe("resolveMaxWorkers: the floor an uninstructed run gets", () => {
  it("caps a run that sets nothing at all", () => {
    // The only layer that reaches a run nobody configured, which is most of
    // them. Before this, a downstream project's preset set no worker option of
    // any kind and each run claimed roughly one worker per core.
    expect(resolve({})).toBe("50%");
  });

  it("states the floor as a proportion, so a small CI runner is not starved", () => {
    // A constant tuned for an 18-core workstation is either useless on a
    // 2-core runner or ruinous on a 64-core one. The proportion travels.
    expect(DEFAULT_MAX_WORKERS).toBe("50%");
  });

  it("ignores an empty fleet signal rather than treating it as a divisor", () => {
    expect(resolve({ [FLEET_CONCURRENCY_VAR]: "" })).toBe("50%");
  });

  it("ignores a malformed fleet signal instead of guessing at it", () => {
    // `two` is not one worker and it is not two workers; it is no information.
    // Reading it as either would be a cap derived from a typo.
    expect(resolve({ [FLEET_CONCURRENCY_VAR]: "two" })).toBe("50%");
    expect(resolve({ [FLEET_CONCURRENCY_VAR]: "-4" })).toBe("50%");
    expect(resolve({ [FLEET_CONCURRENCY_VAR]: "0" })).toBe("50%");
  });

  it("leaves a lone run on the floor when the fleet is one", () => {
    // A fleet of one is a developer. Dividing by it would throttle the exact
    // case `vitest.config.local.ts:55` measured as WORSE under a smaller pool.
    expect(resolve({ [FLEET_CONCURRENCY_VAR]: "1" })).toBe("50%");
  });
});

describe("resolveMaxWorkers: the fleet divisor", () => {
  it("divides the floor by the number of runs sharing the machine", () => {
    // Half of 18 is 9; 9 shared between 3 runs is 3 each.
    expect(resolve({ [FLEET_CONCURRENCY_VAR]: "3" })).toBe(3);
  });

  it("bounds the FLEET's total pool, not merely each run's", () => {
    // The load-bearing property, and the one a naive smaller constant fails.
    // Each run's share times the fleet size must stay under the machine, for
    // every fleet size — otherwise the cap still multiplies by N and the 21x
    // sighting comes straight back at a larger N.
    const totals = [2, 3, 4, 6, 9].map(
      fleet =>
        (resolve({ [FLEET_CONCURRENCY_VAR]: String(fleet) }) as number) * fleet
    );

    expect(totals.every(total => total <= CORES)).toBe(true);
  });

  it("never serialises a run, however large the fleet", () => {
    // One worker is not a gentler version of two: it makes every file wait
    // behind every other file, so per-test budgets start expiring even as
    // machine load falls. That is the recorded 124-vs-54 failure.
    expect(resolve({ [FLEET_CONCURRENCY_VAR]: "500" })).toBe(MIN_FLEET_WORKERS);
    expect(MIN_FLEET_WORKERS).toBe(2);
  });

  it("scales the share with the machine, not with the workstation it was measured on", () => {
    // Half of 64 is 32; 32 shared between 4 runs is 8 each.
    expect(resolve({ [FLEET_CONCURRENCY_VAR]: "4" }, 64)).toBe(8);
  });
});

describe("resolveMaxWorkers: the override", () => {
  it("raises the pool above the checked-in floor", () => {
    // A cap nobody can lift is a cap that gets worked around by deleting it.
    expect(resolve({ [MAX_WORKERS_OVERRIDE_VAR]: "18" })).toBe(18);
  });

  it("lowers the pool below the checked-in floor", () => {
    expect(resolve({ [MAX_WORKERS_OVERRIDE_VAR]: "2" })).toBe(2);
  });

  it("outranks the fleet divisor rather than being combined with it", () => {
    // Two signals that both narrow the pool would silently compound; an
    // operator who states 12 must get 12, not 12 divided by anything.
    expect(
      resolve({
        [MAX_WORKERS_OVERRIDE_VAR]: "12",
        [FLEET_CONCURRENCY_VAR]: "6",
      })
    ).toBe(12);
  });

  it("falls back to the floor when the override is malformed", () => {
    expect(resolve({ [MAX_WORKERS_OVERRIDE_VAR]: "lots" })).toBe("50%");
    expect(resolve({ [MAX_WORKERS_OVERRIDE_VAR]: "0" })).toBe("50%");
  });

  it("is not below the fleet minimum when the operator asks for one worker", () => {
    // The minimum bounds the DIVISOR, not the operator. Someone debugging a
    // race explicitly wants a single worker and must be able to say so.
    expect(resolve({ [MAX_WORKERS_OVERRIDE_VAR]: "1" })).toBe(1);
  });
});

describe("every shipped stack preset carries the cap", () => {
  // The regression control. `resolveMaxWorkers` being correct proves nothing
  // about a downstream project unless the factory that project imports calls
  // it — and the gap this issue found was exactly that: the resolver's value
  // existed in one repo's local config while all six shipped presets set no
  // worker option at all.
  it.each(SHIPPED_STACKS)("%s wires maxWorkers to the resolver", stack => {
    const source = readFileSync(
      path.join(process.cwd(), "src/configs/vitest", `${stack}.ts`),
      "utf8"
    );

    expect(source).toContain("maxWorkers: resolveMaxWorkers()");
  });

  it("leaves no preset setting a literal worker count", () => {
    // A literal would resolve once, at authoring time, and never see the fleet
    // signal or the override — a cap that is present, plausible, and inert.
    const literals = SHIPPED_STACKS.flatMap(stack =>
      [
        ...readFileSync(
          path.join(process.cwd(), "src/configs/vitest", `${stack}.ts`),
          "utf8"
        ).matchAll(/maxWorkers:[^\n]*/g),
      ]
        .map(match => match[0])
        .filter(line => line !== "maxWorkers: resolveMaxWorkers(),")
        .map(line => `${stack}: ${line}`)
    );

    expect(literals).toEqual([]);
  });
});
