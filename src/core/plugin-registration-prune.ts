/**
 * Prune Claude Code project-scope registrations Lisa made for checkouts that
 * no longer exist.
 *
 * Lisa registers its plugins with `claude plugin install <id> --scope
 * project`, which records the checkout's path in Claude Code's plugin
 * registry — once per checkout, so once per worktree. Nothing removed those
 * records when a worktree was deleted, and they accumulated without bound
 * (CodySwannGT/lisa#4645).
 *
 * The CLI's `uninstall` acts only on its working directory and has no path
 * flag, so each dead path is recreated just long enough to run the uninstall
 * from it, then only the directories this call created are removed again —
 * and only while empty, so nothing the CLI might have written is deleted.
 * `--keep-data` keeps the plugin's shared data directory, which live
 * installations of the same plugin still use.
 *
 * Scope is deliberately narrow: `scope === "project"` entries whose id ends in
 * `@lisa` and whose absolute `projectPath` is missing on disk. Other vendors'
 * plugins, user/local scopes, and paths that exist are never touched. Any
 * failure is reported with the command to run by hand; it never fails the
 * apply.
 *
 * Agent parity: only Claude Code keeps per-path plugin registrations. The
 * Codex, Cursor, OpenCode, Antigravity, Copilot and Devin installers write
 * project-local files and record no registry entry per checkout, so there is
 * nothing equivalent to prune on those agents.
 * @module core/plugin-registration-prune
 */
import { existsSync, mkdirSync, readdirSync, rmdirSync } from "node:fs";
import * as path from "node:path";

const LISA_SUFFIX = "@lisa";
const MAX_REPORTED_COMMANDS = 3;

/** Runs `claude <args>` in `cwd`; rejects when the command fails. */
export type ClaudeRunner = (
  args: readonly string[],
  cwd: string
) => Promise<{ readonly stdout?: unknown }>;

/** Collaborators for {@link pruneDeadPluginRegistrations}. */
export interface PluginRegistrationPruneDeps {
  readonly runClaude: ClaudeRunner;
  readonly logger: {
    readonly info: (message: string) => void;
    readonly warn: (message: string) => void;
  };
}

/** How many dead registrations were removed, and how many could not be. */
export interface PluginRegistrationPruneOutcome {
  readonly pruned: number;
  readonly failed: number;
}

/** One dead path and the Lisa plugin ids registered for it. */
interface DeadPath {
  readonly projectPath: string;
  readonly ids: readonly string[];
}

/** Result of pruning one dead path. */
interface PathOutcome {
  readonly pruned: number;
  readonly failedCommands: readonly string[];
}

/**
 * Whether a registry entry is a Lisa project-scope registration for a path
 * that no longer exists.
 * @param entry - Raw `claude plugin list --json` entry
 * @returns The entry's id and path when dead, else null
 */
function asDeadLisaRegistration(
  entry: unknown
): { readonly id: string; readonly projectPath: string } | null {
  if (typeof entry !== "object" || entry === null) return null;
  const id: unknown = Reflect.get(entry, "id");
  const scope: unknown = Reflect.get(entry, "scope");
  const projectPath: unknown = Reflect.get(entry, "projectPath");
  const isDead =
    scope === "project" &&
    typeof id === "string" &&
    id.endsWith(LISA_SUFFIX) &&
    typeof projectPath === "string" &&
    path.isAbsolute(projectPath) &&
    !existsSync(projectPath);
  return isDead ? { id, projectPath } : null;
}

/**
 * Group dead Lisa registrations by path, de-duplicating ids.
 * @param stdout - `claude plugin list --json` output
 * @returns Dead paths with their ids, or an empty list when unparseable
 */
function findDeadPaths(stdout: unknown): readonly DeadPath[] {
  try {
    const parsed: unknown = JSON.parse(String(stdout ?? ""));
    if (!Array.isArray(parsed)) return [];
    const dead = parsed
      .map(asDeadLisaRegistration)
      .filter(registration => registration !== null);
    const paths = [...new Set(dead.map(entry => entry.projectPath))];
    return paths.map(projectPath => ({
      projectPath,
      ids: [
        ...new Set(
          dead
            .filter(entry => entry.projectPath === projectPath)
            .map(entry => entry.id)
        ),
      ],
    }));
  } catch {
    return [];
  }
}

/**
 * The command an operator runs by hand to remove one registration.
 * @param projectPath - Dead checkout path
 * @param id - Plugin id
 * @returns Shell command line
 */
function manualCommand(projectPath: string, id: string): string {
  return `mkdir -p '${projectPath}' && cd '${projectPath}' && claude plugin uninstall ${id} --scope project --keep-data`;
}

