/**
 * Record four typed artifacts and verify their evidence with the built CLI.
 * @module controls-attest-exercise-artifacts
 */
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EVIDENCE_PATH } from "../../src/controls/evidence.js";
import type { EvidenceDocument } from "../../src/controls/evidence-types.js";
import {
  EXERCISE_CRITERIA,
  EXERCISE_DECLARATION_PATH,
  EXERCISE_RESULTS_PATH,
} from "../../src/controls/exercise-declaration.js";
import { signHostProof } from "../../src/controls/host-proof-signature.js";
import {
  VERDICT_PATH,
  type Verdict,
} from "../../src/controls/verdict-types.js";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  attest,
  cleanupExercises,
  controls,
  CREDENTIAL_TARGET,
  ENVIRONMENT,
  GATE_TARGET,
  PRODUCER,
  setting,
  STALE,
  statements,
  stored,
  TARGETS,
  WORKER_TARGET,
} from "../support/control-exercise-fixture.js";

useIoLatencyBudget();
afterEach(cleanupExercises);

describe("built attest records verified exercises", () => {
  it("refuses a plan with the same producer and reviewer during configuration", () => {
    const where = setting();
    writeFileSync(
      path.join(where.root, EXERCISE_DECLARATION_PATH),
      JSON.stringify({
        schema_version: 1,
        environment: ENVIRONMENT,
        targets: [{ ...TARGETS[0], adjudicator: PRODUCER }],
      })
    );
    const run = controls(where, "declaration-check");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("two independent identities");
    expect(run.stderr).toContain(EXERCISE_DECLARATION_PATH);
  });

  it("requires all five targets, records four exercised criteria, and rechecks their provenance", () => {
    const where = setting();
    const first = attest(where);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stderr).toContain(
      "No independently signed exercise results are on record"
    );
    const initial = stored<EvidenceDocument>(where, EVIDENCE_PATH);
    const statementsToSign = statements(where, initial);
    const writeStatements = (
      rows: readonly object[],
      signingKey = where.reviewer
    ): void => {
      writeFileSync(
        path.join(where.root, EXERCISE_RESULTS_PATH),
        JSON.stringify(
          rows.map(row => signHostProof("artifact-exercise", row, signingKey))
        )
      );
    };
    writeStatements(statementsToSign);
    const run = attest(where);
    expect(run.status, run.stderr).toBe(0);
    const evidence = stored<EvidenceDocument>(where, EVIDENCE_PATH);
    expect(
      evidence.records.filter(record => record.exercise !== undefined)
    ).toHaveLength(TARGETS.length);
    const verdict = stored<Verdict>(where, VERDICT_PATH);
    expect(
      verdict.criteria.filter(row =>
        EXERCISE_CRITERIA.some(id => id === row.criterion)
      )
    ).toEqual(
      EXERCISE_CRITERIA.map(criterion =>
        expect.objectContaining({
          criterion,
          verdict: "conforming",
          rung: "exercised",
          reason: "artifact-exercised",
        })
      )
    );
    const checked = attest(where, "--check");
    expect(checked.status, checked.stderr).toBe(0);
    const missingWorker = statementsToSign.filter(
      row => row.target_id !== WORKER_TARGET
    );
    writeStatements(missingWorker);
    const missing = attest(where, "--check");
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain(
      `AC6.4 exercise ${WORKER_TARGET}: There is no result for this target.`
    );
    writeStatements(
      statementsToSign.map(row =>
        row.target_id === CREDENTIAL_TARGET
          ? { ...row, completed_at: STALE }
          : row
      )
    );
    expect(attest(where, "--check").stderr).toContain(
      "outside its evidence lifetime"
    );
    writeStatements(
      statementsToSign,
      generateKeyPairSync("ed25519").privateKey
    );
    expect(attest(where, "--check").stderr).toContain(
      "signature could not be verified"
    );
    writeStatements(
      statementsToSign.map(row =>
        row.target_id === GATE_TARGET
          ? { ...row, checks_digest: "a".repeat(64) }
          : row
      )
    );
    expect(attest(where, "--check").stderr).toContain(
      "bound to a different target, environment, check definition, or authority"
    );
    writeStatements(missingWorker);
    expect(attest(where).status).toBe(0);
    const incomplete = stored<Verdict>(where, VERDICT_PATH);
    expect(
      incomplete.criteria.find(row => row.criterion === "AC6.4")?.verdict
    ).toBe("unknown");
    expect(
      incomplete.criteria.find(row => row.criterion === "AC5.5")?.rung
    ).toBe("exercised");
  });
});
