/**
 * Starting and stopping the session manager, and the Telegram bot token it
 * needs.
 *
 * The official Telegram plugin keeps its token, pairing list, inbox and
 * `bot.pid` in one state dir (`TELEGRAM_STATE_DIR`, else
 * `<CLAUDE_CONFIG_DIR>/channels/telegram`). It long-polls from EVERY session
 * where it is enabled, and on start it SIGTERMs whichever poller holds the
 * `bot.pid` in the same dir. So isolation is the whole design here:
 * - the manager gets its own per-project state dir, set only in its own tmux
 *   env, and the shared default dir is refused outright;
 * - the plugin is enabled only through the manager's own `--settings`, never
 *   at user scope, so worker sessions never start a poller;
 * - the token lives in `<stateDir>/.env` (dir 0700, file 0600), is read from
 *   the operator's terminal with echo off, and never appears in argv, a
 *   return value, an error message or a log line.
 *
 * The tmux argv is returned as an array and handed straight to `spawnSync`.
 * With more than one command argument tmux runs the command directly rather
 * than through `sh -c`, so the settings JSON and the loop prompt are never
 * re-parsed by a shell.
 *
 * The state dir lives in state-dir.mjs and the token in token.mjs; both are
 * re-exported here so callers keep one import.
 *
 * Everything here is pure or takes injected seams. This module never reads
 * the environment and never runs tmux or claude itself: `session-manager.mjs`
 * passes the real env in and executes the argv.
 * @module launch
 */
import path from "node:path";

import { parseLoopInterval } from "./config.mjs";
import { LaunchError } from "./state-dir.mjs";

export {
  LaunchError,
  realpathExisting,
  resolveStateDir,
} from "./state-dir.mjs";
export {
  assertTokenPresent,
  buildStoreTokenCommand,
  loadPromptSecret,
  storeToken,
  validateBotToken,
  writeTokenFile,
} from "./token.mjs";

/** The plugin the manager, and only the manager, enables. */
export const TELEGRAM_PLUGIN_ID = "telegram@claude-plugins-official";

/** Same slug rule the config validator applies to `sessionManager.name`. */
const SESSION_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** A `'` inside a single-quoted shell word: close, escaped quote, reopen. */
const ESCAPED_QUOTE = "'\\''";

/** An argument a POSIX shell reads back unchanged without quotes. */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** The skill command each manager loop iteration runs. */
const CYCLE_COMMAND = "/lisa:session-manager cycle";

/**
 * Settings blob for the manager session only: the Telegram plugin on, and
 * workers' messages accepted.
 * @returns {{ crossSessionInbound: "accept",
 *   enabledPlugins: Record<string, boolean> }} Fresh settings object
 */
export function buildManagerSettings() {
  return {
    crossSessionInbound: "accept",
    enabledPlugins: { [TELEGRAM_PLUGIN_ID]: true },
  };
}

/**
 * Refuse a tmux session name that is not a plain slug; `:` and `.` would be
 * read by tmux as a window or pane target.
 * @param {unknown} name - Session name
 * @returns {string} The name
 */
function assertSessionName(name) {
  if (typeof name !== "string" || !SESSION_NAME_PATTERN.test(name)) {
    throw new LaunchError(
      `Manager name "${String(name)}" must be a slug: lowercase letters, ` +
        `digits, "-" or "_", at most 64 characters.`
    );
  }
  return name;
}

/**
 * Refuse a path that is not absolute.
 * @param {string} label - Field name for the message
 * @param {unknown} value - Path to check
 * @returns {string} The path
 */
function assertAbsolute(label, value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new LaunchError(`${label} must be an absolute path.`);
  }
  return value;
}

/**
 * tmux argv (without `tmux`) that starts the manager detached.
 *
 * `TELEGRAM_STATE_DIR` goes only into this session's env so no other session
 * ever sees it. `SM_SCRIPTS_DIR` lets every cycle's Bash find these scripts
 * without re-resolving the plugin root.
 * @param {{ name: string, root: string, stateDir: string, scriptsDir: string,
 *   interval: string }} input - Session name, project root, resolved state
 *   dir, this scripts dir, and the loop interval (e.g. "5m")
 * @returns {string[]} argv for `spawnSync("tmux", argv)`
 */
