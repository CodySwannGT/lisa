/**
 * Tests for the coverage-floor ratchet and the scenario-deletion check.
 *
 * Both defend the denominator. Lowering the bar and deleting the behavior are
 * the same move by two routes, so both require the same two artifacts one
 * author cannot produce alone: an in-repo record naming the exact change, and
 * a maintainer-applied label.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  BASELINE_LABEL,
  ENFORCED,
  EXTRA_ID,
  FLOOR_RATCHET,
  SCENARIO_DELETED,
  RATIFIED,
  WEB,
  codes,
  commitAll,
  featureSource,
  healthyProject,
  messages,
  readMap,
  runGate,
  writeMap,
} from "./bdd/support";

/** A complete, valid baseline-update record for the 100 -> 0 reduction. */
const BASELINE_RECORD = {
  platform: WEB,
  from: 100,
  to: 0,
  reason: "the web runner was retired",
  ticket: "TUN-9",
  approvedBy: "cody",
  runUrl: "https://github.com/o/r/actions/runs/1",
  recordedAt: "2026-08-12",
};

/**
 * Commit a healthy project, then mutate its coverage map.
 * @param mutate - Patch applied to the map after the base commit.
 * @returns Project root and base SHA.
 */
function ratchetProject(mutate: (map: Record<string, unknown>) => void): {
  readonly root: string;
  readonly base: string;
} {
  const root = healthyProject({ coverageFloor: { [WEB]: 100 } });
  const base = commitAll(root);
  const map = readMap(root);
  mutate(map);
  writeMap(root, map);
  return { root, base };
}

describe("coverage floor ratchet", () => {
  it("allows the floor to stay put or rise", () => {
    const { root, base } = ratchetProject(() => undefined);
    const run = runGate(root, { BDD_MODE: ENFORCED, BDD_BASE_SHA: base });
    expect(messages(run, FLOOR_RATCHET)).toEqual([]);
    expect(run.status).toBe(0);
  });

  it("REFUSES a floor reduction made in the same pull request", () => {
    const { root, base } = ratchetProject(map => {
      (map.coverageFloor as Record<string, number>)[WEB] = 0;
    });
    const run = runGate(root, { BDD_MODE: ENFORCED, BDD_BASE_SHA: base });
    expect(run.status).toBe(1);
    const found = messages(run, FLOOR_RATCHET);
    expect(
      found.some(item => item.includes("coverageFloorBaseline record"))
    ).toBe(true);
    expect(found.some(item => item.includes(BASELINE_LABEL))).toBe(true);
  });

  it("refuses removing a platform's floor entirely", () => {
    const { root, base } = ratchetProject(map => {
      delete (map.coverageFloor as Record<string, number>)[WEB];
    });
    const run = runGate(root, { BDD_MODE: ENFORCED, BDD_BASE_SHA: base });
    expect(
      messages(run, FLOOR_RATCHET).some(item => item.includes("was removed"))
    ).toBe(true);
  });

  it("refuses the maintainer label alone, without a baseline record", () => {
    const { root, base } = ratchetProject(map => {
      (map.coverageFloor as Record<string, number>)[WEB] = 0;
    });
    const run = runGate(root, {
      BDD_MODE: ENFORCED,
      BDD_BASE_SHA: base,
      BDD_PR_LABELS: BASELINE_LABEL,
    });
    expect(
      messages(run, FLOOR_RATCHET).some(item =>
        item.includes("coverageFloorBaseline record")
      )
    ).toBe(true);
  });

  it("refuses the baseline record alone, without the maintainer label", () => {
    const { root, base } = ratchetProject(map => {
      (map.coverageFloor as Record<string, number>)[WEB] = 0;
      map.coverageFloorBaseline = [BASELINE_RECORD];
    });
    const run = runGate(root, { BDD_MODE: ENFORCED, BDD_BASE_SHA: base });
    expect(
      messages(run, FLOOR_RATCHET).some(item => item.includes(BASELINE_LABEL))
    ).toBe(true);
  });

  it("refuses an incomplete baseline record even with the label", () => {
    const { root, base } = ratchetProject(map => {
      (map.coverageFloor as Record<string, number>)[WEB] = 0;
      map.coverageFloorBaseline = [{ ...BASELINE_RECORD, ticket: undefined }];
    });
    const run = runGate(root, {
      BDD_MODE: ENFORCED,
      BDD_BASE_SHA: base,
      BDD_PR_LABELS: BASELINE_LABEL,
    });
    expect(
      messages(run, FLOOR_RATCHET).some(item => item.includes("no ticket"))
    ).toBe(true);
  });

  it("accepts a reduction carrying BOTH the record and the maintainer label", () => {
    const { root, base } = ratchetProject(map => {
      (map.coverageFloor as Record<string, number>)[WEB] = 0;
      map.coverageFloorBaseline = [BASELINE_RECORD];
    });
    const run = runGate(root, {
      BDD_MODE: ENFORCED,
      BDD_BASE_SHA: base,
      BDD_PR_LABELS: `other-label,${BASELINE_LABEL}`,
    });
    expect(messages(run, FLOOR_RATCHET)).toEqual([]);
    expect(run.status).toBe(0);
  });

  it("fails when current coverage drops below the committed floor", () => {
    const root = healthyProject({
      coverageFloor: { [WEB]: 100 },
      mappings: [],
    });
    expect(codes(runGate(root, { BDD_MODE: ENFORCED }))).toContain(
      "floor-regression"
    );
  });

  it("requires a floor for every declared platform in enforced mode", () => {
    const run = runGate(healthyProject({ coverageFloor: {} }), {
      BDD_MODE: ENFORCED,
    });
    expect(codes(run)).toContain("floor-missing");
  });
});

