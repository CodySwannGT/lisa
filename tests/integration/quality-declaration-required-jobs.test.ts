/**
 * The façade jobs whose built-in does NOT run for a project that declared
 * nothing, and the record that keeps that inversion from going quiet.
 *
 * `hardcoded-invocation-inventory.test.ts` already refuses a façade job with no
 * step that runs when the gate is unconfigured, because these job names are
 * branch-protection contexts and a required context whose every step is skipped
 * reports GREEN. That assertion is satisfiable while its intent is defeated: a
 * proving step gated on `configured == 'false' && <something else>` still
 * "runs when unconfigured" as far as a substring match can tell, and yet the
 * job reports green having proved nothing for every project failing the second
 * condition.
 *
 * `verification_coverage` is exactly that shape since CodySwannGT/lisa#3021,
 * deliberately: standing down when nothing declares `coverage-adequacy` is what
 * let its second adoption control (`verify_enforced`, default `false`) retire
 * without reddening the 20 of 22 callers that relied on that default.
 * Deliberate is fine. UNRECORDED is not — so the set is derived from the
 * shipped workflows and compared against the shipped table in both directions.
 *
 * Split from `hardcoded-invocation-inventory.test.ts` when that file crossed
 * the 300-line cap, along the seam it already had.
 * @module tests/integration/quality-declaration-required-jobs
 */
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { loadWorkflow } from "../helpers/workflow-test-utils.js";
import {
  FACADE_WORKFLOWS,
  NOT_CONFIGURED,
  REPORT_STEP,
  REPO_ROOT,
  loadGates,
} from "./hardcoded-invocation-fixture.js";
import type { GatesModule } from "./hardcoded-invocation-fixture.js";

/** The condition a stand-down job adds on top of "nothing is configured". */
const DECLARATION_PRESENT = "steps.declaration.outputs.present == 'true'";

/**
 * The façade jobs this file commits to finding a stand-down for.
 *
 * Committed rather than derived, for the reason
 * `tests/helpers/committed-case-table.ts` spells out: an `.each` over an
 * emptied table registers zero cases and reports green, and the set comparison
 * below is satisfied by both sides being empty — at its loudest exactly when
 * every stand-down has quietly gone. `[]` would be legitimate, and is the goal
 * once #3147 lands, but it has to be WRITTEN here to become so.
 */
const COMMITTED: readonly string[] = ["verification_coverage"];

let gates: GatesModule;

beforeAll(async () => {
  gates = await loadGates();
});

/**
 * Alphabetical order both sides of a set comparison are put into.
 * @param left One id.
 * @param right The other.
 * @returns Negative, zero or positive, per `localeCompare`.
 */
const byName = (left: string, right: string): number =>
  left.localeCompare(right);

/**
 * Every façade job whose proving steps all require a declaration, derived.
 * @returns Job ids, deduplicated and sorted.
 */
function derivedStandDowns(): string[] {
  const found: string[] = [];
  for (const file of FACADE_WORKFLOWS) {
    const workflow = loadWorkflow(path.join(REPO_ROOT, file));
    const entries = gates.HARDCODED_INVOCATIONS.filter(
      entry => entry.artifact === file
    );
    for (const entry of entries) {
      const proving = (workflow.jobs[entry.job as string]?.steps ?? []).filter(
        step =>
          step.name !== REPORT_STEP && (step.if ?? "").includes(NOT_CONFIGURED)
      );
      const standsDown =
        proving.length > 0 &&
        proving.every(step => (step.if ?? "").includes(DECLARATION_PRESENT));
      if (standsDown) found.push(entry.job as string);
    }
  }
  return [...new Set(found)].sort(byName);
}

describe("façade jobs that stand down instead of falling back", () => {
  it("records every one of them, in both directions", () => {
    // A second job acquiring the shape fails here naming itself; an entry whose
    // wiring went fails here too. Neither can happen in silence, which is the
    // property that survives the individual entries being retired.
    expect(derivedStandDowns()).toEqual(
      Object.keys(gates.DECLARATION_REQUIRED_JOBS).sort(byName)
    );
  });

  it("registers a case for exactly the committed stand-down keys", () => {
    expect(Object.keys(gates.DECLARATION_REQUIRED_JOBS).sort(byName)).toEqual(
      [...COMMITTED].sort(byName)
    );
  });

  it.each(COMMITTED)(
    "the %s stand-down names its gate, its reason and an owner",
    job => {
      const entry = gates.DECLARATION_REQUIRED_JOBS[job];
      expect(entry, `${job} is no longer recorded`).toBeDefined();
      // The gate comes from the shipped job→gate table rather than being
      // written twice, so the record cannot name a gate the job does not
      // resolve.
      expect(gates.QUALITY_JOB_GATES[job]).toBe(entry?.gate);
      // A one-word reason is a placeholder wearing a reason's clothes.
      expect(entry?.reason.length).toBeGreaterThanOrEqual(60);
      // The owner is what keeps the inversion from becoming permanent by
      // inattention. SHAPE ONLY — asserting the issue is open would put a
      // network call in this suite, which is worse than the hole it closes,
      // and a stale pointer is exactly how the predecessor table rotted
      // (CodySwannGT/lisa#3021).
      expect(entry?.owner).toMatch(/^#\d+$/u);
    }
  );
});
