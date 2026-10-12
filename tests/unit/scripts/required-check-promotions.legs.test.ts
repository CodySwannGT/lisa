/**
 * The promotion guard's reading of a required context that a declared gate
 * leg posts rather than a hand-written job (CodySwannGT/lisa#3052).
 *
 * A leg has no static `name:` to compare: the `declared_gates` matrix job is
 * named `${{ matrix.label }}`, and the label comes from the registry. So a
 * ledger entry names the gate, and the guard has to establish everything that
 * together means the leg posts that exact string. Each case below removes one
 * of those facts and expects the guard to say so.
 * @module tests/unit/scripts/required-check-promotions.legs
 */
import { describe, expect, it } from "vitest";
import { evaluate } from "../../../scripts/check-required-check-promotions.mjs";
import {
  ACTIONS_ID,
  CI_WORKFLOW,
  makeRoot,
  provenHeadroom,
  QUALITY_WORKFLOW,
  workflowYaml,
} from "./required-check-promotions-helpers.js";

const TYPE_CHECK_CONTEXT = "🔍 Quality Checks / 🔍 Type Check";
const LINT_CONTEXT = "🔍 Quality Checks / 🧹 Lint";
const TYPE_CORRECTNESS = "type-correctness";
const MATRIX_LABEL = "$" + "{{ matrix.label }}";

const rules = (result: { violations: readonly { rule: string }[] }): string[] =>
  result.violations.map(v => v.rule);

/**
 * A root whose one required context is posted by a declared gate leg.
 * @param options - what to vary.
 * @param options.context - the required context.
 * @param options.gate - the gate the ledger entry names.
 * @param options.declared - the pull-request declaration, or undefined for none.
 * @param options.matrixName - the `declared_gates` job's `name:`.
 * @returns absolute path to the created root.
 */
function legRoot(options: {
  context?: string;
  gate?: string;
  declared?: unknown;
  matrixName?: string;
}): string {
  const context = options.context ?? TYPE_CHECK_CONTEXT;
  const gate = options.gate ?? TYPE_CORRECTNESS;
  return makeRoot({
    required: { [context]: ACTIONS_ID },
    workflows: {
      [CI_WORKFLOW]: workflowYaml({ jobs: { quality: "🔍 Quality Checks" } }),
      [QUALITY_WORKFLOW]: workflowYaml({
        jobs: { declared_gates: options.matrixName ?? MATRIX_LABEL },
      }),
    },
    lisaConfig:
      options.declared === undefined
        ? {}
        : { gates: { [gate]: { "pull-request": options.declared } } },
    ledger: {
      schema_version: 1,
      grandfathered_contexts: [],
      promotions: [
        {
          context,
          integration_id: ACTIONS_ID,
          caller_workflow: CI_WORKFLOW,
          caller_job: "quality",
          called_workflow: QUALITY_WORKFLOW,
          job_id: "declared_gates",
          gate,
          headroom: provenHeadroom(),
        },
      ],
    },
  });
}

describe("a required context posted by a declared gate leg", () => {
  it("passes when the gate is declared, its label matches and no job owns it", () => {
    expect(rules(evaluate(legRoot({ declared: "required" })))).toEqual([]);
  });

  it.each([["optional"], [{ level: "required", run: "typecheck" }]])(
    "accepts the running declaration %j",
    declared => {
      expect(rules(evaluate(legRoot({ declared })))).toEqual([]);
    }
  );

  it.each([[undefined], ["off"], [null], [{ run: "typecheck" }]])(
    "refuses the declaration %j, under which no leg posts the context",
    declared => {
      expect(rules(evaluate(legRoot({ declared })))).toContain(
        "leg-gate-undeclared"
      );
    }
  );

  it("refuses a matrix job not named by the gate label", () => {
    expect(
      rules(evaluate(legRoot({ declared: "required", matrixName: "Legs" })))
    ).toEqual(["called-job-missing"]);
  });

  it("refuses an entry naming no registry gate", () => {
    expect(
      rules(evaluate(legRoot({ declared: "required", gate: "no-such-gate" })))
    ).toEqual(["leg-gate-missing"]);
  });

  it("refuses a gate whose label is not the context", () => {
    expect(
      rules(
        evaluate(legRoot({ declared: "required", gate: "build-integrity" }))
      )
    ).toEqual(["called-job-name-mismatch"]);
  });

  it("refuses a gate a hand-written job still owns", () => {
    expect(
      rules(
        evaluate(
          legRoot({
            context: LINT_CONTEXT,
            gate: "code-style",
            declared: "required",
          })
        )
      )
    ).toEqual(["leg-gate-job-backed"]);
  });
});
