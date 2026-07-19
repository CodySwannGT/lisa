/**
 * `lisa check-learnings-budget` — fail CI when a project's learnings file breaks
 * its hard budget.
 *
 * This is the delivery vehicle that carries the budget gate (built into Lisa's
 * core) out to every host project's CI: the Lisa-managed reusable quality
 * workflow runs `bunx @codyswann/lisa check-learnings-budget`, which resolves
 * the project's learnings file from `.lisa.config.json` and checks it against
 * the shared contract. The learnings path is ALWAYS resolved through the
 * executable config resolver — never hardcoded — so a project that relocates
 * its rules directory is still gated at the right file. A project with no
 * learnings file is the common, expected case and passes silently (exit 0), so
 * hosts that have never recorded a learning stay green with zero configuration.
 * @module cli/check-learnings-budget-cmd
 */
import * as path from "node:path";
import {
  checkLearningsBudget,
  formatDiagnosticPath,
} from "../core/learnings-budget-check.js";
import {
  readProjectConfig,
  resolveProjectLearningsFile,
} from "../core/project-config.js";

/** Injectable collaborators for {@link runCheckLearningsBudget}. */
export interface CheckLearningsBudgetDependencies {
  /** Working directory used to resolve the config and default file. */
  readonly cwd?: string;
  /** Sink for the pass / missing informational line (defaults to stdout). */
  readonly log?: (message: string) => void;
  /** Sink for the violation diagnostic (defaults to stderr). */
  readonly error?: (message: string) => void;
}

/**
 * Resolve the learnings file to check: an explicit path argument wins;
 * otherwise the project config's resolved learnings path (never hardcoded).
 * @param fileArg - Optional explicit learnings file argument
 * @param cwd - Working directory the run is anchored to
 * @returns Absolute learnings file path
 */
async function resolveLearningsPath(
  fileArg: string | undefined,
  cwd: string
): Promise<string> {
  if (fileArg !== undefined) {
    return path.resolve(cwd, fileArg);
  }
  const config = await readProjectConfig(cwd);
  return path.resolve(cwd, resolveProjectLearningsFile(config));
}

/**
 * Run the budget check for one project and return the intended process exit
 * code (0 pass or missing, 1 violation). Never throws for an expected
 * condition — a missing learnings file resolves to a silent, successful pass.
 * @param fileArg - Optional explicit learnings file to check (default: resolved
 *   from `.lisa.config.json`)
 * @param dependencies - Injectable collaborators for tests
 * @returns Process exit code
 */
export async function runCheckLearningsBudget(
  fileArg: string | undefined,
  dependencies: CheckLearningsBudgetDependencies = {}
): Promise<number> {
  const cwd = dependencies.cwd ?? process.cwd();
  const log = dependencies.log ?? ((message: string) => console.log(message));
  const error =
    dependencies.error ?? ((message: string) => console.error(message));
  const resolvedFile = await resolveLearningsPath(fileArg, cwd);
  const result = await checkLearningsBudget(resolvedFile);
  if (result.kind === "missing") {
    log(
      `no learnings file at ${formatDiagnosticPath(resolvedFile)} — nothing to check`
    );
    return 0;
  }
  if (result.kind === "violation") {
    error(
      `check-learnings-budget: ${formatDiagnosticPath(resolvedFile)}: ${result.detail}`
    );
    return 1;
  }
  log(
    `${formatDiagnosticPath(resolvedFile)}: learnings budget passed (${result.entryCount}/${result.maxEntries} entries, ${result.measuredTokens}/${result.maxTokens} maxTokens)`
  );
  return 0;
}
