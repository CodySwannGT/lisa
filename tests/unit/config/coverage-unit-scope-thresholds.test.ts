/**
 * A unit-scoped coverage run can be measured against a unit-scoped floor.
 *
 * `test:cov:unit` is `test:cov` with the integration tree excluded from test
 * DISCOVERY — but nothing excludes the source those integration tests were the
 * only cover for, so the denominator is unchanged while the numerator shrinks.
 * The two runs report different percentages over the same code, and both were
 * checked against one `global` block.
 *
 * The defect is not that the number was wrong. It is that one number was FORCED
 * to answer for two populations: a project whose unit run legitimately cannot
 * reach the full-suite floor had exactly one lever, and pulling it lowered the
 * floor its CI `test:cov` run answers to as well. Fixing a push that goes red on
 * unchanged code therefore meant weakening the gate everywhere.
 *
 * So the narrower scope gets its own block. It is deliberately NOT given a lower
 * default — a default that loosened anything would be a threshold reduction
 * arriving as a bug fix, and Lisa cannot know from here which projects have
 * source that only integration tests cover. With no `unit` block declared the
 * scope inherits the effective global floor, exactly as before; what changes is
 * that declaring one is now possible without touching the other population.
 *
 * `LISA_COVERAGE_SCOPE=unit` is the marker that makes the block apply, set by
 * the pinned `test:cov:unit` script. It is also what the push hook checks
 * before selecting that script — a unit run with no marker has no floor of its
 * own, and the hook falls back rather than measure one scope against another's.
 * @module tests/unit/config/coverage-unit-scope-thresholds
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  COVERAGE_SCOPE_ENV,
  isUnitCoverageScope,
  UNIT_COVERAGE_SCOPE,
} from "../../../src/configs/coverage-scope.js";
import { mergeThresholds as jestMergeThresholds } from "../../../src/configs/jest/base.js";
import { mergeThresholds } from "../../../src/configs/vitest/base.js";

/** The floor a stack config supplies before any project override. */
const DEFAULTS = {
  global: { statements: 70, branches: 70, functions: 70, lines: 70 },
} as const;

afterEach(() => {
  delete process.env[COVERAGE_SCOPE_ENV];
});

describe("the unit coverage scope marker", () => {
  it("names the variable the pinned unit script sets", () => {
    expect(COVERAGE_SCOPE_ENV).toBe("LISA_COVERAGE_SCOPE");
    expect(UNIT_COVERAGE_SCOPE).toBe("unit");
  });

  it("is off unless the variable says exactly unit", () => {
    expect(isUnitCoverageScope()).toBe(false);
    process.env[COVERAGE_SCOPE_ENV] = "";
    expect(isUnitCoverageScope()).toBe(false);
    process.env[COVERAGE_SCOPE_ENV] = "integration";
    expect(isUnitCoverageScope()).toBe(false);
    process.env[COVERAGE_SCOPE_ENV] = " unit ";
    expect(isUnitCoverageScope()).toBe(true);
  });
});

describe("vitest thresholds under the unit scope", () => {
  it("enforces a declared unit block when the scope is unit", () => {
    process.env[COVERAGE_SCOPE_ENV] = UNIT_COVERAGE_SCOPE;

    const merged = mergeThresholds(DEFAULTS, { unit: { lines: 55 } });

    expect(merged.global).toEqual({
      statements: 70,
      branches: 70,
      functions: 70,
      lines: 55,
    });
  });

  it("leaves the full-suite floor untouched by that same declaration", () => {
    // The whole point: lowering the unit floor must not lower the floor the
    // CI `test:cov` run answers to.
    const merged = mergeThresholds(DEFAULTS, { unit: { lines: 55 } });

    expect(merged.global).toEqual({
      statements: 70,
      branches: 70,
      functions: 70,
      lines: 70,
    });
  });

  it("inherits the effective global floor when no unit block is declared", () => {
    // No silent loosening for the fleet: a project that declares nothing is
    // measured exactly as it was, including its own raised global.
    process.env[COVERAGE_SCOPE_ENV] = UNIT_COVERAGE_SCOPE;

    const merged = mergeThresholds(DEFAULTS, { global: { lines: 85 } });

    expect(merged.global).toMatchObject({ lines: 85, statements: 70 });
  });

  it("lets a raised global raise the unit floor with it", () => {
    process.env[COVERAGE_SCOPE_ENV] = UNIT_COVERAGE_SCOPE;

    const merged = mergeThresholds(DEFAULTS, {
      global: { lines: 85, branches: 85 },
      unit: { branches: 60 },
    });

    expect(merged.global).toMatchObject({ lines: 85, branches: 60 });
  });

  it("never hands the runner a `unit` key it would read as a path glob", () => {
    // Vitest and Jest both treat any non-`global` key as a path or glob to
    // scope thresholds to. A `unit` key surviving into the config would have
    // them looking for a directory called `unit` — a threshold that is not
    // enforced and does not complain, rather than an error.
    process.env[COVERAGE_SCOPE_ENV] = UNIT_COVERAGE_SCOPE;
    expect(
      mergeThresholds(DEFAULTS, { unit: { lines: 55 } })
    ).not.toHaveProperty("unit");
    delete process.env[COVERAGE_SCOPE_ENV];
    expect(
      mergeThresholds(DEFAULTS, { unit: { lines: 55 } })
    ).not.toHaveProperty("unit");
  });

  it("keeps a project's per-path threshold entries", () => {
    const merged = mergeThresholds(DEFAULTS, {
      "src/legacy/**": { lines: 10 },
    });

    expect(merged["src/legacy/**"]).toEqual({ lines: 10 });
  });
});

describe("jest thresholds under the unit scope", () => {
  it("enforces a declared unit block when the scope is unit", () => {
    process.env[COVERAGE_SCOPE_ENV] = UNIT_COVERAGE_SCOPE;

    const merged = jestMergeThresholds(DEFAULTS, { unit: { lines: 55 } });

    expect(merged?.global).toEqual({
      statements: 70,
      branches: 70,
      functions: 70,
      lines: 55,
    });
  });

  it("leaves the full-suite floor untouched by that same declaration", () => {
    const merged = jestMergeThresholds(DEFAULTS, { unit: { lines: 55 } });

    expect(merged?.global).toMatchObject({ lines: 70 });
  });

  it("never hands the runner a `unit` key it would read as a path glob", () => {
    process.env[COVERAGE_SCOPE_ENV] = UNIT_COVERAGE_SCOPE;

    expect(
      jestMergeThresholds(DEFAULTS, { unit: { lines: 55 } })
    ).not.toHaveProperty("unit");
  });
});
