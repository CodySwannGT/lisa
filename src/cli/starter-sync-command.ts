import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { unlink } from "node:fs/promises";
import {
  readProjectConfig,
  validateProjectConfig,
} from "../core/project-config.js";
import {
  syncStarterTemplates,
  type StarterSyncResult,
} from "./starter-sync.js";
import {
  commitLanding,
  inspectLanding,
  LANDING_COMMANDS,
  preparePullRequest,
  publishPullRequest,
  releasePullRequestWorktree,
  type LandingCommands,
  type LandingSnapshot,
  type PullRequestLanding,
} from "./pr-landing.js";

/** Headless CLI inputs and optional commit attribution. */
export interface StarterSyncCommandOptions {
  readonly path?: string;
  readonly base?: string;
  readonly workItem?: string;
  readonly coAuthor?: string;
}

/** Shared landing operations and the existing sync engine. */
export interface StarterLandingDependencies extends LandingCommands {
  readonly sync: typeof syncStarterTemplates;
}

/** Observable landing outcome for terminal and automation callers. */
export interface StarterLandingResult {
  readonly state: "current" | "committed" | "pull-request";
  readonly results: readonly StarterSyncResult[];
  readonly commit?: string;
  readonly url?: string;
  readonly worktree?: string;
}

const PULL_REQUEST = "pull-request";
const TITLE = "chore: sync starter updates";
const CONFIG = ".lisa.config.json";

/**
 * Sync in an isolated PR worktree by default, or commit on an explicitly clean tree.
 * @param options - Project path and landing options.
 * @param dependencies - Injectable engine and Git operations.
 * @returns Observable landing outcome.
 */
export async function runStarterSync(
  options: StarterSyncCommandOptions = {},
  dependencies: Partial<StarterLandingDependencies> = {}
): Promise<StarterLandingResult> {
  const deps = {
    ...LANDING_COMMANDS,
    sync: syncStarterTemplates,
    ...dependencies,
  };
  const before = await inspectLanding(path.resolve(options.path ?? "."), deps);
  const config = await readProjectConfig(before.root);
  if (!config.starter?.templates?.length)
    throw new Error(
      "No starter is tracked. Adopt the project's starter before syncing."
    );
  if (config.starter.sync?.strategy === "direct-when-clean") {
    return await landDirect(before, options, deps);
  }
  const committed = validateProjectConfig(
    JSON.parse(
      await deps.capture("git", ["show", `${before.head}:${CONFIG}`], {
        cwd: before.root,
      })
    ),
    CONFIG
  );
  if (!isDeepStrictEqual(config.starter, committed.starter))
    throw new Error(
      "Commit the starter configuration before opening a sync PR; the isolated worktree uses committed settings."
    );
  const landing = await preparePullRequest(before, options.base, deps);
  if (!("worktree" in landing))
    return { state: PULL_REQUEST, url: landing.url, results: [] };
  try {
    return await landStarterPullRequest(landing, options, deps);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nStarter changes retained at ${landing.worktree}.`,
      { cause: error }
    );
  }
}

/**
 * Refuse publication on partial failure; retain the engine's retryable files.
 * @param projectRoot - Destination worktree.
 * @param deps - Sync engine dependency.
 * @returns Successful per-template results.
 */
async function applyStarter(
  projectRoot: string,
  deps: StarterLandingDependencies
): Promise<readonly StarterSyncResult[]> {
  const lisaRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
  );
  const results = await deps.sync({ projectRoot, lisaRoot });
  const failures = results.filter(result => result.state === "failed");
  if (failures.length)
    throw new Error(
      failures
        .map(result => `${result.repo}: ${result.error ?? "sync failed"}`)
        .join("\n")
    );
  return results;
}

/**
 * The engine reports its owned file changes; provenance is the only extra file.
 * @param results - Successful engine results.
 * @returns Exact paths eligible for staging.
 */
function changedPaths(results: readonly StarterSyncResult[]): string[] {
  return [...new Set([CONFIG, ...results.flatMap(result => result.changed)])];
}

/**
 * Hand the engine's changes to the same landing functions used by the PR driver.
 * @param landing - Isolated destination worktree.
 * @param options - Caller attribution.
 * @param deps - Shared operations.
 * @returns Published PR or current outcome.
 */
async function landStarterPullRequest(
  landing: PullRequestLanding,
  options: StarterSyncCommandOptions,
  deps: StarterLandingDependencies
): Promise<StarterLandingResult> {
  const before = await inspectLanding(landing.worktree, deps);
  if (before.status)
    throw new Error(
      "The new worktree contains changes from its checkout hook; inspect them before syncing."
    );
  const results = await applyStarter(landing.worktree, deps);
  const commit = await commitLanding(
    before,
    changedPaths(results),
    TITLE,
    options,
    deps
  );
  if (!commit) {
    await releasePullRequestWorktree(landing, deps);
    return { state: "current", results };
  }
  const body = [
    "Starter changes applied using Lisa's existing ownership rules. Review this pull request before merging.",
    options.workItem
      ? `Refs ${options.workItem}\nWork-Item: ${options.workItem}`
      : "",
    ...results.map(
      result =>
        `- ${result.repo}: ${result.state}; ${result.changed.length} file(s) changed.`
    ),
    "Next: run the existing lisa-drive-pr-to-merge workflow with auto_merge=false to handle review and checks. This command does not enable auto-merge.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const url = await publishPullRequest(landing, TITLE, body, deps);
  try {
    await unlink(path.join(landing.directory, "pull-request.md"));
    await releasePullRequestWorktree(landing, deps);
  } catch {
    return {
      state: PULL_REQUEST,
      results,
      commit,
      url,
      worktree: landing.worktree,
    };
  }
  return { state: PULL_REQUEST, results, commit, url };
}

/**
 * Apply and commit only after the current checkout passes the clean-tree check.
 * @param before - Original checkout snapshot.
 * @param options - Commit attribution.
 * @param deps - Shared operations.
 * @returns Direct commit or current outcome.
 */
async function landDirect(
  before: LandingSnapshot,
  options: StarterSyncCommandOptions,
  deps: StarterLandingDependencies
): Promise<StarterLandingResult> {
  if (before.status)
    throw new Error(
      "Starter sync refused: this working tree has uncommitted changes."
    );
  const results = await applyStarter(before.root, deps);
  const commit = await commitLanding(
    before,
    changedPaths(results),
    TITLE,
    options,
    deps
  );
  return {
    state: commit ? "committed" : "current",
    results,
    ...(commit ? { commit } : {}),
  };
}
