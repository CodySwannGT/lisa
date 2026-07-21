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
 * CLI readiness pass has not run, not that the repository is clean.
 * @module tests/unit/strategies/doctor-readiness-report-bridge
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  computeDoctorVerdict,
  createRepositoryReadinessDoctorGroup,
} from "../../../plugins/src/base/scripts/doctor-report.mjs";

/** The dimension these fixtures drive a standing ship blocker through. */
const DELIVERY_AUTHORITY = "delivery-authority";

/** The eight ownership dimensions, in fixed render order (readiness-rubric). */
const DIMENSION_IDS = [
  "context-routing",
  "capabilities-tools",
  "domain-ownership",
  "execution-proof",
  "feedback-guardrails",
  "dependencies-supply-chain",
  DELIVERY_AUTHORITY,
  "proportionality",
] as const;

let root = "";

const writeReadinessReport = (contents: string): void => {
  mkdirSync(path.join(root, ".lisa"), { recursive: true });
  writeFileSync(path.join(root, ".lisa", "readiness.json"), contents, "utf8");
};

/**
 * Build a persisted-report fixture in the CLI's shape.
 * @param root0 - Fixture inputs
 * @param root0.dimensions - Per-dimension records to persist
 * @param root0.verdict - Report-level verdict
 * @param root0.blockers - Detected blockers to persist
 * @returns The report serialized as JSON
 */
const readinessReport = ({
  dimensions,
  verdict,
  blockers = [],
}: {
  dimensions: readonly { id: string; status: string; findings: unknown[] }[];
  verdict: string;
  blockers?: readonly Record<string, unknown>[];
}): string =>
  JSON.stringify({
    schema_version: 1,
    generated_at: "2026-07-21T00:00:00.000Z",
    lisa_version: "2.281.0",
    worker_signature: "claude/unknown/unknown",
    verdict,
    narrowed_claim: null,
    blockers,
    blocker_count: blockers.length,
    dimensions,
  });

const passingDimensions = DIMENSION_IDS.map(id => ({
  id,
  status: "PASS",
  findings: [{ evidence: `dimension ${id} assessed clean`, checked: [] }],
}));

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-readiness-bridge-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("agent readiness group bridges .lisa/readiness.json (#1902)", () => {
  it("projects a FAIL dimension from the CLI report instead of SKIP", () => {
    writeReadinessReport(
      readinessReport({
        verdict: "NOT_READY",
        blockers: [
          {
            id: "B3",
            label: "Credentials carry material unintended authority",
            dimension_id: DELIVERY_AUTHORITY,
            owning_dimensions: [DELIVERY_AUTHORITY],
          },
        ],
        dimensions: DIMENSION_IDS.map(id =>
          id === DELIVERY_AUTHORITY
            ? {
                id,
                status: "FAIL",
                findings: [
                  {
                    blocker: "B3",
                    evidence:
                      "release.yml job `quality` declares `secrets: inherit`",
                  },
                ],
              }
            : {
                id,
                status: "PASS",
                findings: [{ evidence: `dimension ${id} assessed clean` }],
              }
        ),
      })
    );

    const group = createRepositoryReadinessDoctorGroup(root);
    const check = group.checks.find(
      entry => entry.id === DELIVERY_AUTHORITY
    ) as { id: string; status: string; summary: string };

    expect(group.checks).toHaveLength(8);
    expect(check.status).toBe("FAIL");
    expect(check.summary).toContain(
      "release.yml job `quality` declares `secrets: inherit`"
    );
    expect(computeDoctorVerdict([group])).toBe("NOT_READY");
  });

  it("reaches READY when the CLI report is clean across all eight dimensions", () => {
    writeReadinessReport(
      readinessReport({ verdict: "READY", dimensions: passingDimensions })
    );

    const group = createRepositoryReadinessDoctorGroup(root);

    expect(group.checks.map(check => check.id)).toEqual([...DIMENSION_IDS]);
    expect([...new Set(group.checks.map(check => check.status))]).toEqual([
      "PASS",
    ]);
    expect(computeDoctorVerdict([group])).toBe("READY");
  });

  it("projects WARN and SKIP dimension statuses verbatim", () => {
    writeReadinessReport(
      readinessReport({
        verdict: "READY_WITH_WARNINGS",
        dimensions: DIMENSION_IDS.map(id => {
          if (id === "capabilities-tools") {
            return {
              id,
              status: "SKIP",
              findings: [
                { reason: "tool reachability needs a live probe", skip: true },
              ],
            };
          }
          if (id === "proportionality") {
            return {
              id,
              status: "WARN",
              findings: [{ evidence: "scaffolding to subtract remains" }],
            };
          }
          return {
            id,
            status: "PASS",
            findings: [{ evidence: `dimension ${id} assessed clean` }],
          };
        }),
      })
    );

    const group = createRepositoryReadinessDoctorGroup(root);
    const statuses = Object.fromEntries(
      group.checks.map(check => [check.id, check.status])
    );

    expect(statuses["capabilities-tools"]).toBe("SKIP");
    expect(statuses["proportionality"]).toBe("WARN");
    expect(statuses["context-routing"]).toBe("PASS");
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
    writeReadinessReport("{ not json");

    const group = createRepositoryReadinessDoctorGroup(root);

    expect([...new Set(group.checks.map(check => check.status))]).toEqual([
      "SKIP",
    ]);
    expect(computeDoctorVerdict([group])).toBe("READY_WITH_WARNINGS");
  });

  it("reasoned-SKIPs when the report carries an unknown schema_version", () => {
    writeReadinessReport(
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
      readinessReport({
        verdict: "READY",
        dimensions: passingDimensions.filter(
          dimension => dimension.id !== "proportionality"
        ),
      })
    );

    const group = createRepositoryReadinessDoctorGroup(root);
    const statuses = Object.fromEntries(
      group.checks.map(check => [check.id, check.status])
    );

    expect(group.checks).toHaveLength(8);
    expect(statuses["proportionality"]).toBe("SKIP");
    expect(statuses["context-routing"]).toBe("PASS");
    expect(computeDoctorVerdict([group])).toBe("READY_WITH_WARNINGS");
  });
});
