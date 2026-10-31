/**
 * Starting and stopping the session manager, and the Telegram bot token it
 * needs when Telegram is its notification channel. Telegram is optional
 * (#4555): with `notify.provider` `"none"` the manager launches with no
 * channel, no state dir and no plugin, and none of the isolation below applies.
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
 * - the token lives in the project's secrets provider when one is configured
 *   (token-store.mjs, #4555), reaching the manager's tmux session through
 *   `source-file -` on stdin ({@link buildSourcedLaunch}); with no provider it
 *   lives in `<stateDir>/.env` (dir 0700, file 0600). Either way it is read
 *   from the operator's terminal with echo off (or the clipboard), and never
 *   appears in argv, a return value, an error message or a log line.
 *
 * The tmux argv is returned as an array and handed straight to `spawnSync`.
 * With more than one command argument tmux runs the command directly rather
 * than through `sh -c`, so the settings JSON and the loop prompt are never
 * re-parsed by a shell.
 *
 * The state dir lives in state-dir.mjs, the token in token.mjs, and the
 * foreground and stdin renderings of the launch in launch-shell.mjs; all are
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
  buildForegroundCommand,
  buildSourcedLaunch,
  tmuxQuote,
} from "./launch-shell.mjs";
export {
  LaunchError,
  realpathExisting,
  resolveStateDir,
} from "./state-dir.mjs";
export {
  assertTokenPresent,
  buildStoreTokenCommand,
  loadPromptSecret,
  readTokenFromClipboard,
  readTokenFromPrompt,
  storeToken,
  storeTokenFromClipboard,
  validateBotToken,
  writeTokenFile,
} from "./token.mjs";

/** The plugin the manager, and only the manager, enables. */
export const TELEGRAM_PLUGIN_ID = "telegram@claude-plugins-official";

/** Same slug rule the config validator applies to `sessionManager.name`. */
const SESSION_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The skill command each manager loop iteration runs. */
const CYCLE_COMMAND = "/lisa:session-manager cycle";

/** The notification providers a launch can be built for. */
const LAUNCH_NOTIFY = new Set(["none", "telegram"]);

/**
 * Settings blob for the manager session only: workers' messages accepted,
 * and the Telegram plugin on when Telegram is the notification channel. With
 * no channel (`"none"`) the plugin is left out entirely, so the manager never
 * starts a poller (#4555).
 * @param {string} [notify] - Notification provider: "telegram" (default) or "none"
 * @returns {{ crossSessionInbound: "accept",
 *   enabledPlugins?: Record<string, boolean> }} Fresh settings object
 */
export function buildManagerSettings(notify = "telegram") {
  return notify === "telegram"
    ? {
        crossSessionInbound: "accept",
        enabledPlugins: { [TELEGRAM_PLUGIN_ID]: true },
      }
    : { crossSessionInbound: "accept" };
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
 *
 * With `notify: "none"` there is no channel: no `TELEGRAM_STATE_DIR`, no
 * `--channels` and no plugin in the settings, and a `stateDir` is refused
 * because only the telegram provider uses one (#4555).
 * @param {{ name: string, root: string, stateDir?: string,
 *   scriptsDir: string, interval: string,
 *   notify?: string }} input - Session name, project root,
 *   resolved state dir (telegram only), this scripts dir, the loop interval
 *   (e.g. "5m") and the notification provider (default telegram)
 * @returns {string[]} argv for `spawnSync("tmux", argv)`
 */
export function buildManagerLaunch({
  name,
  root,
  stateDir,
  scriptsDir,
  interval,
  notify = "telegram",
}) {
  assertSessionName(name);
  assertAbsolute("root", root);
  const telegram = assertNotify(notify, stateDir) === "telegram";
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
    ...(telegram ? ["-e", `TELEGRAM_STATE_DIR=${stateDir}`] : []),
    "-e",
    `SM_SCRIPTS_DIR=${scriptsDir}`,
    "claude",
    "-n",
    name,
    "--dangerously-skip-permissions",
    "--settings",
    JSON.stringify(buildManagerSettings(notify)),
    ...(telegram ? ["--channels", `plugin:${TELEGRAM_PLUGIN_ID}`] : []),
    // `--channels` is variadic (claude 2.1.296): without `--` it takes the
    // prompt as a second channel entry and claude exits 1 ("--channels
    // entries must be tagged") before the session starts. Kept with no
    // channel too, so the prompt is never read as an option.
    "--",
    `/loop ${interval} ${CYCLE_COMMAND}`,
  ];
}

/**
 * Refuse an unsupported provider, a telegram launch without an absolute state
 * dir, and a state dir on a launch with no channel.
 * @param {unknown} notify - Notification provider
 * @param {unknown} stateDir - Resolved state dir, if any
 * @returns {"telegram" | "none"} The provider
 */
function assertNotify(notify, stateDir) {
  if (!LAUNCH_NOTIFY.has(notify)) {
    throw new LaunchError(
      `notify "${String(notify)}" is not supported; use "none" or "telegram".`
    );
  }
  if (notify === "telegram") {
    assertAbsolute("stateDir", stateDir);
  } else if (stateDir !== undefined) {
    throw new LaunchError(
      `stateDir is only used with the telegram provider; notify is "none".`
    );
  }
  return notify;
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
