import * as fs from "fs-extra";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

/** The condition selecting the project's own task. */
export const CONFIGURED = "steps.gate.outputs.configured == 'true'";

/** The condition selecting Lisa's shipped tooling. */
export const NOT_CONFIGURED = "steps.gate.outputs.configured != 'true'";

/**
 * The ten jobs converted to the gate façade.
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
 */
export const CONVERTED: ConvertedJob[] = [
  {
    job: "lint",
    jobName: "🧹 Lint",
    gate: "code-style",
    gateStep: "🧹 Run the code-style gate",
    fallbackSteps: [
      "🦀 Verify oxlint is installed",
      "🧹 Run linter (oxlint + eslint)",
    ],
  },
  {
    job: "lint_slow",
    jobName: "🐢 Slow Lint Rules",
    gate: "code-style-slow",
    gateStep: "🐢 Run the code-style-slow gate",
    fallbackSteps: ["🐢 Run slow lint rules"],
  },
  {
    job: "typecheck",
    jobName: "🔍 Type Check",
    gate: "type-correctness",
    gateStep: "🔍 Run the type-correctness gate",
    fallbackSteps: ["🔍 Run type check"],
  },
  {
    job: "build",
    jobName: "🏗️ Build",
    gate: "build-integrity",
    gateStep: "🏗️ Run the build-integrity gate",
    fallbackSteps: ["🏗️ Build project"],
  },
  {
    job: "format",
    jobName: "📐 Check Formatting",
    gate: "format-conformance",
    gateStep: "📐 Run the format-conformance gate",
    fallbackSteps: ["📐 Check formatting"],
  },
  {
    job: "test_unit",
    jobName: "🧪 Run Unit Tests",
    gate: "test-correctness",
    gateStep: "🧪 Run the test-correctness gate",
    fallbackSteps: [
      "🧪 Run unit tests with coverage",
      "⏭️ Skip unit tests (no test:unit script)",
    ],
  },
  {
    job: "test_integration",
    jobName: "🧪 Run Integration Tests",
    gate: "test-integration",
    gateStep: "🧪 Run the test-integration gate",
    fallbackSteps: [
      "🧪 Run integration tests",
      "⏭️ Skip integration tests (no test:integration script)",
    ],
  },
  {
    job: "test_node_suites",
    jobName: "🧪 Run .mjs Suites",
    gate: "test-node-suites",
    gateStep: "🧪 Run the mjs-suites gate",
    // This job's FALLBACK deliberately diverges from the others: elsewhere the
    // fallback reproduces what the project did before the façade, and here
    // that was nothing at all, so preserving it would have made the fix
    // opt-in. The divergence is in what the fallback DOES; its structure is
    // the same, which is why it belongs under the same drift assertions.
    fallbackSteps: ["🧪 Run .mjs suites (lisa-test-node)"],
  },
  {
    job: "dead_code",
    jobName: "🗑️ Dead Code Detection",
    gate: "dead-code",
    gateStep: "🗑️ Run the dead-code gate",
    fallbackSteps: ["🗑️ Run dead code detection (knip)"],
  },
  {
    job: "sg_scan",
    jobName: "🔎 AST Grep Scan",
    gate: "structural-rules",
    gateStep: "🔎 Run the structural-rules gate",
    // The whole ast-grep pipeline hangs off `check_config`, so gating that one
    // discovery step on the fallback path takes the scan, the rule tests and
    // their ⏭️ notices with it.
    fallbackSteps: [
      "🔍 Check for sgconfig.yml",
      "⏭️ AST Grep Skipped (no config)",
    ],
  },
];

/**
 * Steps that carried `continue-on-error` BEFORE this conversion.
 *
 * A failing job that reports green is the exact defect the façade exists to
 * prevent, so the set is pinned rather than checked only on the ten jobs:
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
