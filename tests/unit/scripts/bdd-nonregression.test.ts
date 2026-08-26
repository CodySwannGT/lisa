/**
 * Tests for the non-regression invariants that replaced the coverage-floor
 * ratchet.
 *
 * The floor used to carry two jobs: an absolute bar ("is this platform below
 * it right now") and a ratchet ("the number may never fall, and lowering it
 * takes a `coverageFloorBaseline` record plus a maintainer label"). Only the
 * bar remains. The ratchet's job is now done per obligation — see
 * `bdd/regression-support` for why these fixtures commit a floor of 0, and
 * `bdd-ratchet-removal.test.ts` for the acceptance test that nothing the
 * ratchet used to close was left open.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  BASELINE,
  COVERAGE_REGRESSION,
  HEALTHY_FEATURES,
  HEALTHY_FILES,
  HEALTHY_MAP,
  MAP_REL,
  OBLIGATION_UNCOVERED,
  RATIFIED,
  SCENARIO_DELETED,
  WEB,
  codes,
  commitAll,
  emptyProject,
  featureSource,
  healthyProject,
  messages,
  readMap,
  runGate,
  writeMap,
} from "./bdd/support";
import {
  EXTRA_FEATURE,
  EXTRA_FEATURE_FILE,
  EXTRA_ID,
  EXTRA_KEY,
  EXTRA_MAPPING,
  EXTRA_RETIREMENT,
  EXTRA_SPEC,
  EXTRA_SPEC_BODY,
  EXTRA_WAIVER,
  HOME_MAPPING,
  HOME_ONLY_MAPPINGS,
  removeExtraSpec,
  twoScenarioProject,
} from "./bdd/regression-support";

describe("coverage the repo already accepted cannot be given back", () => {
  it("accepts a valid pre-BDD base as an empty bootstrap baseline", () => {
    const root = emptyProject("first-bdd-contract-");
    fs.writeFileSync(path.join(root, "README.md"), "pre-contract project\n");
    const base = commitAll(root);
    fs.mkdirSync(path.join(root, "bdd", "features"), { recursive: true });
    fs.writeFileSync(
      path.join(root, MAP_REL),
      JSON.stringify(HEALTHY_MAP, null, 2)
    );
    for (const [name, source] of Object.entries(HEALTHY_FEATURES)) {
      fs.writeFileSync(path.join(root, "bdd", "features", name), source);
    }
    for (const [name, source] of Object.entries(HEALTHY_FILES)) {
      const destination = path.join(root, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, source);
    }

    const run = runGate(root, { BDD_BASE_SHA: base });

    expect(messages(run, BASELINE)).toEqual([]);
    expect(run.status).toBe(0);
  });

  it("still refuses a malformed coverage map at the base revision", () => {
    const root = healthyProject();
    fs.writeFileSync(path.join(root, MAP_REL), "{ nope");
    const base = commitAll(root);
    fs.writeFileSync(
      path.join(root, MAP_REL),
      JSON.stringify(HEALTHY_MAP, null, 2)
    );

    const run = runGate(root, { BDD_BASE_SHA: base });

    expect(messages(run, BASELINE).join(" ")).toContain("not valid JSON");
    expect(run.status).toBe(1);
  });

  it("passes a change that touches neither the scenarios nor the mappings", () => {
    const { root, base } = twoScenarioProject();
    const run = runGate(root, { BDD_BASE_SHA: base });
    expect(messages(run, COVERAGE_REGRESSION)).toEqual([]);
    expect(run.status).toBe(0);
  });

  it("REFUSES deleting a mapping while its scenario stays declared", () => {
    const { root, base } = twoScenarioProject({
      mappings: HOME_ONLY_MAPPINGS,
    });
    const run = runGate(root, { BDD_BASE_SHA: base });
    expect(run.status).toBe(1);
    const found = messages(run, COVERAGE_REGRESSION);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(EXTRA_KEY);
    expect(found[0]).toContain("Neither a retirements record nor a waiver");
  });

  it("REFUSES tagging a covered scenario out of the denominator", () => {
    // @blocked removes the scenario from the denominator entirely, so the
    // percentage does not drop — the coverage simply stops being claimed. The
    // old numeric ratchet could not see this move at all.
    const { root, base } = twoScenarioProject(
      { mappings: HOME_ONLY_MAPPINGS },
      target =>
        fs.writeFileSync(
          path.join(target, "bdd", "features", EXTRA_FEATURE_FILE),
          featureSource("Extra", [
            { id: EXTRA_ID, tags: [WEB, RATIFIED, "blocked"] },
          ])
        )
    );
    const run = runGate(root, { BDD_BASE_SHA: base });
    expect(messages(run, COVERAGE_REGRESSION)[0]).toContain(EXTRA_KEY);
  });

  it("accepts a waiver over a previously mapped obligation", () => {
    const { root, base } = twoScenarioProject(
      { mappings: HOME_ONLY_MAPPINGS, platformWaivers: [EXTRA_WAIVER] },
      removeExtraSpec
    );
    const run = runGate(root, {
      BDD_BASE_SHA: base,
    });
    expect(messages(run, COVERAGE_REGRESSION)).toEqual([]);
    expect(run.status).toBe(0);
  });

  it("REFUSES an incomplete retirement record", () => {
    const { root, base } = twoScenarioProject({
      mappings: HOME_ONLY_MAPPINGS,
      retirements: [{ ...EXTRA_RETIREMENT, ticket: undefined }],
    });
    const run = runGate(root, {
      BDD_BASE_SHA: base,
    });
    expect(messages(run, COVERAGE_REGRESSION)[0]).toContain("no ticket");
  });

  it("accepts a complete retirement", () => {
    const { root, base } = twoScenarioProject(
      { mappings: HOME_ONLY_MAPPINGS, retirements: [EXTRA_RETIREMENT] },
      removeExtraSpec
    );
    const run = runGate(root, {
      BDD_BASE_SHA: base,
    });
    expect(messages(run, COVERAGE_REGRESSION)).toEqual([]);
  });
});

describe("behavior that is new arrives mapped or waived", () => {
  /**
   * Commit a healthy single-scenario project with a floor of 0, then add a
   * brand-new scenario at head.
   * @param patch - Shallow overrides applied to the head coverage map.
   * @returns Project root and base SHA.
   */
  function newBehaviorProject(patch: Record<string, unknown> = {}): {
    readonly root: string;
    readonly base: string;
  } {
    const root = healthyProject({ coverageFloor: { [WEB]: 0 } });
    const base = commitAll(root);
    const map = readMap(root);
    fs.writeFileSync(
      path.join(root, "bdd", "features", EXTRA_FEATURE_FILE),
      EXTRA_FEATURE
    );
    writeMap(root, { ...map, ...patch });
    return { root, base };
  }

  it("REFUSES a new scenario nothing covers, with the floor flat on the ground", () => {
    const { root, base } = newBehaviorProject();
    const run = runGate(root, { BDD_BASE_SHA: base });
    expect(run.status).toBe(1);
    const found = messages(run, OBLIGATION_UNCOVERED);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(EXTRA_KEY);
    expect(found[0]).toContain("mapped to an automated test or waived");
  });

  it("accepts a new scenario that arrives with its mapping", () => {
    const { root, base } = newBehaviorProject({
      mappings: [HOME_MAPPING, EXTRA_MAPPING],
    });
    fs.mkdirSync(path.join(root, "e2e"), { recursive: true });
    fs.writeFileSync(path.join(root, EXTRA_SPEC), EXTRA_SPEC_BODY);
    const run = runGate(root, { BDD_BASE_SHA: base });
    expect(messages(run, OBLIGATION_UNCOVERED)).toEqual([]);
    expect(run.status).toBe(0);
  });

  it("accepts a new scenario that arrives with a dated, owned waiver", () => {
    const { root, base } = newBehaviorProject({
      platformWaivers: [EXTRA_WAIVER],
    });
    const run = runGate(root, { BDD_BASE_SHA: base });
    expect(messages(run, OBLIGATION_UNCOVERED)).toEqual([]);
    expect(run.status).toBe(0);
  });

  it("leaves a pre-existing gap alone — that is burndown, not a regression", () => {
    // The gap is already in the base revision. Demanding it be closed here is
    // what would stop a brownfield project ever adopting enforced mode.
    const root = healthyProject(
      { coverageFloor: { [WEB]: 0 } },
      { features: { [EXTRA_FEATURE_FILE]: EXTRA_FEATURE } }
    );
    const run = runGate(root, {
      BDD_BASE_SHA: commitAll(root),
    });
    expect(codes(run)).not.toContain(OBLIGATION_UNCOVERED);
    expect(run.status).toBe(0);
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
      { features: { [EXTRA_FEATURE_FILE]: EXTRA_FEATURE } }
    );
    const base = commitAll(root);
    fs.rmSync(path.join(root, "bdd", "features", EXTRA_FEATURE_FILE));
    return { root, base };
  }

  it("refuses a scenario deleted rather than marked @superseded", () => {
    const { root, base } = deletionProject();
    const run = runGate(root, { BDD_BASE_SHA: base });
    expect(run.status).toBe(1);
    const found = messages(run, SCENARIO_DELETED);
    expect(found[0]).toContain(EXTRA_ID);
    expect(found[0]).toContain("@superseded");
  });

  it("still refuses the deletion when only the label is present", () => {
    const { root, base } = deletionProject();
    const run = runGate(root, {
      BDD_BASE_SHA: base,
    });
    expect(codes(run)).toContain(SCENARIO_DELETED);
  });

  it("accepts a retirement carrying a full record and the maintainer label", () => {
    const { root, base } = deletionProject();
    writeMap(root, { ...readMap(root), retirements: [EXTRA_RETIREMENT] });
    const run = runGate(root, {
      BDD_BASE_SHA: base,
    });
    expect(messages(run, SCENARIO_DELETED)).toEqual([]);
  });

  it("reports the deletion once, not twice, when it also loses coverage", () => {
    // The scenario was mapped, so both the deletion check and the coverage
    // check can see it. Naming one act as two different failures is how an
    // operator learns to skim findings.
    const { root, base } = twoScenarioProject(
      { mappings: HOME_ONLY_MAPPINGS },
      target =>
        fs.rmSync(path.join(target, "bdd", "features", EXTRA_FEATURE_FILE))
    );
    const run = runGate(root, { BDD_BASE_SHA: base });
    expect(messages(run, SCENARIO_DELETED)).toHaveLength(1);
    expect(messages(run, COVERAGE_REGRESSION)).toEqual([]);
  });

  it("says so explicitly when there is no base revision to compare against", () => {
    const run = runGate(healthyProject(), {
      BDD_BASE_SHA: "deadbeef",
    });
    expect(codes(run)).toContain(BASELINE);
  });
});
