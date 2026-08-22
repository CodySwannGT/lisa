/**
 * Shared inputs for the hardcoded-invocation suites.
 *
 * The shipped `.mjs` is imported once here rather than in each suite so both
 * read the same table, and the literals every assertion needs — file paths,
 * step names, the fallback condition — are named once so a rename fails in one
 * place instead of drifting between two spellings of the same string.
 *
 * @module tests/integration/hardcoded-invocation-fixture
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The repository root, from this file. */
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The shipped gate registry. */
export const GATES_SCRIPT = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-gates.mjs"
);

/** The condition that selects a job's written-in invocation. */
export const NOT_CONFIGURED = "steps.gate.outputs.configured == 'false'";

/** The step every façade job runs when nothing resolves. */
export const REPORT_STEP = "🚨 Report the unconfigured gate";

/** The reusable quality workflow, repository-relative. */
export const QUALITY_YML = ".github/workflows/quality.yml";

/** The reusable browser-suite workflow, repository-relative. */
export const PLAYWRIGHT_YML = ".github/workflows/playwright-e2e.yml";

/** Both workflows carrying façade jobs. */
export const FACADE_WORKFLOWS: readonly string[] = [
  QUALITY_YML,
  PLAYWRIGHT_YML,
];

/** The shipped pre-push hook template, repository-relative. */
export const PRE_PUSH_HOOK = "typescript/copy-contents/.husky/pre-push";

/** The `pre-push-hook` surface name, as the shipped table spells it. */
export const PRE_PUSH_SURFACE = "pre-push-hook";

/** The `on-edit-hook` surface name, as the shipped table spells it. */
export const ON_EDIT_SURFACE = "on-edit-hook";

/** One inventory entry, as the shipped table publishes it. */
export interface Invocation {
  gate: string;
  moment: string;
  surface: string;
  artifact: string;
  job: string | null;
  command: string;
  steps: string[];
  seedRun: string[] | null;
  facade: string;
}

/** The slice of the registry these suites read. */
export interface GatesModule {
  HARDCODED_INVOCATIONS: Invocation[];
  FACADE_CLASSES: string[];
  QUALITY_JOB_GATES: Record<string, string>;
  REGISTRY: Record<string, { moments: string[] }>;
  MOMENTS: string[];
  isDeclarableAt: (gate: string, moment: string) => boolean;
  unconfiguredAt: (options: {
    gates: object;
    moment: string;
    surface?: string;
    gate?: string;
  }) => { gate: string; declarable: boolean; reason: string }[];
  seedGates: (options: {
    gates?: object;
    scripts?: Record<string, string>;
    runner?: string;
  }) => {
    gates: Record<string, Record<string, unknown>>;
    seeded: { gate: string; moment: string; run: string | null }[];
    skipped: { gate: string; moment: string; reason: string }[];
  };
}

/**
 * Import the shipped gate registry.
 * @returns The registry module.
 */
export async function loadGates(): Promise<GatesModule> {
  return (await import(pathToFileURL(GATES_SCRIPT).href)) as GatesModule;
}

/**
 * One shipped file's contents.
 * @param relative Repository-relative path.
 * @returns The file as text.
 */
export function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}
