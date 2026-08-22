/**
 * Unit tests for the wiring and ratchet rules of
 * scripts/check-required-check-promotions.mjs (issue #2509).
 *
 * Split from `required-check-promotions.test.ts`, which owns the evidence
 * rules. This file pins the three ways a promotion goes wrong that were
 * MEASURED rather than reasoned about: a context no job reports, a context on a
 * `paths:`-filtered workflow, and a promotion nobody recorded at all.
 *
 * @module tests/unit/scripts/required-check-promotions.wiring
 */
import { describe, expect, it } from "vitest";
import { evaluate } from "../../../scripts/check-required-check-promotions.mjs";
import {
  ACTIONS_ID,
  AST_GREP_CONTEXT,
  BARE_CONTEXT,
  CI_WORKFLOW,
  makeRoot,
  makeWiredRoot,
  provenHeadroom,
  QUALITY_WORKFLOW,
  workflowYaml,
} from "./required-check-promotions-helpers.js";

const LINT_CONTEXT = "🔍 Quality Checks / 🧹 Lint";
const NIGHTLY_WORKFLOW = ".github/workflows/nightly.yml";
const NIGHTLY_CONTEXT = "🌙 Nightly E2E Health / 🌙 Gate";

const rules = (result: { violations: readonly { rule: string }[] }): string[] =>
  result.violations.map(v => v.rule);
const debtRules = (result: { debts: readonly { rule: string }[] }): string[] =>
  result.debts.map(d => d.rule);

/**
 * Build a root carrying one required context and one ledger entry for it.
 *
 * @param context - the required context.
 * @param entry - the ledger entry body, minus its context.
 * @param options - extra surfaces to write.
 * @param options.workflows - workflow relative path → YAML text.
 * @param options.frozen - contexts listed in `grandfathered_contexts`.
 * @returns absolute path to the created root.
 */
function rootWith(
  context: string,
  entry: Record<string, unknown>,
  options: {
    workflows?: Record<string, string>;
    frozen?: readonly string[];
  } = {}
): string {
  return makeRoot({
    required: { [context]: ACTIONS_ID },
    workflows: options.workflows,
    ledger: {
      schema_version: 1,
      grandfathered_contexts: options.frozen ?? [],
      promotions: [{ context, integration_id: ACTIONS_ID, ...entry }],
    },
  });
}

describe("evaluate — the promotion precondition", () => {
  it("passes a correctly wired, fully proven promotion", () => {
    const result = evaluate(makeWiredRoot());
    expect(result.violations).toEqual([]);
    expect(result.debts).toEqual([]);
    expect(result.covered).toBe(1);
  });

  it("refuses a required context with no ledger entry", () => {
    // This is the precondition itself: you cannot add a context without
    // recording what proves it safe.
    const root = makeRoot({
      required: { [AST_GREP_CONTEXT]: ACTIONS_ID },
      ledger: { schema_version: 1, grandfathered_contexts: [], promotions: [] },
    });
    expect(rules(evaluate(root))).toEqual(["missing-promotion-entry"]);
  });

  it("refuses a ledger entry for a context nothing declares", () => {
    const root = makeRoot({
      ledger: {
        schema_version: 1,
        grandfathered_contexts: [],
        promotions: [
          {
            context: "🔍 Quality Checks / 👻 Ghost",
            integration_id: ACTIONS_ID,
            headroom: provenHeadroom(),
          },
        ],
      },
    });
    expect(rules(evaluate(root))).toEqual(["orphan-promotion-entry"]);
  });

  it("refuses a context whose caller job name does not match the workflow", () => {
    // Measured failure mode 1. rails/github-rulesets/quality-checks.json mixes
    // emoji and non-emoji job names in one file. A context added by symmetry
    // with the TypeScript template names a job that never reports, and every
    // pull request in that repository then waits forever.
    const root = rootWith(
      AST_GREP_CONTEXT,
      {
        caller_workflow: CI_WORKFLOW,
        caller_job: "quality",
        called_workflow: QUALITY_WORKFLOW,
        job_id: "sg_scan",
        headroom: provenHeadroom(),
      },
      {
        workflows: {
          [CI_WORKFLOW]: workflowYaml({ jobs: { quality: "Quality Checks" } }),
          [QUALITY_WORKFLOW]: workflowYaml({
            jobs: { sg_scan: "🔎 Structural Rules" },
          }),
        },
      }
    );
    expect(rules(evaluate(root))).toEqual(["caller-job-name-mismatch"]);
  });

  it("refuses a context whose called job is absent from the reusable workflow", () => {
    expect(rules(evaluate(makeWiredRoot({ job_id: "lint" })))).toEqual([
      "called-job-missing",
    ]);
  });

  it("refuses a context reported by a path-filtered workflow", () => {
    // Measured failure mode 2, on PR #2496: a filtered workflow does not run,
    // so the context never reports and the pull request waits forever. Not
    // "runs and passes" — never reports at all.
    const root = rootWith(
      BARE_CONTEXT,
      {
        caller_workflow: ".github/workflows/plugins-sync.yml",
        caller_job: "sync",
        headroom: provenHeadroom(),
      },
      {
        workflows: {
          ".github/workflows/plugins-sync.yml": workflowYaml({
            paths: ["plugins/**"],
            jobs: { sync: BARE_CONTEXT },
          }),
        },
      }
    );
    expect(rules(evaluate(root))).toEqual(["path-filtered-workflow"]);
  });

  it("refuses a context whose workflow never runs on pull_request", () => {
    const root = rootWith(
      NIGHTLY_CONTEXT,
      {
        caller_workflow: NIGHTLY_WORKFLOW,
        caller_job: "health",
        called_workflow: QUALITY_WORKFLOW,
        job_id: "gate",
        headroom: provenHeadroom(),
      },
      {
        workflows: {
          [NIGHTLY_WORKFLOW]: workflowYaml({
            pullRequest: false,
            jobs: { health: "🌙 Nightly E2E Health" },
          }),
          [QUALITY_WORKFLOW]: workflowYaml({ jobs: { gate: "🌙 Gate" } }),
        },
      }
    );
    expect(rules(evaluate(root))).toEqual(["pull-request-trigger-missing"]);
  });

  it("does not demand a workflow for a check GitHub Actions does not report", () => {
    // CodeRabbit and GitGuardian are Apps. There is no job to name, so the
    // wiring rules cannot apply — but the headroom rule still does.
    const root = makeRoot({
      required: { CodeRabbit: 347_564 },
      ledger: {
        schema_version: 1,
        grandfathered_contexts: [],
        promotions: [
          {
            context: "CodeRabbit",
            integration_id: 347_564,
            headroom: provenHeadroom(),
          },
        ],
      },
    });
    expect(evaluate(root).violations).toEqual([]);
  });
});

