/**
 * `lisa deploy-status-sync` — the DSS-2 transition engine entry point.
 *
 * Given a deploy event (environment or branch + commit range), extract the
 * work-item refs the range shipped, plan transitions over the config-sourced
 * deploy ladder (pure planner), and execute them idempotently through the
 * tracker adapter. Exit code 0 covers success INCLUDING explanatory no-ops
 * and skips — a deploy job must not gate on tracker vocabulary; 1 is
 * reserved for genuine errors (config validation, git/gh/API failures,
 * unknown environment, or any per-item transition failure — remaining items
 * are still processed first).
 * @module cli/deploy-status-sync-cmd
 */
import {
  resolveRunContext,
  runResolved,
  type DeployStatusSyncDependencies,
  type DeployStatusSyncOptions,
  type Sinks,
} from "./deploy-status-sync-engine.js";

export type {
  DeployStatusSyncDependencies,
  DeployStatusSyncOptions,
} from "./deploy-status-sync-engine.js";

/**
 * Validate the mutually-exclusive event selector and range options.
 * @param options - CLI options
 * @returns The normalized range, or an error message
 */
function normalizeInputs(
  options: DeployStatusSyncOptions
): { readonly range: string } | { readonly problem: string } {
  const hasEnvironment = options.environment !== undefined;
  const hasBranch = options.branch !== undefined;
  if (hasEnvironment === hasBranch) {
    return {
      problem:
        "Pass exactly one of --environment <env> or --branch <branch> to identify the deploy target.",
    };
  }
  if (options.range !== undefined) return { range: options.range };
  if (options.before !== undefined && options.after !== undefined) {
    return { range: `${options.before}..${options.after}` };
  }
  return {
    problem:
      "Pass the deployed commit range as --range <base>..<head> (or --before <sha> --after <sha>).",
  };
}

/**
 * Run the deploy-status-sync engine for one deploy event.
 * @param options - CLI options
 * @param deps - Injectable collaborators for tests
 * @returns Intended process exit code
 */
export async function runDeployStatusSync(
  options: DeployStatusSyncOptions,
  deps: DeployStatusSyncDependencies = {}
): Promise<number> {
  const log = deps.log ?? ((message: string): void => console.log(message));
  const error =
    deps.error ?? ((message: string): void => console.error(message));
  // In --json mode the machine payload is the ONLY stdout content; human
  // narration would corrupt consumers that parse the output.
  const human = options.json === true ? (): void => undefined : log;
  const sinks: Sinks = { log, error, human };
  const cwd = deps.cwd ?? process.cwd();
  const normalized = normalizeInputs(options);
  if ("problem" in normalized) {
    error(normalized.problem);
    return 1;
  }
  try {
    const context = await resolveRunContext(options, cwd);
    if ("problem" in context) {
      error(context.problem);
      return 1;
    }
    return await runResolved(context, normalized.range, options, deps, sinks);
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }
}
