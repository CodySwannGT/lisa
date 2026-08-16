/**
 * Tests that a gate declared `off` actually turns its CI job off.
 *
 * It did not. `resolveMoment` dropped an `off` gate entirely, so the façade saw
 * no entry and wrote `configured=false` — the same value it writes for a gate
 * the project never mentioned. The fallback step fired on `!= 'true'`, which
 * both states satisfy, so Lisa's built-in tooling ran regardless of the
 * declaration.
 *
 * That is harmless where the fallback reproduces what the project already did,
 * and it is not harmless for `test-node-suites`, whose fallback FAILS on zero
 * collected. Measured downstream: `PropSwapLLC/frontend` and
 * `geminisportsai/backend-v2` both declared it `off`, both validated clean
 * locally, and both went red — one of them on a deploy.
 *
 * A declaration that governs nothing is worse than no declaration, because it
 * reads as a decision that was taken.
 * @module tests/integration/quality-gate-off-state
 */

import { describe, expect, it } from "vitest";

import { resolveMoment } from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  CONVERTED,
  NOT_CONFIGURED,
  resolveStep,
  stepNamed,
} from "./quality-gate-facade-fixture.js";

/** The moment these declarations are made at. */
const PULL_REQUEST = "pull-request";

describe("the resolver distinguishes declared-off from never-declared", () => {
  const gates = {
    "test-node-suites": { [PULL_REQUEST]: "off" },
    "code-style": { [PULL_REQUEST]: "required", run: "lint" },
  };

  it("hides an off gate from the runners by default", () => {
    // Every consumer that RUNS these entries must keep seeing an off gate as
    // absent, or turning a gate off would start executing it.
    expect(
      resolveMoment({ gates, moment: PULL_REQUEST }).map(g => g.id)
    ).toEqual(["code-style"]);
  });

  it("reports it on request, with no task attached", () => {
    const off = resolveMoment({
      gates,
      moment: PULL_REQUEST,
      includeOff: true,
    }).find(g => g.id === "test-node-suites");
    expect(off?.level).toBe("off");
    expect(off?.task).toBeNull();
    expect(off?.command).toBeNull();
  });

  it("still reports nothing for a gate never mentioned", () => {
    // The distinction only means something if the two answers differ.
    expect(
      resolveMoment({ gates: {}, moment: PULL_REQUEST, includeOff: true })
    ).toEqual([]);
  });
});

describe("every façade job asks for the off state and acts on it", () => {
  it.each(CONVERTED)("$job requests gates declared off", ({ job }) => {
    expect(resolveStep(job)?.run).toContain("--include-off");
  });

  it.each(CONVERTED)("$job emits a third state for an off gate", ({ job }) => {
    expect(resolveStep(job)?.run).toContain("configured=off");
  });

  it.each(CONVERTED)(
    "$job's fallback fires only on false, never on off",
    ({ job, fallbackSteps }) => {
      // `!= 'true'` is the bug: `off` satisfies it, so the built-in tooling ran
      // against a declaration that said not to.
      for (const name of fallbackSteps) {
        const condition = stepNamed(job, name)?.if ?? "";
        expect(condition).toContain(NOT_CONFIGURED);
        expect(condition).not.toContain("configured != 'true'");
      }
    }
  );

  it.each(CONVERTED)(
    "$job runs the project's task only when configured true",
    ({ job, gateStep }) => {
      expect(stepNamed(job, gateStep)?.if).toContain(
        "steps.gate.outputs.configured == 'true'"
      );
    }
  );
});

describe("an off gate reaches neither branch", () => {
  it.each(CONVERTED)(
    "$job has no step that would run when configured is off",
    ({ job, gateStep, fallbackSteps }) => {
      // The property in one assertion: with configured=off, the gate step's
      // condition is false and every fallback condition is false, so the job
      // runs no gate work at all and reports green having correctly done
      // nothing — which is what the project asked for.
      const conditions = [gateStep, ...fallbackSteps].map(
        name => stepNamed(job, name)?.if ?? ""
      );
      for (const condition of conditions) {
        expect(condition).not.toContain("configured != 'true'");
        expect(condition).not.toContain("configured != 'false'");
      }
    }
  );
});