/**
 * The directories from `dir` up to and including `top`, deepest first.
 * @param dir - Starting directory (inside `top`)
 * @param top - Topmost directory to include
 * @returns The chain, or an empty list when `dir` is not inside `top`
 */
function directoriesUpTo(dir: string, top: string): readonly string[] {
  if (dir === top) return [dir];
  if (!dir.startsWith(top + path.sep)) return [];
  return [dir, ...directoriesUpTo(path.dirname(dir), top)];
}

/**
 * Remove the directories this prune created, deepest first, stopping at the
 * first one that is not empty.
 * @param projectPath - The recreated dead path
 * @param firstCreated - Topmost directory `mkdirSync` created
 * @returns True when every created directory was removed
 */
function removeCreatedDirectories(
  projectPath: string,
  firstCreated: string
): boolean {
  for (const dir of directoriesUpTo(projectPath, firstCreated)) {
    if (readdirSync(dir).length > 0) return false;
    rmdirSync(dir);
  }
  return true;
}

/**
 * Recreate a dead path, returning the topmost directory created.
 * @param projectPath - Dead checkout path
 * @returns The first directory created, or null when nothing could be created
 */
function recreate(projectPath: string): string | null {
  try {
    return mkdirSync(projectPath, { recursive: true }) ?? null;
  } catch {
    return null;
  }
}

/**
 * Uninstall every Lisa id registered for one dead path, from that path.
 * @param dead - Dead path and its ids
 * @param deps - Collaborators
 * @returns Pruned count and the manual commands for anything left behind
 */
async function pruneDeadPath(
  dead: DeadPath,
  deps: PluginRegistrationPruneDeps
): Promise<PathOutcome> {
  const firstCreated = recreate(dead.projectPath);
  if (firstCreated === null) {
    return {
      pruned: 0,
      failedCommands: dead.ids.map(id => manualCommand(dead.projectPath, id)),
    };
  }
  const failedCommands = await dead.ids.reduce<Promise<readonly string[]>>(
    async (previous, id) => {
      const failed = await previous;
      const removed = await deps
        .runClaude(
          ["plugin", "uninstall", id, "--scope", "project", "--keep-data"],
          dead.projectPath
        )
        .then(
          () => true,
          () => false
        );
      return removed
        ? failed
        : [...failed, manualCommand(dead.projectPath, id)];
    },
    Promise.resolve([])
  );
  if (!removeCreatedDirectories(dead.projectPath, firstCreated)) {
    deps.logger.warn(
      `Left ${firstCreated} in place: the Claude CLI wrote into it while pruning`
    );
  }
  return { pruned: dead.ids.length - failedCommands.length, failedCommands };
}

/**
 * Report what the prune did.
 * @param pruned - Registrations removed
 * @param failedCommands - Manual commands for those left behind
 * @param deps - Collaborators
 */
function report(
  pruned: number,
  failedCommands: readonly string[],
  deps: PluginRegistrationPruneDeps
): void {
  const noun = (count: number): string =>
    count === 1 ? "registration" : "registrations";
  if (pruned > 0) {
    deps.logger.info(
      `Pruned ${pruned} Lisa plugin ${noun(pruned)} for deleted checkouts`
    );
  }
  if (failedCommands.length > 0) {
    const examples = failedCommands
      .slice(0, MAX_REPORTED_COMMANDS)
      .join("\n  ");
    deps.logger.warn(
      `Could not prune ${failedCommands.length} Lisa plugin ${noun(failedCommands.length)} for deleted checkouts; remove them by hand, e.g.:\n  ${examples}`
    );
  }
}

/**
 * Uninstall Lisa's project-scope registrations whose checkout no longer
 * exists. Everything runs sequentially: a dead path's directory exists only
 * while its own uninstalls run.
 * @param cwd - Directory to run `claude plugin list --json` from
 * @param deps - CLI runner and logger
 * @returns Counts of pruned and unprunable registrations
 */
export async function pruneDeadPluginRegistrations(
  cwd: string,
  deps: PluginRegistrationPruneDeps
): Promise<PluginRegistrationPruneOutcome> {
  const listed = await deps
    .runClaude(["plugin", "list", "--json"], cwd)
    .catch(() => ({ stdout: "" }));
  const outcomes = await findDeadPaths(listed.stdout).reduce<
    Promise<readonly PathOutcome[]>
  >(
    async (previous, dead) => [
      ...(await previous),
      await pruneDeadPath(dead, deps),
    ],
    Promise.resolve([])
  );
  const pruned = outcomes.reduce((sum, outcome) => sum + outcome.pruned, 0);
  const failedCommands = outcomes.flatMap(outcome => outcome.failedCommands);
  report(pruned, failedCommands, deps);
  return { pruned, failed: failedCommands.length };
}
