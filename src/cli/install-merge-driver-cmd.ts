/**
 * `lisa install-merge-driver` — register the project-learnings union merge
 * driver in the current repository's local git config.
 *
 * `lisa apply` already does this through the `EnsureLearningsMergeDriver`
 * migration, so this command exists for the cases apply does not cover: a fresh
 * clone or worktree that has not been applied yet, and CI-like environments
 * where the bootstrap guard suppresses apply. It is also the command the
 * learnings budget gate names when it detects a conflict-corrupted ledger.
 * @module cli/install-merge-driver-cmd
 */
import * as path from "node:path";
import { installLearningsMergeDriver } from "../core/learnings-merge-driver-install.js";

/** Injectable collaborators for {@link runInstallMergeDriver}. */
export interface InstallMergeDriverDependencies {
  /** Working directory used to resolve a relative project path. */
  readonly cwd?: string;
  /** Sink for the outcome line (defaults to stdout). */
  readonly log?: (message: string) => void;
  /** Sink for a real registration failure (defaults to stderr). */
  readonly error?: (message: string) => void;
}

/**
 * Register the merge driver for one project.
 * Exit code distinguishes a benign non-event from a real failure: a directory
 * that is not a git repository passes (nothing to register), but a git-config
 * write that failed exits non-zero. Reporting success there would tell an
 * operator the ledger is protected when it is not.
 * @param targetPath - Optional project directory (default: current directory)
 * @param dependencies - Injectable collaborators for tests
 * @returns Process exit code: 0 registered/unchanged/not-a-repo, 1 failed
 */
export async function runInstallMergeDriver(
  targetPath: string | undefined,
  dependencies: InstallMergeDriverDependencies = {}
): Promise<number> {
  const cwd = dependencies.cwd ?? process.cwd();
  const log = dependencies.log ?? ((message: string) => console.log(message));
  const error =
    dependencies.error ?? ((message: string) => console.error(message));
  const projectRoot = path.resolve(cwd, targetPath ?? ".");
  const result = await installLearningsMergeDriver(projectRoot);
  if (result.kind === "failed") {
    error(`install-merge-driver: ${result.detail}`);
    return 1;
  }
  log(`install-merge-driver: ${result.detail}`);
  return 0;
}
