/**
 * Regression tests for the agent-facing readiness bridge (#1902).
 *
 * PRD #1739 ships two readiness scorers: the TypeScript CLI (blocker-engine
 * backed, persists `.lisa/readiness.json`) and the `.mjs` scorer the coding
 * agents run through `/lisa:doctor`. #1897 brought the verdict *algebra* to
 * parity; this suite proves the readiness *content* agrees too — the agent
 * group projects the CLI's per-dimension result when the report is on disk, and
 * degrades to today's reasoned SKIP when it is absent, stale, or unparseable.
 * Never manufacture a pass or a fail from absence: a missing report means the
 * CLI readiness pass has not run, not that the repository is clean. The
 * standing-blocker half of the contract lives in the sibling
 * `doctor-readiness-blocker-projection` suite.
 * @module tests/unit/strategies/doctor-readiness-report-bridge
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  computeDoctorVerdict,
  createRepositoryReadinessDoctorGroup,
} from "../../../plugins/src/base/scripts/doctor-report.mjs";
import {
  CONTEXT_ROUTING,
  DELIVERY_AUTHORITY,
  DIMENSION_IDS,
  passingDimensions,
  PROPORTIONALITY,
  readinessReport,
  withDimension,
  writeReadinessReport,
} from "./doctor-readiness-report-fixtures.js";

let root = "";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-readiness-bridge-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("agent readiness group bridges .lisa/readiness.json (#1902)", () => {
  it("projects a FAIL dimension from the CLI report instead of SKIP", () => {
    writeReadinessReport(
      root,
      readinessReport({
        verdict: "NOT_READY",
        dimensions: withDimension(DELIVERY_AUTHORITY, {
          status: "FAIL",
          findings: [
            {
              blocker: "B3",
              evidence: "release.yml job `quality` declares `secrets: inherit`",
            },
          ],
        }),
      })
    );

    const group = createRepositoryReadinessDoctorGroup(root);
    const check = group.checks.find(entry => entry.id === DELIVERY_AUTHORITY);

    expect(group.checks).toHaveLength(8);
    expect(check?.status).toBe("FAIL");
    expect(check?.summary).toContain(
      "release.yml job `quality` declares `secrets: inherit`"
    );
    expect(computeDoctorVerdict([group])).toBe("NOT_READY");
  });

  it("reaches READY when the CLI report is clean across all eight dimensions", () => {
    writeReadinessReport(
      root,
      readinessReport({ verdict: "READY", dimensions: passingDimensions })
    );

    const group = createRepositoryReadinessDoctorGroup(root);

    expect(group.checks.map(check => check.id)).toEqual([...DIMENSION_IDS]);
    expect([...new Set(group.checks.map(check => check.status))]).toEqual([
      "PASS",
    ]);
    expect(computeDoctorVerdict([group])).toBe("READY");
  });

  it("projects WARN and SKIP dimension statuses verbatim absent a blocker", () => {
    writeReadinessReport(
      root,
      readinessReport({
        verdict: "READY_WITH_WARNINGS",
        dimensions: withDimension(PROPORTIONALITY, {
          status: "WARN",
          findings: [{ evidence: "scaffolding to subtract remains" }],
        }),
      })
    );

    const group = createRepositoryReadinessDoctorGroup(root);
    const statuses = Object.fromEntries(
      group.checks.map(check => [check.id, check.status])
    );

    expect(statuses[PROPORTIONALITY]).toBe("WARN");
    expect(statuses[CONTEXT_ROUTING]).toBe("PASS");
    expect(computeDoctorVerdict([group])).toBe("READY_WITH_WARNINGS");
  });

  it("reasoned-SKIPs every dimension when no report exists", () => {
    const group = createRepositoryReadinessDoctorGroup(root);

    expect(group.checks).toHaveLength(8);
    for (const check of group.checks) {
      expect(check.status).toBe("SKIP");
      expect((check.observed ?? "").length).toBeGreaterThan(0);
    }
    expect(computeDoctorVerdict([group])).toBe("READY_WITH_WARNINGS");
  });

  it("reasoned-SKIPs when the report is unparseable", () => {
    writeReadinessReport(root, "{ not json");

    const group = createRepositoryReadinessDoctorGroup(root);

    expect([...new Set(group.checks.map(check => check.status))]).toEqual([
      "SKIP",
    ]);
    expect(computeDoctorVerdict([group])).toBe("READY_WITH_WARNINGS");
  });

  it("reasoned-SKIPs when the report carries an unknown schema_version", () => {
    writeReadinessReport(
      root,
      JSON.stringify({
        schema_version: 99,
        verdict: "READY",
        dimensions: passingDimensions,
      })
    );

    const group = createRepositoryReadinessDoctorGroup(root);

    expect([...new Set(group.checks.map(check => check.status))]).toEqual([
      "SKIP",
    ]);
    expect(computeDoctorVerdict([group])).toBe("READY_WITH_WARNINGS");
  });

  it("reasoned-SKIPs a dimension the report never recorded", () => {
    writeReadinessReport(
      root,
      readinessReport({
        verdict: "READY",
        dimensions: passingDimensions.filter(
          dimension => dimension.id !== PROPORTIONALITY
        ),
      })
    );

    const group = createRepositoryReadinessDoctorGroup(root);
    const statuses = Object.fromEntries(
      group.checks.map(check => [check.id, check.status])
    );

    expect(group.checks).toHaveLength(8);
    expect(statuses[PROPORTIONALITY]).toBe("SKIP");
    expect(statuses[CONTEXT_ROUTING]).toBe("PASS");
    expect(computeDoctorVerdict([group])).toBe("READY_WITH_WARNINGS");
  });

  it("degrades a status outside the shipped vocabulary to SKIP", () => {
    writeReadinessReport(
      root,
      readinessReport({
        verdict: "READY",
        dimensions: withDimension("execution-proof", { status: "UNKNOWN" }),
      })
    );

    const group = createRepositoryReadinessDoctorGroup(root);
    const check = group.checks.find(entry => entry.id === "execution-proof");

    expect(check?.status).toBe("SKIP");
    expect(computeDoctorVerdict([group])).toBe("READY_WITH_WARNINGS");
  });

  it("reasoned-SKIPs every dimension when the report records none", () => {
    writeReadinessReport(
      root,
      readinessReport({ verdict: "READY", dimensions: [] })
    );

    const group = createRepositoryReadinessDoctorGroup(root);

    expect(group.checks).toHaveLength(8);
    expect([...new Set(group.checks.map(check => check.status))]).toEqual([
      "SKIP",
    ]);
    expect(computeDoctorVerdict([group])).toBe("READY_WITH_WARNINGS");
  });
});
