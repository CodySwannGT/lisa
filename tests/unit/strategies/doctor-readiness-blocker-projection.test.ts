/**
 * Regression tests for standing-blocker projection and provenance in the
 * agent-facing readiness bridge (#1902).
 *
 * Three CLI producers — B1 (`doctor-readiness-domain.ts`), B4
 * (`-guardrails.ts`), and B6 (`-context.ts`) — deliberately record `WARN` while
 * standing a ship blocker, each stating in-line that "the blocker engine never
 * reads this status, so the finding flips the repository to NOT_READY exactly
 * as a FAIL would". Taking that recorded label at face value made the agent
 * surface answer READY_WITH_WARNINGS on a repository the CLI calls NOT_READY —
 * the precise disagreement #1902 exists to eliminate. This suite locks the
 * blocker-outranks-status rule, plus the operator-facing text (narrowed claim,
 * report provenance, full finding evidence) that rides along with it.
 * @module tests/unit/strategies/doctor-readiness-blocker-projection
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
  DOMAIN_OWNERSHIP,
  FEEDBACK_GUARDRAILS,
  FIXTURE_GENERATED_AT,
  FIXTURE_LISA_VERSION,
  passingDimensions,
  PROPORTIONALITY,
  readinessReport,
  withDimension,
  writeReadinessReport,
} from "./doctor-readiness-report-fixtures.js";

/** The supervised-work fallback `readiness-rubric` requires under a blocker. */
const NARROWED_CLAIM =
  "This repository is NOT ready for unattended fleet operation because 1 ship blocker stands: B6. It IS ready for supervised, single-ticket agent work.";

/**
 * A report recording context-routing `WARN` while B6 stands — the exact shape
 * the B6 producer persists.
 * @returns The report serialized as JSON
 */
const warnDimensionOwningB6 = (): string =>
  readinessReport({
    verdict: "NOT_READY",
    narrowedClaim: NARROWED_CLAIM,
    blockers: [
      {
        id: "B6",
        label: "Documented guarantees name mechanisms that do not exist",
        dimension_id: CONTEXT_ROUTING,
        owning_dimensions: [CONTEXT_ROUTING],
      },
    ],
    dimensions: withDimension(CONTEXT_ROUTING, {
      status: "WARN",
      findings: [
        {
          blocker: "B6",
          evidence: "AGENTS.md names a `wiki/index.md` that is absent",
        },
      ],
    }),
  });

