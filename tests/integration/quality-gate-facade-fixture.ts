import * as fs from "fs-extra";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { QUALITY_JOB_GATES } from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { loadWorkflow } from "../helpers/workflow-test-utils.js";
import type {
  ParsedWorkflow,
  WorkflowStep,
} from "../helpers/workflow-test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The reusable quality workflow under test. */
export const QUALITY_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "quality.yml"
);

/** The shipped gate registry the workflow resolves through. */
export const GATES_SCRIPT = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-gates.mjs"
);

/** The one field of a registry entry these tests read. */
export interface GateDefinition {
  label: string;
}

/** One converted job, its gate, and the steps on each path. */
export interface ConvertedJob {
  job: string;
  jobName: string;
  gate: string;
  gateStep: string;
  fallbackSteps: string[];
}

/** A converted job before its gate is attached from the shipped registry. */
type ConvertedJobSource = Omit<ConvertedJob, "gate">;

/** The shipped job → gate table, as this file consumes it. */
const SHIPPED_JOB_GATES = QUALITY_JOB_GATES as Record<
  string,
  string | undefined
>;

/** The condition selecting the project's own task. */
export const CONFIGURED = "steps.gate.outputs.configured == 'true'";

/**
 * The condition selecting Lisa's shipped tooling.
 *
 * `== 'false'`, deliberately, not `!= 'true'`. There are THREE states, and the
 * negative form collapses two of them: a project that declared the gate `off`
 * and a project that never mentioned it both failed `!= 'true'`, so the
 * fallback ran either way and `off` could not turn a job off. That shipped, and
 * two zero-suite repositories went red on a job whose declaration said not to
 * run it.
 */
export const NOT_CONFIGURED = "steps.gate.outputs.configured == 'false'";

/** The condition value emitted when the project declared the gate `off`. */
export const DECLARED_OFF = "steps.gate.outputs.configured == 'off'";

/**
 * Every job converted to the gate façade.
 *
 * Deliberately not counted in prose: the count has been wrong twice already
 * ("thirteen" survived two additions). The list is the count.
 *
 * Kept exhaustive by `quality-gate-moment-input.test.ts`, which fails if the
 * workflow contains a resolve step this list omits. `test_node_suites` shipped
 * uncovered for exactly that reason: it was added with an identical resolve
 * block, and nothing here noticed.
 *
 * `jobName` is a LITERAL, not a lookup. A job name is a branch-protection
 * context matched by exact string in a GitHub ruleset, and a wrong one has
 * already merged red pull requests in this portfolio, so this has to fail on a
 * rename rather than follow it. The names are then cross-checked against
 * `REGISTRY[gate].label` — the same source `contextsFor` derives the required
 * contexts from — so the workflow and the registry cannot drift apart.
 *
 * `gate` is the opposite: NOT a literal here, looked up from
 * `QUALITY_JOB_GATES` in the shipped registry by `CONVERTED` below. A job name
 * has to fail on a rename because a ruleset matches it by string; a gate id has
 * to be shared, because a consumer migrating off `skip_jobs` needs the same
 * pairing and cannot read this file.
 */