describe("scenario deletion", () => {
  /**
   * Commit a project carrying an extra scenario, then delete that file.
   * @returns Project root and base SHA.
   */
  function deletionProject(): { readonly root: string; readonly base: string } {
    const root = healthyProject(
      {},
      {
        features: {
          "extra.feature": featureSource("Extra", [
            { id: EXTRA_ID, tags: [WEB, RATIFIED] },
          ]),
        },
      }
    );
    const base = commitAll(root);
    fs.rmSync(path.join(root, "bdd", "features", "extra.feature"));
    return { root, base };
  }

  it("refuses a scenario deleted rather than marked @superseded", () => {
    const { root, base } = deletionProject();
    const run = runGate(root, { BDD_MODE: ENFORCED, BDD_BASE_SHA: base });
    expect(run.status).toBe(1);
    const found = messages(run, SCENARIO_DELETED);
    expect(found[0]).toContain(EXTRA_ID);
    expect(found[0]).toContain("@superseded");
  });

  it("still refuses the deletion when only the label is present", () => {
    const { root, base } = deletionProject();
    const run = runGate(root, {
      BDD_MODE: ENFORCED,
      BDD_BASE_SHA: base,
      BDD_PR_LABELS: BASELINE_LABEL,
    });
    expect(codes(run)).toContain(SCENARIO_DELETED);
  });

  it("accepts a retirement carrying a full record and the maintainer label", () => {
    const { root, base } = deletionProject();
    const map = readMap(root);
    map.retirements = [
      {
        scenario: EXTRA_ID,
        reason: "capability removed from the product",
        ticket: "TUN-5",
        approvedBy: "cody",
        recordedAt: "2026-08-12",
      },
    ];
    writeMap(root, map);
    const run = runGate(root, {
      BDD_MODE: ENFORCED,
      BDD_BASE_SHA: base,
      BDD_PR_LABELS: BASELINE_LABEL,
    });
    expect(messages(run, SCENARIO_DELETED)).toEqual([]);
  });

  it("says so explicitly when there is no base revision to compare against", () => {
    const run = runGate(healthyProject(), {
      BDD_MODE: ENFORCED,
      BDD_BASE_SHA: "deadbeef",
    });
    expect(codes(run)).toContain("baseline");
  });
});