let root = "";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-readiness-blockers-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("standing blockers outrank the recorded status (#1902)", () => {
  it("projects a WARN dimension owning a standing blocker as FAIL", () => {
    writeReadinessReport(root, warnDimensionOwningB6());

    const group = createRepositoryReadinessDoctorGroup(root);
    const check = group.checks.find(entry => entry.id === CONTEXT_ROUTING);

    expect(check?.status).toBe("FAIL");
    expect(computeDoctorVerdict([group])).toBe("NOT_READY");
  });

  it("names the standing blocker ids in the dimension remediation", () => {
    writeReadinessReport(root, warnDimensionOwningB6());

    const group = createRepositoryReadinessDoctorGroup(root);
    const check = group.checks.find(entry => entry.id === CONTEXT_ROUTING);

    expect(check?.remediation).toContain("B6");
    expect(check?.remediation).not.toContain("undefined");
  });

  it("surfaces the CLI narrowed claim so the operator gets the same guidance", () => {
    writeReadinessReport(root, warnDimensionOwningB6());

    const group = createRepositoryReadinessDoctorGroup(root);
    const check = group.checks.find(entry => entry.id === CONTEXT_ROUTING);

    expect(check?.remediation).toContain(
      "It IS ready for supervised, single-ticket agent work."
    );
  });

  it("skips blockers carrying no usable id rather than printing undefined", () => {
    writeReadinessReport(
      root,
      readinessReport({
        verdict: "NOT_READY",
        blockers: [
          { label: "malformed blocker", dimension_id: DELIVERY_AUTHORITY },
          { id: "B3", dimension_id: DELIVERY_AUTHORITY },
        ],
        dimensions: withDimension(DELIVERY_AUTHORITY, { status: "FAIL" }),
      })
    );

    const group = createRepositoryReadinessDoctorGroup(root);
    const check = group.checks.find(entry => entry.id === DELIVERY_AUTHORITY);

    expect(check?.remediation).toContain("B3");
    expect(check?.remediation).not.toContain("undefined");
  });

  it("escalates only the dimension the CLI attributed the finding to", () => {
    // B4 is specced with `owning_dimensions: [domain-ownership,
    // feedback-guardrails]`, but only the guardrails producer emits the B4
    // finding, so the CLI stamps that dimension as `dimension_id` and lets
    // the domain-ownership producer record its own (clean) result. Escalating
    // every co-owning dimension would stamp FAIL on a dimension whose own
    // evidence says it found nothing — self-contradictory, and a per-dimension
    // disagreement with the CLI.
    writeReadinessReport(
      root,
      readinessReport({
        verdict: "NOT_READY",
        blockers: [
          {
            id: "B4",
            label: "A consequential operation has no gate and no recovery",
            dimension_id: FEEDBACK_GUARDRAILS,
            owning_dimensions: [DOMAIN_OWNERSHIP, FEEDBACK_GUARDRAILS],
          },
        ],
        dimensions: passingDimensions.map(dimension => {
          if (dimension.id === FEEDBACK_GUARDRAILS) {
            return {
              ...dimension,
              status: "WARN",
              findings: [
                { blocker: "B4", evidence: "deploy.yml runs ungated" },
              ],
            };
          }
          return dimension.id === DOMAIN_OWNERSHIP
            ? {
                ...dimension,
                status: "SKIP",
                findings: [
                  { reason: "read 43 workflows and found none ungated" },
                ],
              }
            : dimension;
        }),
      })
    );

    const group = createRepositoryReadinessDoctorGroup(root);
    const statuses = Object.fromEntries(
      group.checks.map(check => [check.id, check.status])
    );

    expect(statuses[FEEDBACK_GUARDRAILS]).toBe("FAIL");
    expect(statuses[DOMAIN_OWNERSHIP]).toBe("SKIP");
    expect(computeDoctorVerdict([group])).toBe("NOT_READY");
  });

  it("falls back to owning_dimensions when a blocker records no dimension_id", () => {
    writeReadinessReport(
      root,
      readinessReport({
        verdict: "NOT_READY",
        blockers: [
          { id: "B5", owning_dimensions: ["dependencies-supply-chain"] },
        ],
        dimensions: passingDimensions,
      })
    );

    const group = createRepositoryReadinessDoctorGroup(root);
    const check = group.checks.find(
      entry => entry.id === "dependencies-supply-chain"
    );

    expect(check?.status).toBe("FAIL");
    expect(computeDoctorVerdict([group])).toBe("NOT_READY");
  });

  it("leaves a clean report free of blocker remediation", () => {
    writeReadinessReport(
      root,
      readinessReport({ verdict: "READY", dimensions: passingDimensions })
    );

    const group = createRepositoryReadinessDoctorGroup(root);
    const check = group.checks.find(entry => entry.id === CONTEXT_ROUTING);

    expect(check?.remediation).toBeUndefined();
    expect(computeDoctorVerdict([group])).toBe("READY");
  });
});

describe("projected checks carry provenance and full evidence (#1902)", () => {
  it("stamps the report generation time and Lisa version into observed", () => {
    writeReadinessReport(
      root,
      readinessReport({ verdict: "READY", dimensions: passingDimensions })
    );

    const group = createRepositoryReadinessDoctorGroup(root);
    const check = group.checks.find(entry => entry.id === CONTEXT_ROUTING);

    expect(check?.observed).toContain(FIXTURE_GENERATED_AT);
    expect(check?.observed).toContain(FIXTURE_LISA_VERSION);
  });

  it("carries the not-established caveat onto an unassessed dimension", () => {
    writeReadinessReport(
      root,
      readinessReport({
        verdict: "READY_WITH_WARNINGS",
        dimensions: withDimension(PROPORTIONALITY, {
          status: "SKIP",
          findings: [{ reason: "no scaffolding scan on an offline pass" }],
        }),
      })
    );

    const group = createRepositoryReadinessDoctorGroup(root);
    const check = group.checks.find(entry => entry.id === PROPORTIONALITY);

    expect(check?.observed).toContain(
      "NOT ESTABLISHED: 1 of 8 dimensions were never assessed"
    );
  });

  it("reads a finding that carries only an observation into the summary", () => {
    writeReadinessReport(
      root,
      readinessReport({
        verdict: "READY_WITH_WARNINGS",
        dimensions: withDimension(PROPORTIONALITY, {
          status: "WARN",
          findings: [{ observation: "three unused template stacks" }],
        }),
      })
    );

    const group = createRepositoryReadinessDoctorGroup(root);
    const check = group.checks.find(entry => entry.id === PROPORTIONALITY);

    expect(check?.summary).toContain("three unused template stacks");
  });

  it("truncates an oversized evidence string instead of flooding the report", () => {
    writeReadinessReport(
      root,
      readinessReport({
        verdict: "READY",
        dimensions: withDimension(CONTEXT_ROUTING, {
          findings: [{ evidence: "x".repeat(900) }],
        }),
      })
    );

    const group = createRepositoryReadinessDoctorGroup(root);
    const check = group.checks.find(entry => entry.id === CONTEXT_ROUTING);

    expect(check?.summary).toHaveLength(320);
    expect(check?.summary.endsWith("…")).toBe(true);
  });
});
