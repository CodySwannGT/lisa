/**
 * The manager's per-project Telegram state dir, and the refusal error every
 * launch-time check throws.
 *
 * The official Telegram plugin keeps its token, pairing list, inbox and
 * `bot.pid` in one state dir (`TELEGRAM_STATE_DIR`, else
 * `<CLAUDE_CONFIG_DIR>/channels/telegram`), and on start it SIGTERMs whichever
 * poller holds the `bot.pid` in the same dir. So the shared default dir is
 * refused outright, including through a symlink. Split out of launch.mjs,
 * which re-exports everything here.
 * @module state-dir
 */
import * as nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Exit code for every refusal here: a setup problem the operator must fix. */
const EXIT_SETUP = 2;

/**
 * A refusal that the CLI maps to a process exit code (always 2 here: the
 * operator must fix setup before the manager can start).
 */
export class LaunchError extends Error {
  /**
   * @param {string} message - Operator-readable reason; never contains a token
   * @param {number} [exitCode] - Process exit code the CLI should use
   */
  constructor(message, exitCode = EXIT_SETUP) {
    super(message);
    this.name = "LaunchError";
    this.exitCode = exitCode;
  }
}

/**
 * Paths the plugin falls back to when `TELEGRAM_STATE_DIR` is unset. Both the
 * `CLAUDE_CONFIG_DIR` one and the `~/.claude` one are refused, because the
 * operator's own sessions may run with either.
 * @param {{ env?: Record<string, string | undefined>, homedir?: string }} seams
 *   - Injected env and home dir
 * @returns {string[]} Absolute shared-default dirs
 */
function sharedDefaultDirs({ env = {}, homedir = os.homedir() }) {
  const roots = [path.join(homedir, ".claude")];
  if (env.CLAUDE_CONFIG_DIR) roots.push(path.resolve(env.CLAUDE_CONFIG_DIR));
  return roots.map(root => path.join(root, "channels", "telegram"));
}

/**
 * Resolve symlinks in the longest existing prefix of `target`, keeping the
 * not-yet-created remainder as written. A state dir usually does not exist
 * before `store-token` creates it, but its parent (or `~/.claude`) may be a
 * symlink, and a plain string comparison would miss the shared dir behind it.
 * @param {string} target - Absolute path
 * @param {Pick<typeof nodeFs, "realpathSync">} fs - Injected fs
 * @returns {string} Path with every existing component's symlinks resolved
 */
export function realpathExisting(target, fs = nodeFs) {
  const rest = [];
  let current = target;
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolve the configured state dir to an absolute path, refusing the shared
 * default. Both sides are compared after resolving symlinks where the path
 * exists, so an alias of the shared dir is refused too. The comparison ignores
 * case because macOS volumes usually do.
 * @param {string} stateDir - `sessionManager.notify.stateDir`, `~` allowed
 * @param {{ env?: Record<string, string | undefined>, homedir?: string }} [seams]
 *   - Injected env (for CLAUDE_CONFIG_DIR) and home dir
 * @returns {string} Absolute, normalized dir
 */
export function resolveStateDir(stateDir, seams = {}) {
  const homedir = seams.homedir ?? os.homedir();
  if (typeof stateDir !== "string" || stateDir.trim() === "") {
    throw new LaunchError("notify.stateDir is empty; set a per-project dir.");
  }
  const expanded =
    stateDir === "~" || stateDir.startsWith("~/")
      ? path.join(homedir, stateDir.slice(1))
      : stateDir;
  if (!path.isAbsolute(expanded)) {
    throw new LaunchError(
      `notify.stateDir "${stateDir}" must be absolute or start with ~/.`
    );
  }
  const resolved = path.resolve(expanded);
  const real = realpathExisting(resolved).toLowerCase();
  const shared = sharedDefaultDirs({ ...seams, homedir }).flatMap(dir => [
    dir.toLowerCase(),
    realpathExisting(dir).toLowerCase(),
  ]);
  if (shared.includes(resolved.toLowerCase()) || shared.includes(real)) {
    throw new LaunchError(
      `notify.stateDir ${resolved} is the shared Telegram default. Pick a ` +
        `per-project dir (e.g. ~/.claude/channels/telegram-<project>), or the ` +
        `manager and your own Telegram session will kill each other's poller.`
    );
  }
  return resolved;
}
