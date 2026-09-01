/**
 * `lisa check-learnings-budget` — fail CI when a project's learnings file breaks
 * its hard budget.
 *
 * This is the delivery vehicle that carries the budget gate (built into Lisa's
 * core) out to every host project's CI: the Lisa-managed reusable quality
 * workflow invokes this command with `bunx`, which resolves the project's
 * learnings file from `.lisa.config.json` and checks it against the shared
 * contract. The learnings path is ALWAYS resolved through the
 * executable config resolver — never hardcoded — so a project that relocates
 * its rules directory is still gated at the right file. A project with no
 * learnings file is the common, expected case and passes silently (exit 0), so
 * hosts that have never recorded a learning stay green with zero configuration.
 * @module cli/check-learnings-budget-cmd
 */
import * as path from "node:path";
import {
  checkLearningsBudget,
  formatBudgetVerdict,
  formatDiagnosticPath,
} from "../core/learnings-budget-check.js";
import { resolveLearningsOverflowFile } from "../core/learnings-overflow-path.js";
import {
  readProjectConfig,
  resolveProjectLearningsFile,
} from "../core/project-config.js";

/** Injectable collaborators for {@link runCheckLearningsBudget}. */
export interface CheckLearningsBudgetDependencies {
  /** Check the configured ledger's sibling overflow rather than the ledger. */
  readonly overflow?: boolean;
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
 * @param overflow - Whether to resolve the configured ledger's overflow sibling
 * @returns Absolute learnings file path
 */
async function resolveLearningsPath(
  fileArg: string | undefined,
  cwd: string,
  overflow: boolean
): Promise<string> {
  if (fileArg !== undefined) {
    return path.resolve(cwd, fileArg);
  }
  const config = await readProjectConfig(cwd);
  const ledger = resolveProjectLearningsFile(config);
  return path.resolve(
    cwd,
    overflow ? resolveLearningsOverflowFile(ledger) : ledger
  );
}

/**
 * Run the budget check for one project and return the intended process exit
 * code (0 pass, saturated, or missing; 1 violation). Never throws for an
 * expected condition — a missing learnings file resolves to a silent,
 * successful pass.
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
  const overflow = dependencies.overflow ?? false;
  if (overflow && fileArg !== undefined) {
    error(
      "check-learnings-budget: --overflow resolves from .lisa.config.json and cannot be combined with an explicit path"
    );
    return 1;
  }
  const resolvedFile = await resolveLearningsPath(fileArg, cwd, overflow);
  const surface = overflow ? "overflow" : "ledger";
  const result = await checkLearningsBudget(resolvedFile, { surface });
  if (result.kind === "missing") {
    log(
      overflow
        ? `no learnings overflow file at ${formatDiagnosticPath(resolvedFile)} — nothing to check`
        : `no learnings file at ${formatDiagnosticPath(resolvedFile)} — nothing to check`
    );
    return 0;
  }
  if (result.kind === "violation") {
    error(
      `check-learnings-budget: ${formatDiagnosticPath(resolvedFile)}: ${result.detail}`
    );
    return 1;
  }
  // A saturated ledger logs a distinct `learnings budget saturated` verdict and
  // still exits 0 — deliberately, and not an oversight: the ledger is a shared
  // corpus that fills up over weeks, so failing here would stop a host
  // project's unrelated pull request for a state its change never created, and
  // the remedy (retire or promote an entry) belongs to the gardener, not to
  // whoever is mid-change. See describeLearningsSaturation.
  log(formatBudgetVerdict(resolvedFile, result, { surface }));
  return 0;
}