const CONVERTED_JOBS: ConvertedJobSource[] = [
  {
    job: "lint",
    jobName: "🧹 Lint",
    gateStep: "🧹 Run the code-style gate",
    fallbackSteps: [
      "🦀 Verify oxlint is installed",
      "🧹 Run linter (oxlint + eslint)",
    ],
  },
  {
    job: "lint_slow",
    jobName: "🐢 Slow Lint Rules",
    gateStep: "🐢 Run the code-style-slow gate",
    fallbackSteps: ["🐢 Run slow lint rules"],
  },
  {
    job: "typecheck",
    jobName: "🔍 Type Check",
    gateStep: "🔍 Run the type-correctness gate",
    fallbackSteps: ["🔍 Run type check"],
  },
  {
    job: "build",
    jobName: "🏗️ Build",
    gateStep: "🏗️ Run the build-integrity gate",
    fallbackSteps: ["🏗️ Build project"],
  },
  {
    job: "format",
    jobName: "📐 Check Formatting",
    gateStep: "📐 Run the format-conformance gate",
    fallbackSteps: ["📐 Check formatting"],
  },
  {
    job: "test_unit",
    jobName: "🧪 Run Unit Tests",
    gateStep: "🧪 Run the test-correctness gate",
    fallbackSteps: [
      "🧪 Run unit tests with coverage",
      "⏭️ Skip unit tests (no test:unit script)",
    ],
  },
  {
    job: "test_integration",
    jobName: "🧪 Run Integration Tests",
    gateStep: "🧪 Run the test-integration gate",
    fallbackSteps: [
      "🧪 Run integration tests",
      "⏭️ Skip integration tests (no test:integration script)",
    ],
  },
  {
    job: "performance_budget",
    jobName: "⚡ Performance Budget",
    gateStep: "⚡ Run the performance-budget gate",
    // The fallback runs `lighthouse:check` while the gate's declared task is
    // `perf:check`. That is not drift: the registry names the CONCERN, as it
    // does everywhere else, and the fallback reproduces what consumers already
    // run through the standalone `lighthouse.yml` they wire by hand. Keeping
    // them different is what lets that workflow be deleted without a
    // same-day `package.json` edit in every consumer.
    fallbackSteps: [
      "⚡ Run the performance budget (lighthouse:check)",
      "⏭️ Skip the performance budget (no export:web script)",
    ],
  },
  {
    job: "test_node_suites",
    jobName: "🧪 Run .mjs Suites",
    gateStep: "🧪 Run the mjs-suites gate",
    // This job's FALLBACK deliberately diverges from the others: elsewhere the
    // fallback reproduces what the project did before the façade, and here
    // that was nothing at all, so preserving it would have made the fix
    // opt-in. The divergence is in what the fallback DOES; its structure is
    // the same, which is why it belongs under the same drift assertions.
    fallbackSteps: ["🧪 Run .mjs suites (lisa-test-node)"],
  },
  {
    job: "environment_reset",
    jobName: "♻️ Environment Reset Guard",
    gateStep: "♻️ Run the environment-reset gate",
    // Lisa ships no implementation behind the environment facade, so this
    // fallback announces the absence rather than substituting for it. The
    // structure is still the façade's, which is why the drift assertions apply.
    fallbackSteps: ["♻️ No environment reset adapter declared"],
  },
  {
    job: "environment_reseed",
    jobName: "🌱 Environment Reseed Guard",
    gateStep: "🌱 Run the environment-reseed gate",
    fallbackSteps: ["🌱 No environment reseed adapter declared"],
  },
  {
    job: "npm_security_scan",
    jobName: "🔒 Security Scan",
    gateStep: "🔒 Run the dependency-vulnerability gate",
    // Both fallback steps, not just the audit itself: the exclusion loader is
    // npm/yarn/bun `audit` specifics (GHSA and CVE id files), and a project
    // that declared its own task may use a scanner with no notion of them.
    // Leaving it running would compute exclusions nothing consumes.
    fallbackSteps: ["📋 Load audit exclusions", "🔒 Run security audit"],
  },
  {
    job: "dead_code",
    jobName: "🗑️ Dead Code Detection",
    gateStep: "🗑️ Run the dead-code gate",
    fallbackSteps: ["🗑️ Run dead code detection (knip)"],
  },
  {
    job: "sg_scan",
    jobName: "🔎 AST Grep Scan",
    gateStep: "🔎 Run the structural-rules gate",
    // The whole ast-grep pipeline hangs off `check_config`, so gating that one
    // discovery step on the fallback path takes the scan, the rule tests and
    // their ⏭️ notices with it.
    fallbackSteps: [
      "🔍 Check for sgconfig.yml",
      "⏭️ AST Grep Skipped (no config)",
    ],
  },
  {
    job: "test_mutation",
    jobName: "🧬 Mutation Testing Gate",
    gateStep: "🧬 Run the test-meaningfulness gate",
    // The ⏭️ notice hangs off `check_script`, not off the gate, so it stays on
    // the no-script path rather than the no-gate one. A project that ships the
    // script and declares no gate still runs the fallback.
    fallbackSteps: [
      "🧬 Run mutation-testing gate (diff-only, self-skips when disabled)",
    ],
  },
  {
    job: "verification_coverage",
    jobName: "✅ Verification Coverage",
    gateStep: "✅ Run the coverage-adequacy gate",
    fallbackSteps: ["✅ Require a verification (e2e) spec delta on feat/fix"],
  },
  {
    job: "playwright_e2e_aggregate",
    jobName: "🎭 Playwright E2E Tests",
    gateStep: "🎭 Run the e2e-browser gate",
    // The whole built-in Playwright path, not one command: Lisa's shipped
    // implementation of this gate is a sharded matrix PLUS this merge, and the
    // verdict step that stops the merge from reporting green over failing
    // shards. All three belong to the fallback, because a project that named
    // its own task has said what proves the property and blobs it never wrote
    // cannot judge it. The `(no config)` notice is here for the same reason it
    // is on `sg_scan`: on the configured path an absent config is a hard
    // error, not a notice.
    fallbackSteps: [
      "📥 Download all shard blob reports",
      "🎭 Merge blob reports into HTML",
      "📤 Upload merged Playwright report",
      "🎭 Playwright aggregator skipped (no config)",
      "🚨 Fail if any Playwright shard failed",
    ],
  },
  {
    job: "work_item_traceability",
    jobName: "🔗 Work-Item Traceability",
    gateStep: "🔗 Run the traceability gate",
    // Only the validator itself. `🔗 Resolve the branch-authored commit range`
    // is deliberately NOT here: it computes the event-derived base SHA that
    // BOTH paths are handed, so gating it on the fallback would leave a
    // project's own task without the range `validate-pr` refuses to run
    // without. It proves nothing and can fail nothing, which is what keeps an
    // `off` declaration a no-op job rather than a skipped one.
    fallbackSteps: ["🔗 Validate Work-Item traceability"],
  },
];

