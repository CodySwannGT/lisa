/**
 * Tests for the gate report's three-state contract and its bucket view.
 *
 * These are the assertions about what the report REFUSES to say. A report that
 * renders a green it did not verify is the defect this backlog documents,
 * sited at the screen an operator would trust most — so every case here is a
 * fact the run could not reach, and the assertion is that it did not become a
 * pass, a fail, or a silent D.
 * @module tests/unit/cli/gate-report-states
 */
import { describe, expect, it } from "vitest";

import {
  cell,
  DEPENDENCY_VULNERABILITY,
  PULL_REQUEST,
  PUSH,
  reportFor,
  row,
  shippedPrePush,
  TYPE_CORRECTNESS,
  TYPECHECK,
  TYPECHECK_SCRIPT,
} from "./gate-report-fixtures.js";

/** A declaration that would produce a required merge context. */
const REQUIRED_AT_MERGE = {
  gates: { [TYPE_CORRECTNESS]: { "pull-request": "required" } },
};

describe("Tier 3", () => {
  it("is stated as unknowable and never inferred from a job mapping", async () => {
    const built = await reportFor({
      config: { gates: { [DEPENDENCY_VULNERABILITY]: { push: "required" } } },
      scripts: { "security:audit": "npm audit" },
    });
    const gate = row(built, DEPENDENCY_VULNERABILITY);
    expect(gate.qualityJob).toBe("npm_security_scan");
    for (const one of gate.moments) {
      expect(one.facadeReadsDeclaration.state).toBe("unknown");
      expect(one.facadeReadsDeclaration).toMatchObject({
        reason: "determined-by-quality-yml",
      });
    }
  });
});

describe("Tier 2", () => {
  it("reports offline as unknown rather than not-applicable", async () => {
    const built = await reportFor({ config: REQUIRED_AT_MERGE });
    const merge = cell(built, TYPE_CORRECTNESS, PULL_REQUEST).blocksMerge;
    expect(merge.state).toBe("unknown");
    expect(merge).toMatchObject({ reason: "offline" });
    expect(built.ruleset).toMatchObject({
      state: "unknown",
      reason: "offline",
    });
  });

  it("does not invent branch protection when gh is unauthenticated", async () => {
    const built = await reportFor(
      { config: REQUIRED_AT_MERGE },
      {
        offline: false,
        readRequiredContexts: () => {
          throw new Error("gh: HTTP 401: Bad credentials");
        },
      }
    );
    const merge = cell(built, TYPE_CORRECTNESS, PULL_REQUEST).blocksMerge;
    expect(merge).toMatchObject({
      state: "unknown",
      reason: "not-authenticated",
    });
    const claims = built.gates.flatMap(entry =>
      entry.moments.filter(one => one.blocksMerge.state === "verified")
    );
    expect(claims).toHaveLength(0);
  });

  it("compares the declared contexts against the ones a ruleset requires", async () => {
    const built = await reportFor(
      {
        config: {
          gates: {
            [TYPE_CORRECTNESS]: { "pull-request": "required" },
            "build-integrity": { "pull-request": "required" },
          },
        },
      },
      {
        offline: false,
        readRequiredContexts: () =>
          Promise.resolve([
            "🔍 Quality Checks / 🔍 Type Check",
            "🔍 Quality Checks / 🔒 Security Scan",
          ]),
      }
    );
    expect(built.ruleset).toEqual({
      state: "verified",
      value: {
        matched: ["🔍 Quality Checks / 🔍 Type Check"],
        declaredNotRequired: ["🔍 Quality Checks / 🏗️ Build"],
        requiredNotDeclared: ["🔍 Quality Checks / 🔒 Security Scan"],
      },
    });
    expect(cell(built, "build-integrity", PULL_REQUEST).blocksMerge).toEqual({
      state: "verified",
      value: { required: false, context: null },
    });
  });
});

describe("the never-a-false-green rule", () => {
  it("counts every legal cell into exactly one of the buckets or the unknown band", async () => {
    const built = await reportFor({
      config: { gates: { [TYPE_CORRECTNESS]: { push: "required" } } },
      hooks: { "pre-push": shippedPrePush([TYPE_CORRECTNESS]) },
      scripts: { [TYPECHECK]: TYPECHECK_SCRIPT },
    });
    const { buckets, bucketUnknown, legalCells } = built.summary;
    const classified =
      buckets.A + buckets.B + buckets.C + buckets.D + bucketUnknown;
    expect(classified).toBe(legalCells);
    expect(bucketUnknown).toBeGreaterThan(0);
  });

  it("classifies a declaration an executor reads as A", async () => {
    const built = await reportFor({
      config: { gates: { [TYPE_CORRECTNESS]: { push: "required" } } },
      hooks: { "pre-push": shippedPrePush([]) },
      scripts: { [TYPECHECK]: TYPECHECK_SCRIPT },
    });
    const push = cell(built, TYPE_CORRECTNESS, PUSH);
    expect(push.bucket).toEqual({ state: "verified", value: "A" });
    expect(push.executors).toEqual([
      {
        kind: "gate-runner",
        file: ".husky/pre-push",
        detail:
          ".husky/pre-push runs the gate runner at push, which reads this declaration",
      },
    ]);
  });

  it("classifies an undeclared gate a hook runs anyway as B, not D", async () => {
    const built = await reportFor({
      config: {},
      hooks: { "pre-push": shippedPrePush([DEPENDENCY_VULNERABILITY]) },
    });
    const push = cell(built, DEPENDENCY_VULNERABILITY, PUSH);
    expect(push.declaration).toBe("not-declared");
    expect(push.bucket).toEqual({ state: "verified", value: "B" });
    expect(built.summary.provedAnyway).toBe(1);
    expect(built.summary.buckets.D).toBe(0);
  });

  it("never places an unclassifiable pair in D", async () => {
    const built = await reportFor({ config: {} });
    expect(built.summary.buckets.D).toBe(0);
    expect(built.summary.bucketUnknown).toBe(built.summary.legalCells);
  });
});
