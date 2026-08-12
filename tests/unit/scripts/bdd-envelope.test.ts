/**
 * The BDD gate answers Lisa's standard command envelope, and its fail-closed
 * logic is an allowlist.
 *
 * Two failure modes are guarded here. The first is a second result shape: an
 * adapter that invents its own JSON is unreadable by anything that reads the
 * others, so the emitted envelope is validated by the shared module's own
 * validator rather than by a restated copy of its rules. The second is a
 * denylist: enumerating what is FATAL means an unanticipated value falls
 * through to permissive, which is how a gate quietly stops gating.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import {
  BOOTSTRAP,
  COMPLETED,
  ENFORCED,
  INVALID,
  NOT_ADOPTED,
  healthyProject,
  makeProject,
  runGate,
} from "./bdd/support";

const SHARED_REL = "all/copy-overwrite/scripts/lisa-command-envelope.mjs";
const GATE_REL = "expo/copy-overwrite/scripts/bdd/envelope.mjs";
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Import an ESM module from the repo by relative path.
 * @param relative - Repo-relative module path.
 * @returns The imported module namespace.
 */
async function load(relative: string): Promise<Record<string, unknown>> {
  return import(pathToFileURL(path.join(REPO_ROOT, relative)).href) as Promise<
    Record<string, unknown>
  >;
}

describe("standard command envelope conformance", () => {
  let validateEnvelope: (envelope: unknown) => {
    valid: boolean;
    errors: string[];
  };
  let sharedSuccessStatuses: readonly string[];
  let gateSuccessStatuses: readonly string[];

  beforeAll(async () => {
    const shared = await load(SHARED_REL);
    const gate = await load(GATE_REL);
    validateEnvelope = shared.validateEnvelope as typeof validateEnvelope;
    sharedSuccessStatuses = shared.SUCCESS_STATUSES as readonly string[];
    gateSuccessStatuses = gate.SUCCESS_STATUSES as readonly string[];
  });

  it("emits an envelope the shared validator accepts, on a clean contract", () => {
    const run = runGate(healthyProject(), { BDD_MODE: ENFORCED });
    expect(validateEnvelope(run.envelope)).toEqual({ valid: true, errors: [] });
    expect(run.envelope.capability).toBe("bdd-coverage");
    expect(run.envelope.mode).toBe("real");
    expect(run.envelope.status).toBe(COMPLETED);
  });

  it("emits a valid envelope carrying a reason on every non-success status", () => {
    for (const [state, expected] of [
      [ENFORCED, INVALID],
      [BOOTSTRAP, INVALID],
    ] as const) {
      const run = runGate(makeProject({}), { BDD_MODE: state });
      expect(validateEnvelope(run.envelope), state).toEqual({
        valid: true,
        errors: [],
      });
      expect(run.envelope.status, state).toBe(expected);
      expect(run.envelope.reason, state).toBeTruthy();
    }
  });

  it("emits a valid envelope in the not-adopted state", () => {
    const run = runGate(makeProject({}), { BDD_MODE: NOT_ADOPTED });
    expect(validateEnvelope(run.envelope)).toEqual({ valid: true, errors: [] });
    expect(run.envelope.status).toBe(NOT_ADOPTED);
  });

  it("emits a valid envelope when the contract has findings", () => {
    const run = runGate(healthyProject({ coverageFloor: {} }), {
      BDD_MODE: ENFORCED,
    });
    expect(validateEnvelope(run.envelope)).toEqual({ valid: true, errors: [] });
    expect(run.envelope.findings.length).toBeGreaterThan(0);
    for (const finding of run.envelope.findings) {
      expect(finding.subject, finding.code).toBeTruthy();
      expect(["error", "warning"]).toContain(finding.severity);
    }
  });

  it("keeps stdout to exactly one machine-readable document", () => {
    const run = runGate(healthyProject(), { BDD_MODE: ENFORCED });
    // Narration belongs on stderr; a second document on stdout would leave the
    // stream with no schema at all.
    expect(run.stderr).toContain("[bdd-coverage]");
    expect(run.envelope.summary.headline).toContain("bdd-coverage enforced");
  });

  it("carries the CI-supplied correlation id and environment identity", () => {
    const run = runGate(healthyProject(), {
      BDD_MODE: ENFORCED,
      BDD_CORRELATION_ID: "run-42-1",
      BDD_ENVIRONMENT: "CodySwannGT/lisa@main",
    });
    expect(run.envelope.correlationId).toBe("run-42-1");
    expect(run.envelope.environment).toBe("CodySwannGT/lisa@main");
  });

  it("does not drift from the shared module's success statuses", () => {
    const alphabetical = (a: string, b: string): number => a.localeCompare(b);
    expect([...gateSuccessStatuses].sort(alphabetical)).toEqual(
      [...sharedSuccessStatuses].sort(alphabetical)
    );
  });
});

describe("fail-closed allowlist", () => {
  let warnable: readonly string[];
  let hasFatalDefect: (
    state: string,
    defects: readonly { code: string }[]
  ) => boolean;
  let subjectFor: (item: { code: string; message: string }) => string;

  beforeAll(async () => {
    const gate = await load(GATE_REL);
    warnable = gate.WARNABLE_DEFECT_CODES as readonly string[];
    hasFatalDefect = gate.hasFatalDefect as typeof hasFatalDefect;
    subjectFor = gate.subjectFor as typeof subjectFor;
  });

  it("treats an UNKNOWN defect code as fatal in bootstrap", () => {
    // The doctrine: enumerate what is permitted to be a warning. A denylist of
    // fatal codes would let a check added tomorrow pass silently today.
    expect(hasFatalDefect(BOOTSTRAP, [{ code: "some-future-check" }])).toBe(
      true
    );
    expect(hasFatalDefect(BOOTSTRAP, [{ code: "waiver-metadata" }])).toBe(
      false
    );
  });

  it("never allows an adoption-integrity defect to be downgraded", () => {
    for (const code of [
      "adoption-drift",
      "bootstrap-expired",
      "bootstrap-metadata",
      "config-absent",
      "config-malformed",
      "config-schema",
    ]) {
      expect(warnable, code).not.toContain(code);
      expect(hasFatalDefect(BOOTSTRAP, [{ code }]), code).toBe(true);
    }
  });

  it("fails on any defect at all in enforced, warnable or not", () => {
    expect(hasFatalDefect(ENFORCED, [{ code: "waiver-metadata" }])).toBe(true);
    expect(hasFatalDefect(ENFORCED, [])).toBe(false);
  });

  it("names a real subject for every finding shape", () => {
    expect(
      subjectFor({
        code: "scenario-id",
        message: "bdd/features/a.feature:4 must",
      })
    ).toBe("bdd/features/a.feature:4");
    expect(
      subjectFor({
        code: "mapping-orphan",
        message: "coverage-map.mappings[2] BDD-A-001: names",
      })
    ).toBe("coverage-map.mappings[2]");
    expect(
      subjectFor({ code: "scenario-deleted", message: "BDD-A-001 was deleted" })
    ).toBe("BDD-A-001");
    expect(
      subjectFor({ code: "execution-results", message: "not found: x.json" })
    ).toBe("execution results");
    expect(
      subjectFor({ code: "baseline", message: "base revision deadbeef" })
    ).toBe("base revision");
  });
});