/**
 * The converted jobs, each with the gate the SHIPPED registry says it resolves.
 *
 * The pairing used to be written out here as literals, and here was the only
 * place it existed. That made this file the authority on a question consumers
 * have to answer — "which gate replaces `skip_jobs: sg_scan`" — while being a
 * test fixture nothing installs. It now lives in `lisa-gates.mjs` and this
 * reads it, so there is one copy rather than two that can disagree.
 *
 * A job absent from the shipped table throws rather than yielding `undefined`.
 * An undefined gate would flow into `GATE_ID` assertions as a mismatch against
 * a step whose id it could not name, and the resulting failure would describe
 * the workflow rather than the missing table entry.
 */
export const CONVERTED: ConvertedJob[] = CONVERTED_JOBS.map(entry => {
  const gate = SHIPPED_JOB_GATES[entry.job];
  if (gate === undefined) {
    throw new Error(
      `${entry.job} is not in QUALITY_JOB_GATES in all/copy-overwrite/scripts/lisa-gates.mjs. ` +
        "Add it there — that table is what `lisa doctor` and agents in consumer " +
        "checkouts read, and a job missing from it has no migration path off " +
        "`skip_jobs`."
    );
  }
  return { ...entry, gate };
});

/**
 * Steps that carried `continue-on-error` BEFORE this conversion.
 *
 * A failing job that reports green is the exact defect the façade exists to
 * prevent, so the set is pinned rather than checked only on the converted jobs:
 * growing it anywhere in this workflow has to fail here.
 */
export const PREEXISTING_CONTINUE_ON_ERROR = ["📊 SonarCloud Scan"];

/** The parsed workflow. */
export const workflow: ParsedWorkflow = loadWorkflow(QUALITY_YML);

/** The workflow as text, for assertions about comments. */
export const source: string = fs.readFileSync(QUALITY_YML, "utf8");

/**
 * The gate registry, imported from the shipped `.mjs` at call time.
 * @returns The registry keyed by gate id.
 */
export async function loadRegistry(): Promise<Record<string, GateDefinition>> {
  const loaded = (await import(pathToFileURL(GATES_SCRIPT).href)) as {
    REGISTRY: Record<string, GateDefinition>;
  };
  return loaded.REGISTRY;
}

/**
 * The steps of one job.
 * @param job Job id.
 * @returns Its steps.
 */
export const stepsIn = (job: string): WorkflowStep[] =>
  workflow.jobs[job]?.steps ?? [];

/**
 * One named step of one job.
 * @param job Job id.
 * @param name Exact step name.
 * @returns The step, or undefined.
 */
export const stepNamed = (
  job: string,
  name: string
): WorkflowStep | undefined => stepsIn(job).find(step => step.name === name);

/**
 * The gate-resolution step of one job.
 * @param job Job id.
 * @returns The step, or undefined.
 */
export const resolveStep = (job: string): WorkflowStep | undefined =>
  stepsIn(job).find(step => step.id === "gate");
