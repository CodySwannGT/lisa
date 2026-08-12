/**
 * Tests for the three-state adoption contract.
 *
 * The load-bearing case is that `enforced` FAILS on absence rather than
 * skipping: GitHub counts a skipped required check as passing, so a gate that
 * quietly no-ops when it finds nothing is worse than no gate at all.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP,
  ENFORCED,
  HEALTHY_FEATURES,
  HEALTHY_FILES,
  HEALTHY_MAP,
  COMPLETED,
  INVALID,
  NOT_ADOPTED,
  SCRIPT_ABS,
  codes,
  healthyMapping,
  healthyProject,
  makeProject,
  messages,
  runGate,
} from "./bdd/support";

const CONFIG_ABSENT = "config-absent";

describe("three-state adoption", () => {
  it("not-adopted: reports and exits 0 even with no contract at all", () => {
    const run = runGate(makeProject({}), { BDD_MODE: NOT_ADOPTED });
    expect(run.status).toBe(0);
    expect(run.envelope.status).toBe(NOT_ADOPTED);
    expect(run.envelope.findings).toHaveLength(0);
  });

  it("defaults to not-adopted when BDD_MODE is unset, so upgrading enrolls nobody", () => {
    expect(runGate(makeProject({})).envelope.summary.adoptionState).toBe(
      NOT_ADOPTED
    );
  });

  it("rejects an unrecognized BDD_MODE with a usage exit rather than guessing", () => {
    const result = spawnSync(process.execPath, [SCRIPT_ABS, "--json"], {
      encoding: "utf-8",
      env: {
        ...process.env,
        BDD_COVERAGE_ROOT: makeProject({}),
        BDD_MODE: "enforce",
      },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not one of");
  });

  it("enforced: FAILS when the coverage map is absent — absence is never a skip", () => {
    const run = runGate(makeProject({}), { BDD_MODE: ENFORCED });
    expect(run.status).toBe(1);
    expect(run.envelope.status).toBe(INVALID);
    expect(run.envelope.findings[0].code).toBe(CONFIG_ABSENT);
    expect(run.envelope.findings[0].message).toContain("never a skip");
    expect(run.envelope.reason).toContain(CONFIG_ABSENT);
  });

  it("enforced: FAILS on a malformed coverage map", () => {
    const root = makeProject({ map: "{ not json" });
    const run = runGate(root, { BDD_MODE: ENFORCED });
    expect(run.status).toBe(1);
    expect(run.envelope.status).toBe(INVALID);
    expect(codes(run)).toContain("config-malformed");
  });

  it("enforced: FAILS on an unsupported coverage-map schema version", () => {
    const run = runGate(healthyProject({ schemaVersion: 99 }), {
      BDD_MODE: ENFORCED,
    });
    expect(codes(run)).toContain("config-schema");
  });

  it("enforced: FAILS on zero scenarios and zero test mappings", () => {
    const root = makeProject({
      map: { ...HEALTHY_MAP, mappings: [], coverageFloor: { web: 0 } },
    });
    const run = runGate(root, { BDD_MODE: ENFORCED });
    expect(run.status).toBe(1);
    const found = messages(run, "empty-contract");
    expect(found.some(item => item.includes("zero scenarios"))).toBe(true);
    expect(found.some(item => item.includes("zero test mappings"))).toBe(true);
  });

  it("enforced: passes a healthy contract", () => {
    const run = runGate(healthyProject(), { BDD_MODE: ENFORCED });
    expect(run.envelope.findings).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.envelope.status).toBe(COMPLETED);
  });

  it("enforced: rejects a manifest whose adoption.state disagrees with CI", () => {
    const root = healthyProject({
      adoption: { state: BOOTSTRAP, owner: "cody", expiresAt: "2099-01-01" },
    });
    expect(codes(runGate(root, { BDD_MODE: ENFORCED }))).toContain(
      "adoption-drift"
    );
  });

  it("enforced: rejects a manifest with no adoption.state at all", () => {
    const root = makeProject({
      map: { ...HEALTHY_MAP, adoption: undefined },
      features: HEALTHY_FEATURES,
      files: HEALTHY_FILES,
    });
    expect(codes(runGate(root, { BDD_MODE: ENFORCED }))).toContain(
      "adoption-drift"
    );
  });

  it("bootstrap: contract defects are visible warnings and the run still exits 0", () => {
    const root = makeProject({
      map: {
        ...HEALTHY_MAP,
        adoption: {
          state: BOOTSTRAP,
          owner: "cody@example.test",
          expiresAt: "2026-12-31",
        },
        mappings: [
          { ...healthyMapping(), evidence: "a title that no longer exists" },
        ],
      },
      features: HEALTHY_FEATURES,
      files: HEALTHY_FILES,
    });
    const run = runGate(root, { BDD_MODE: BOOTSTRAP });
    expect(run.status).toBe(0);
    expect(run.envelope.status).toBe(COMPLETED);
    expect(run.envelope.summary.findingsWarning).toBeGreaterThan(0);
    expect(run.envelope.summary.findingsError).toBe(0);
    expect(codes(run)).toContain("mapping-evidence");
  });

  it("bootstrap: FAILS without a named owner and a hard expiry", () => {
    const root = healthyProject({ adoption: { state: BOOTSTRAP } });
    const run = runGate(root, { BDD_MODE: BOOTSTRAP });
    expect(run.status).toBe(1);
    const found = messages(run, "bootstrap-metadata");
    expect(found.some(item => item.includes("adoption.owner"))).toBe(true);
    expect(found.some(item => item.includes("adoption.expiresAt"))).toBe(true);
  });

  it("bootstrap: FAILS once the time-box expires, so it cannot become permanent", () => {
    const root = healthyProject({
      adoption: {
        state: BOOTSTRAP,
        owner: "cody@example.test",
        expiresAt: "2026-08-11",
      },
    });
    const run = runGate(root, { BDD_MODE: BOOTSTRAP });
    expect(run.status).toBe(1);
    expect(codes(run)).toContain("bootstrap-expired");
  });

  it("bootstrap: FAILS when the coverage map is absent entirely", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bdd-empty-"));
    const run = runGate(root, { BDD_MODE: BOOTSTRAP });
    expect(run.status).toBe(1);
    expect(codes(run)).toContain(CONFIG_ABSENT);
  });
});