describe("evaluate — the grandfather ratchet", () => {
  it("reports an incumbent's unproven budget as debt without failing the build", () => {
    // Incumbents are recorded with their debt named, not silently exempted.
    // Reddening main to punish yesterday's promotions gets the guard deleted.
    const root = makeWiredRoot(
      {
        headroom: {
          status: "grandfathered",
          debt: "sonar-secrets' 60s budget was sized by analogy from a plugin-sync-scripts probe (#2490); never re-measured against a reproduced sonar-secrets timeout",
        },
      },
      [AST_GREP_CONTEXT]
    );
    const result = evaluate(root);
    expect(result.violations).toEqual([]);
    expect(debtRules(result)).toEqual(["grandfathered-headroom"]);
  });

  it("refuses to grandfather a context that is not in the frozen list", () => {
    // The ratchet. Incumbency was fixed when the ledger was written; a new
    // promotion cannot buy its way in by claiming to be old.
    const root = makeWiredRoot({
      headroom: { status: "grandfathered", debt: "not measured" },
    });
    expect(rules(evaluate(root))).toEqual(["grandfather-not-frozen"]);
  });

  it("refuses a grandfathered entry that does not say what is unproven", () => {
    const root = rootWith(
      AST_GREP_CONTEXT,
      { headroom: { status: "grandfathered" } },
      { frozen: [AST_GREP_CONTEXT] }
    );
    expect(rules(evaluate(root))).toEqual(["grandfather-missing-debt"]);
  });

  it("downgrades a grandfathered entry's wiring problems to debt, not violations", () => {
    const root = rootWith(
      NIGHTLY_CONTEXT,
      {
        caller_workflow: NIGHTLY_WORKFLOW,
        caller_job: "health",
        called_workflow: QUALITY_WORKFLOW,
        job_id: "gate",
        headroom: {
          status: "grandfathered",
          debt: "scheduled workflow, never measured",
        },
      },
      {
        workflows: {
          [NIGHTLY_WORKFLOW]: workflowYaml({
            pullRequest: false,
            jobs: { health: "🌙 Nightly E2E Health" },
          }),
          [QUALITY_WORKFLOW]: workflowYaml({ jobs: { gate: "🌙 Gate" } }),
        },
        frozen: [NIGHTLY_CONTEXT],
      }
    );
    const result = evaluate(root);
    expect(result.violations).toEqual([]);
    expect(debtRules(result)).toContain("pull-request-trigger-missing");
  });
});

describe("evaluate — refusing to answer", () => {
  it("refuses rather than passing when the ledger is absent", () => {
    // A guard that silently passes on a missing declaration is worse than no
    // guard: it teaches people the surface is covered.
    const root = makeRoot({ required: { [LINT_CONTEXT]: ACTIONS_ID } });
    expect(rules(evaluate(root))).toEqual(["ledger-missing"]);
  });

  it("refuses when the ledger names the same context twice", () => {
    const entry = {
      context: LINT_CONTEXT,
      integration_id: ACTIONS_ID,
      caller_workflow: CI_WORKFLOW,
      caller_job: "quality",
      called_workflow: QUALITY_WORKFLOW,
      job_id: "lint",
      headroom: provenHeadroom(),
    };
    const root = makeRoot({
      required: { [LINT_CONTEXT]: ACTIONS_ID },
      workflows: {
        [CI_WORKFLOW]: workflowYaml({ jobs: { quality: "🔍 Quality Checks" } }),
        [QUALITY_WORKFLOW]: workflowYaml({ jobs: { lint: "🧹 Lint" } }),
      },
      ledger: {
        schema_version: 1,
        grandfathered_contexts: [],
        promotions: [entry, entry],
      },
    });
    expect(rules(evaluate(root))).toContain("duplicate-promotion-entry");
  });
});
