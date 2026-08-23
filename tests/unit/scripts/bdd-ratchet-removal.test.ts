/**
 * The acceptance test for removing the BDD coverage-floor ratchet.
 *
 * Deleting a ratchet deletes the non-regression property it was providing, so
 * the bar for removing one is that every route it closed is still closed by
 * something named. Each row below is one of those routes. Every fixture
 * commits a floor the deleted ratchet would have been perfectly content with,
 * so nothing here passes because the number happened to move.
 *
 * The invariants themselves are exercised in `bdd-nonregression.test.ts`; this
 * file only asks whether anything got easier.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  BASELINE,
  COVERAGE_REGRESSION,
  FLOOR_INVALID,
  FLOOR_MISSING,
  FLOOR_REGRESSION,
  OBLIGATION_UNCOVERED,
  RATIFIED,
  SCENARIO_DELETED,
  WEB,
  codes,
  featureSource,
  messages,
  runGate,
} from "./bdd/support";
import {
  EXTRA_FEATURE_FILE,
  EXTRA_KEY,
  EXTRA_RETIREMENT,
  HOME_KEY,
  HOME_ONLY_MAPPINGS,
  twoScenarioProject,
} from "./bdd/regression-support";

/** One route out of the contract, and the check that still refuses it. */
interface Vector {
  readonly name: string;
  readonly code: string;
  readonly run: () => ReturnType<typeof runGate>;
}

/**
 * Run the gate over a fixture whose head coverage map was patched.
 * @param patch - Shallow overrides applied to the head coverage map.
 * @returns The gate run.
 */
function afterMapEdit(
  patch: Record<string, unknown>
): ReturnType<typeof runGate> {
  const { root, base } = twoScenarioProject(patch);
  return runGate(root, { BDD_BASE_SHA: base });
}

/**
 * Run the gate over a fixture whose head feature files were patched.
 * @param edit - Mutation applied to the head working tree.
 * @returns The gate run.
 */
function afterTreeEdit(
  edit: (root: string) => void
): ReturnType<typeof runGate> {
  const { root, base } = twoScenarioProject({}, edit);
  return runGate(root, { BDD_BASE_SHA: base });
}

const VECTORS: readonly Vector[] = [
  {
    name: "drop the coverage AND lower the floor to zero in one change",
    code: COVERAGE_REGRESSION,
    run: () =>
      afterMapEdit({
        mappings: HOME_ONLY_MAPPINGS,
        coverageFloor: { [WEB]: 0 },
      }),
  },
  {
    name: "remove a platform's floor entirely",
    code: FLOOR_MISSING,
    run: () => afterMapEdit({ coverageFloor: {} }),
  },
  {
    name: "quote the floor so it stops being evaluated",
    code: FLOOR_INVALID,
    run: () => afterMapEdit({ coverageFloor: { [WEB]: "0" } }),
  },
  {
    name: "delete the scenario instead of retiring it",
    code: SCENARIO_DELETED,
    run: () =>
      afterTreeEdit(root =>
        fs.rmSync(path.join(root, "bdd", "features", EXTRA_FEATURE_FILE))
      ),
  },
  {
    name: "ship new behavior nobody mapped or waived",
    code: OBLIGATION_UNCOVERED,
    run: () =>
      afterTreeEdit(root =>
        fs.writeFileSync(
          path.join(root, "bdd", "features", "third.feature"),
          featureSource("Third", [
            { id: "BDD-THIRD-001", tags: [WEB, RATIFIED] },
          ])
        )
      ),
  },
  {
    name: "run with no base revision, so nothing can be compared",
    code: BASELINE,
    run: () => runGate(twoScenarioProject().root),
  },
];

describe("nothing became easier to regress when the ratchet was deleted", () => {
  for (const vector of VECTORS) {
    it(`still refuses: ${vector.name}`, () => {
      const run = vector.run();
      expect(codes(run), vector.name).toContain(vector.code);
      expect(run.status, vector.name).toBe(1);
    });
  }

  it("releases exactly one thing: nudging the number when nothing regressed", () => {
    // This is the churn the removal was for — a pull request whose entire
    // content is moving a floor. It now costs nothing and proves nothing,
    // because the coverage it used to stand in for is checked directly.
    const run = afterMapEdit({ coverageFloor: { [WEB]: 0 } });
    expect(run.envelope.findings).toEqual([]);
    expect(run.status).toBe(0);
  });

  it("keeps the absolute bar: a platform below its floor still fails", () => {
    const { root, base } = twoScenarioProject({
      mappings: HOME_ONLY_MAPPINGS,
      coverageFloor: { [WEB]: 100 },
      retirements: [EXTRA_RETIREMENT],
    });
    const run = runGate(root, {
      BDD_BASE_SHA: base,
    });
    expect(messages(run, COVERAGE_REGRESSION)).toEqual([]);
    expect(codes(run)).toContain(FLOOR_REGRESSION);
    expect(run.status).toBe(1);
  });

  it("names the obligation it is talking about, not just a percentage", () => {
    // The ratchet could only ever say "the number went down". Telling an
    // operator which behavior lost its proof is the point of the replacement.
    const run = afterMapEdit({ mappings: HOME_ONLY_MAPPINGS });
    const finding = run.envelope.findings.find(
      item => item.code === COVERAGE_REGRESSION
    );
    expect(finding?.subject).toBe(EXTRA_KEY);
    expect(finding?.subject).not.toBe(HOME_KEY);
  });
});