export function buildManagerLaunch({
  name,
  root,
  stateDir,
  scriptsDir,
  interval,
}) {
  assertSessionName(name);
  assertAbsolute("root", root);
  assertAbsolute("stateDir", stateDir);
  assertAbsolute("scriptsDir", scriptsDir);
  if (parseLoopInterval(interval) === null) {
    throw new LaunchError(
      `interval "${String(interval)}" must be a positive duration like 5m.`
    );
  }
  return [
    "new-session",
    "-d",
    "-s",
    name,
    "-c",
    root,
    "-e",
    `TELEGRAM_STATE_DIR=${stateDir}`,
    "-e",
    `SM_SCRIPTS_DIR=${scriptsDir}`,
    "claude",
    "-n",
    name,
    "--dangerously-skip-permissions",
    "--settings",
    JSON.stringify(buildManagerSettings()),
    "--channels",
    `plugin:${TELEGRAM_PLUGIN_ID}`,
    // `--channels` is variadic (claude 2.1.296): without `--` it takes the
    // prompt as a second channel entry and claude exits 1 ("--channels
    // entries must be tagged") before the session starts.
    "--",
    `/loop ${interval} ${CYCLE_COMMAND}`,
  ];
}

/**
 * Quote one argument for a POSIX shell, for display only.
 * @param {string} value - Argument
 * @returns {string} Single-quoted argument
 */
function shellQuote(value) {
  return `'${value.replaceAll("'", ESCAPED_QUOTE)}'`;
}

/**
 * The shell line an operator runs to start the manager in the foreground,
 * from the tmux argv {@link buildManagerLaunch} returned: same cwd, the same
 * two session variables, the same claude argv. `start` prints it when the
 * tmux session dies at once, because tmux closes the window and claude's own
 * error goes with it. It is display text only and is never executed here.
 * The token is not in the argv, so it is not in this line either.
 * @param {readonly string[]} argv - Result of {@link buildManagerLaunch}
 * @returns {string} One shell line
 */
export function buildForegroundCommand(argv) {
  const claudeAt = argv.indexOf("claude");
  const head = argv.slice(0, claudeAt);
  const cwd = head[head.indexOf("-c") + 1];
  const vars = head
    .filter((_, index) => head[index - 1] === "-e")
    .map(entry => {
      const at = entry.indexOf("=");
      return `${entry.slice(0, at)}=${shellQuote(entry.slice(at + 1))}`;
    });
  const command = argv
    .slice(claudeAt)
    .map(arg => (SHELL_SAFE.test(arg) ? arg : shellQuote(arg)));
  return `cd ${shellQuote(cwd)} && ${[...vars, ...command].join(" ")}`;
}

/**
 * tmux argv that reports (by exit status) whether the manager is running.
 * `=` asks for an exact name: tmux otherwise falls back to a prefix match, so
 * `demo` would find a running `demo-manager` that belongs to someone else.
 * @param {string} name - Manager session name
 * @returns {string[]} argv for `spawnSync("tmux", argv)`
 */
export function buildHasSession(name) {
  return ["has-session", "-t", `=${assertSessionName(name)}`];
}

/**
 * tmux argv that prints the directory the manager session was started in.
 * This is a target-pane command, where `=name` alone does not resolve to a
 * session; `=name:` does. tmux 3.6 prints an empty line and exits 0 for a
 * session that does not exist, so callers treat empty output as unknown.
 * @param {string} name - Manager session name
 * @returns {string[]} argv for `spawnSync("tmux", argv)`
 */
export function buildSessionPath(name) {
  return [
    "display-message",
    "-p",
    "-t",
    `=${assertSessionName(name)}:`,
    "#{session_path}",
  ];
}

/**
 * tmux argv that stops the manager session and nothing else (exact name, see
 * {@link buildHasSession}). Workers are separate background sessions and keep
 * running.
 * @param {string} name - Manager session name
 * @returns {string[]} argv for `spawnSync("tmux", argv)`
 */
export function buildStopManager(name) {
  return ["kill-session", "-t", `=${assertSessionName(name)}`];
}
