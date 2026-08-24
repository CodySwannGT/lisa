/**
 * Tests for the gate's ONE adoption control.
 *
 * The gate used to carry a private three-state axis — `BDD_MODE`
 * (`not-adopted` / `bootstrap` / `enforced`) mirrored by an `adoption` block in
 * the coverage map — alongside the gate registry every other quality job
 * answers to. Two controls for one question, and the losing one lost silently.
 * `bootstrap`, the time-boxed grace period in the middle, was `optional`
 * carrying paperwork and it hid red; the owner retired it and the axis with it.
 *
 * Two properties are load-bearing here and each has a failure case below:
 *
 *  1. The retired axis is REFUSED, not ignored. A value someone deliberately
 *     set must never be silently inert — that is the failure the collapse was
 *     done to remove — and the refusal must name the retirement rather than
 *     send its author looking for a typo they did not make.
 *  2. Absence FAILS. GitHub counts a skipped required check as passing, so a
 *     gate that quietly no-ops when it finds nothing is worse than no gate.
 */
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import {
  HEALTHY_FEATURES,
  HEALTHY_FILES,
  HEALTHY_MAP,
  COMPLETED,
  INVALID,
  SCRIPT_ABS,
  codes,
  commitAll,
  emptyProject,
  healthyProject,
  hermeticEnv,
  makeProject,
  messages,
  runGate,
} from "./bdd/support";

const CONFIG_ABSENT = "config-absent";
const ADOPTION_RETIRED = "adoption-retired";

/**
 * Spawn the gate directly with a `BDD_MODE` set.
 *
 * Not through `runGate`, because the point is what the gate does BEFORE it
 * evaluates anything — but the environment is still the hermetic one every
 * other case uses. Inheriting the ambient environment here would let a
 * hook-set GIT_DIR / GIT_WORK_TREE redirect this fixture's git at the host
 * repository, which is what `hermeticEnv`'s own docstring exists to prevent.
 * @param root - Project root.
 * @param mode - The `BDD_MODE` value to pass.
 * @returns The spawn result.
 */
function runWithMode(root: string, mode: string) {
  return boundedSpawnSync({
    label: "check-bdd-coverage.mjs --json",
    command: process.execPath,
    args: [SCRIPT_ABS, "--json"],
    env: { ...hermeticEnv(root), BDD_COVERAGE_ROOT: root, BDD_MODE: mode },
  });
}

describe("one adoption control", () => {
  it("refuses BDD_MODE=bootstrap by name, so its author is not sent hunting a typo", () => {
    const result = runWithMode(makeProject({}), "bootstrap");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("retired");
    expect(result.stderr).toContain("grace period");
    // The remedy, not just the refusal: the three levels that replaced it.
    expect(result.stderr).toContain("required, optional, off");
  });

  it("refuses every other retired state too, each naming what it was", () => {
    for (const mode of ["not-adopted", "enforced"]) {
      const result = runWithMode(makeProject({}), mode);
      expect(result.status, mode).toBe(2);
      expect(result.stderr, mode).toContain("retired");
      expect(result.stderr, mode).toContain("required, optional, off");
    }
  });

  it("refuses a BDD_MODE that was never a state, without calling it a typo", () => {
    const result = runWithMode(makeProject({}), "enforce");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("BDD_MODE is retired");
  });

  it("runs normally when BDD_MODE is unset, because there is nothing to resolve", () => {
    const root = healthyProject();
    const run = runGate(root, { BDD_BASE_SHA: commitAll(root) });
    expect(run.status).toBe(0);
    expect(run.envelope.status).toBe(COMPLETED);
  });

  it("refuses a retired adoption block in the manifest, whatever it says", () => {
    for (const state of ["bootstrap", "enforced", "not-adopted"]) {
      const root = healthyProject({ adoption: { state } });
      const found = messages(runGate(root), ADOPTION_RETIRED);
      expect(found, state).toHaveLength(1);
      expect(found[0], state).toContain("retired");
      expect(found[0], state).toContain("Delete the block");
    }
  });

  it("refuses an adoption block with no state at all — the block itself is dead", () => {
    const root = healthyProject({ adoption: { owner: "someone" } });
    expect(codes(runGate(root))).toContain(ADOPTION_RETIRED);
  });

  it("reports no adoption finding once the block is gone", () => {
    const root = healthyProject();
    expect(codes(runGate(root, { BDD_BASE_SHA: commitAll(root) }))).toEqual([]);
  });
});

describe("absence fails, never skips", () => {
  it("FAILS when the coverage map is absent — absence is never a skip", () => {
    const run = runGate(makeProject({}));
    expect(run.status).toBe(1);
    expect(run.envelope.status).toBe(INVALID);
    expect(run.envelope.findings[0].code).toBe(CONFIG_ABSENT);
    expect(run.envelope.findings[0].message).toContain("never a skip");
    expect(run.envelope.reason).toContain(CONFIG_ABSENT);
  });

  it("FAILS on an empty project rather than reporting nothing to do", () => {
    const run = runGate(emptyProject("empty-"));
    expect(run.status).toBe(1);
    expect(codes(run)).toContain(CONFIG_ABSENT);
  });

  it("FAILS on a malformed coverage map", () => {
    const root = makeProject({ map: "{ not json" });
    const run = runGate(root);
    expect(run.status).toBe(1);
    expect(run.envelope.status).toBe(INVALID);
    expect(codes(run)).toContain("config-malformed");
  });

  it("FAILS on an unsupported coverage-map schema version", () => {
    const run = runGate(healthyProject({ schemaVersion: 99 }));
    expect(codes(run)).toContain("config-schema");
  });

  it("FAILS on zero scenarios and zero test mappings", () => {
    const root = makeProject({
      map: { ...HEALTHY_MAP, mappings: [], coverageFloor: { web: 0 } },
    });
    const run = runGate(root);
    expect(run.status).toBe(1);
    const found = messages(run, "empty-contract");
    expect(found.some(item => item.includes("zero scenarios"))).toBe(true);
    expect(found.some(item => item.includes("zero test mappings"))).toBe(true);
  });

  it("FAILS without a base revision, in every run rather than only some", () => {
    const root = makeProject({
      map: HEALTHY_MAP,
      features: HEALTHY_FEATURES,
      files: HEALTHY_FILES,
    });
    const run = runGate(root);
    expect(run.status).toBe(1);
    expect(codes(run)).toContain("baseline");
  });

  it("passes a healthy contract with a base revision", () => {
    const root = healthyProject();
    const run = runGate(root, { BDD_BASE_SHA: commitAll(root) });
    expect(run.envelope.findings).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.envelope.status).toBe(COMPLETED);
  });
});
