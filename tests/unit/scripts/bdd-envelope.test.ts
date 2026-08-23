/**
 * The BDD gate answers Lisa's standard command envelope, and its fail-closed
 * logic is an allowlist.
 *
 * Two failure modes are guarded here. The first is a second result shape: an
 * adapter that invents its own JSON is unreadable by anything that reads the
 * others, so the emitted envelope is validated by the shared module's own
 * validator rather than by a restated copy of its rules.
 *
 * The second used to be a denylist, back when `bootstrap` graded some defects
 * `warning` and an allowlist of warnable codes kept an unanticipated one fatal.
 * That grade is gone with the state that needed it, and the property that
 * replaced it is stronger and needs no list at all: EVERY defect fails. The
 * cases below prove the strong form, including for a code nobody has written
 * yet — the value the old allowlist existed to catch.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import {
  COMPLETED,
  INVALID,
  commitAll,
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
    const root = healthyProject();
    const run = runGate(root, {
      BDD_BASE_SHA: commitAll(root),
    });
    expect(validateEnvelope(run.envelope)).toEqual({ valid: true, errors: [] });
    expect(run.envelope.capability).toBe("bdd-coverage");
    expect(run.envelope.mode).toBe("real");
    expect(run.envelope.status).toBe(COMPLETED);
  });

  it("emits a valid envelope carrying a reason on every non-success status", () => {
    const run = runGate(makeProject({}));
    expect(validateEnvelope(run.envelope)).toEqual({ valid: true, errors: [] });
    expect(run.envelope.status).toBe(INVALID);
    expect(run.envelope.reason).toBeTruthy();
  });

  it("emits a valid envelope when the contract has findings", () => {
    const run = runGate(healthyProject({ coverageFloor: {} }));
    expect(validateEnvelope(run.envelope)).toEqual({ valid: true, errors: [] });
    expect(run.envelope.findings.length).toBeGreaterThan(0);
    for (const finding of run.envelope.findings) {
      expect(finding.subject, finding.code).toBeTruthy();
      // No `severity`: it existed only to say which defects `bootstrap` was
      // allowed to ignore, and a field with one possible value is noise.
      expect(finding).not.toHaveProperty("severity");
    }
  });

  it("keeps stdout to exactly one machine-readable document", () => {
    const run = runGate(healthyProject());
    // Narration belongs on stderr; a second document on stdout would leave the
    // stream with no schema at all.
    expect(run.stderr).toContain("[bdd-coverage]");
    expect(run.envelope.summary.headline).toContain("bdd-coverage");
  });

  it("carries the CI-supplied correlation id and environment identity", () => {
    const run = runGate(healthyProject(), {
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

describe("every defect fails", () => {
  let gateModule: Record<string, unknown>;
  let hasFatalDefect: (defects: readonly { code: string }[]) => boolean;
  let subjectFor: (item: { code: string; message: string }) => string;

  beforeAll(async () => {
    const gate = await load(GATE_REL);
    gateModule = gate as Record<string, unknown>;
    hasFatalDefect = gate.hasFatalDefect as typeof hasFatalDefect;
    subjectFor = gate.subjectFor as typeof subjectFor;
  });

  it("no longer exports a warnable allowlist for anything to consult", () => {
    // The list is not merely unused — it is gone. A surviving export is an
    // invitation to reintroduce the grade it encoded.
    expect(gateModule).not.toHaveProperty("WARNABLE_DEFECT_CODES");
  });

  it("fails on a defect code nobody has written yet", () => {
    // The case the old allowlist existed to catch. It is now true by
    // construction rather than by remembering to extend a list.
    expect(hasFatalDefect([{ code: "some-future-check" }])).toBe(true);
  });

  it("fails on a code the old allowlist graded as a warning", () => {
    for (const code of [
      "waiver-metadata",
      "spec-undisclosed",
      "mapping-evidence",
      "floor-regression",
      "baseline",
    ]) {
      expect(hasFatalDefect([{ code }]), code).toBe(true);
    }
  });

  it("fails on every adoption-integrity code, as it always did", () => {
    for (const code of [
      "adoption-retired",
      "config-absent",
      "config-malformed",
      "config-schema",
      "discovery-invalid",
      "floor-invalid",
    ]) {
      expect(hasFatalDefect([{ code }]), code).toBe(true);
    }
  });

  it("passes only when there is nothing to report", () => {
    expect(hasFatalDefect([])).toBe(false);
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
