import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Builders for synthetic repository roots used by the
 * `check-required-check-promotions` unit tests.
 *
 * The guard reads four surfaces off disk — ruleset templates, the promotion
 * ledger, `.lisa.config.json`, and workflow YAML. Driving it through real files
 * rather than injected objects is deliberate: every defect this guard exists to
 * catch (#2509) was a mismatch BETWEEN two of those files, so a test that stubs
 * the reads would prove the join logic while assuming away the join.
 */

/** Numeric integration id GitHub Actions reports status checks under. */
export const ACTIONS_ID = 15_368;

/** The context #2506 promotes; the worked example throughout these tests. */
export const AST_GREP_CONTEXT = "🔍 Quality Checks / 🔎 Structural Rules";

/** A context reported by a job in the calling workflow, with no `/` half. */
export const BARE_CONTEXT = "🧩 Plugin artifacts match source";

/** The suite #2490 ran its 16-way probe against. */
export const PROBE_SUBJECT = "plugin-sync-scripts";

/** Calling workflow path used by the wired fixtures. */
export const CI_WORKFLOW = ".github/workflows/ci.yml";

/** Reusable workflow path used by the wired fixtures. */
export const QUALITY_WORKFLOW = ".github/workflows/quality.yml";

/**
 * A headroom block that satisfies every evidence rule, for tests that need a
 * valid baseline to mutate one field of.
 *
 * @returns {object} a fresh `proven` headroom block.
 */
export function provenHeadroom(): Record<string, unknown> {
  return {
    status: "proven",
    budget_ms: 600_000,
    observed_worst_ms: 180,
    observed_on: "pass",
    reproduced:
      "planted a violating fixture and confirmed the check exits 1, then removed it and confirmed exit 0",
    measured_on: "bun run sg:scan at origin/main b671524a7",
    conditions: "load 5.00/6.36/7.04 on 18 cores, 0 vitest processes",
  };
}

/** Shape of a synthetic workflow: its triggers and its jobId → name map. */
type WorkflowSpec = {
  readonly name?: string;
  readonly pullRequest?: boolean;
  readonly paths?: readonly string[];
  readonly jobs: Readonly<Record<string, string>>;
};

/**
 * Render the `on:` block for a synthetic workflow.
 *
 * @param spec - trigger shape.
 * @returns YAML lines.
 */
function triggerLines(spec: WorkflowSpec): readonly string[] {
  if (spec.pullRequest === false) {
    return ["  schedule:", "    - cron: '0 6 * * *'"];
  }
  const filter = spec.paths
    ? ["    paths:", ...spec.paths.map(p => `      - '${p}'`)]
    : [];
  return ["  pull_request:", ...filter];
}

/**
 * Serialize a minimal but structurally real GitHub Actions workflow.
 *
 * @param spec - trigger shape and a jobId → display-name map.
 * @returns YAML text.
 */
export function workflowYaml(spec: WorkflowSpec): string {
  const lines = [
    `name: ${spec.name ?? "CI"}`,
    "",
    "on:",
    ...triggerLines(spec),
    "",
    "jobs:",
    ...Object.entries(spec.jobs).flatMap(([id, jobName]) => [
      `  ${id}:`,
      `    name: ${jobName}`,
      "    runs-on: ubuntu-latest",
    ]),
  ];
  return `${lines.join("\n")}\n`;
}

/** Which of the guard's four input surfaces a synthetic root should carry. */
type RootSpec = {
  /** context → integration id, written into a typescript ruleset template. */
  readonly required?: Readonly<Record<string, number>>;
  /** ledger object; omit to write no ledger at all. */
  readonly ledger?: unknown;
  /** workflow relative path → YAML text. */
  readonly workflows?: Readonly<Record<string, string>>;
  /** `.lisa.config.json` contents; omit to write none. */
  readonly lisaConfig?: unknown;
};

/**
 * Materialize a throwaway repository root on disk.
 *
 * @param spec - which of the four surfaces to write, and with what contents.
 * @returns absolute path to the created root.
 */
export function makeRoot(spec: RootSpec): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-promotions-"));
  if (spec.required) {
    const dir = path.join(root, "typescript", "github-rulesets");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "quality-checks.json"),
      `${JSON.stringify(
        {
          name: "quality checks",
          target: "branch",
          enforcement: "active",
          rules: [
            {
              type: "required_status_checks",
              parameters: {
                required_status_checks: Object.entries(spec.required).map(
                  ([context, integration_id]) => ({ context, integration_id })
                ),
              },
            },
          ],
        },
        null,
        2
      )}\n`
    );
  }
  mkdirSync(path.join(root, ".github"), { recursive: true });
  if (spec.ledger !== undefined) {
    writeFileSync(
      path.join(root, ".github", "required-check-promotions.json"),
      `${JSON.stringify(spec.ledger, null, 2)}\n`
    );
  }
  for (const [relative, body] of Object.entries(spec.workflows ?? {})) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, body);
  }
  if (spec.lisaConfig !== undefined) {
    writeFileSync(
      path.join(root, ".lisa.config.json"),
      `${JSON.stringify(spec.lisaConfig, null, 2)}\n`
    );
  }
  return root;
}

/**
 * Build the standard single-context fixture: one required context reported by
 * a reusable-workflow job, plus both workflows wired correctly.
 *
 * @param overrides - ledger entry fields to replace or add.
 * @param frozen - contexts to list in `grandfathered_contexts`.
 * @returns absolute path to the created root.
 */
export function makeWiredRoot(
  overrides: Record<string, unknown> = {},
  frozen: readonly string[] = []
): string {
  const context = AST_GREP_CONTEXT;
  return makeRoot({
    required: { [context]: ACTIONS_ID },
    workflows: {
      [CI_WORKFLOW]: workflowYaml({
        jobs: { quality: "🔍 Quality Checks" },
      }),
      [QUALITY_WORKFLOW]: workflowYaml({
        jobs: { sg_scan: "🔎 Structural Rules" },
      }),
    },
    ledger: {
      schema_version: 1,
      grandfathered_contexts: frozen,
      promotions: [
        {
          context,
          integration_id: ACTIONS_ID,
          caller_workflow: CI_WORKFLOW,
          caller_job: "quality",
          called_workflow: QUALITY_WORKFLOW,
          job_id: "sg_scan",
          headroom: provenHeadroom(),
          ...overrides,
        },
      ],
    },
  });
}
