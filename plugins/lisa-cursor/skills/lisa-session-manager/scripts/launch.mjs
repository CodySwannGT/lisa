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
 * Everything here is pure or takes injected seams. This module never reads
 * the environment and never runs tmux or claude itself: `session-manager.mjs`
 * passes the real env in and executes the argv.
 * @module launch
 */
import { randomUUID } from "node:crypto";
import * as nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseLoopInterval } from "./config.mjs";

/** The plugin the manager, and only the manager, enables. */
export const TELEGRAM_PLUGIN_ID = "telegram@claude-plugins-official";

/** The shape of a BotFather token: `<bot id>:<secret>`. */
const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{30,}$/;

/** The plugin reads its token from this file in the state dir. */
const TOKEN_FILE_NAME = ".env";

/** Same slug rule the config validator applies to `sessionManager.name`. */
const SESSION_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The skill command each manager loop iteration runs. */
const CYCLE_COMMAND = "/lisa:session-manager cycle";

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
 * Resolve the configured state dir to an absolute path, refusing the shared
 * default. The comparison ignores case because macOS volumes usually do.
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
  const shared = sharedDefaultDirs({ ...seams, homedir });
  if (shared.some(dir => dir.toLowerCase() === resolved.toLowerCase())) {
    throw new LaunchError(
      `notify.stateDir ${resolved} is the shared Telegram default. Pick a ` +
        `per-project dir (e.g. ~/.claude/channels/telegram-<project>), or the ` +
        `manager and your own Telegram session will kill each other's poller.`
    );
  }
  return resolved;
}

/**
 * Whether `token` looks like a BotFather bot token.
 * @param {unknown} token - Candidate
 * @returns {boolean} True for `<digits>:<30+ of [A-Za-z0-9_-]>`
 */
export function validateBotToken(token) {
  return typeof token === "string" && BOT_TOKEN_PATTERN.test(token);
}

/**
 * Write `<stateDir>/.env` as `TELEGRAM_BOT_TOKEN=<token>`.
 *
 * The dir is chmod-ed to 0700 even when it already existed, because `mkdir`'s
 * mode only applies to dirs it creates. The file is written to a temp name
 * created 0600 and renamed over the target, so there is never a moment when a
 * token sits in a file with looser permissions, and a replaced file's old
 * mode never carries over.
 * @param {string} stateDir - Absolute state dir (already resolved)
 * @param {string} token - Bot token; validated, never echoed
 * @param {{ fs?: Pick<typeof nodeFs, "mkdirSync" | "chmodSync" |
 *   "writeFileSync" | "renameSync"> }} [seams] - Injected fs
 * @returns {{ path: string }} Where the token file is
 */
export function writeTokenFile(stateDir, token, seams = {}) {
  const fs = seams.fs ?? nodeFs;
  if (!validateBotToken(token)) {
    throw new LaunchError(
      "That does not look like a Telegram bot token " +
        "(expected <digits>:<30 or more letters, digits, _ or ->). Nothing was stored."
    );
  }
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(stateDir, 0o700);
  const target = path.join(stateDir, TOKEN_FILE_NAME);
  const temp = path.join(stateDir, `${TOKEN_FILE_NAME}.${randomUUID()}.tmp`);
  fs.writeFileSync(temp, `TELEGRAM_BOT_TOKEN=${token}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, target);
  return { path: target };
}

/**
 * Load `promptSecret`/`canPrompt` from the secrets-access skill, by path
 * relative to this file, the same way other skills reach it. Lazy so the
 * argv builders never pay for it.
 * @returns {Promise<{ promptSecret: Function, canPrompt: Function }>} Module
 */
export function loadPromptSecret() {
  return import(
    new URL(
      "../../lisa-secrets-access/scripts/prompt-secret.mjs",
      import.meta.url
    ).href
  );
}

/**
 * Quote one word for a POSIX shell.
 * @param {string} word - Word to quote
 * @returns {string} Single-quoted word
 */
function shellQuote(word) {
  const escaped = String(word).replaceAll("'", String.raw`'\''`);
  return `'${escaped}'`;
}

/**
 * The command an operator pastes into their own terminal to store the token,
 * for when the caller (an agent's Bash) has no TTY to prompt on.
 * @param {{ scriptsDir: string, projectRoot: string }} input - Script and
 *   project locations
 * @returns {string} One shell line
 */
export function buildStoreTokenCommand({ scriptsDir, projectRoot }) {
  const script = shellQuote(path.join(scriptsDir, "session-manager.mjs"));
  return `node ${script} store-token --project-root ${shellQuote(projectRoot)}`;
}

/**
 * Prompt for the bot token on the operator's terminal and store it.
 *
 * With no TTY this does not prompt and does not fail: it returns the exact
 * command for the operator to run themselves, because an agent's Bash can
 * never answer a prompt and a hung setup looks like a slow one.
 * @param {{ stateDir: string, scriptsDir: string, projectRoot: string,
 *   env?: Record<string, string | undefined>, homedir?: string,
 *   io?: { canPrompt?: () => boolean, promptSecret?: (message: string) => string,
 *   fs?: object } }} input - Configured state dir, locations and seams
 * @returns {Promise<{ stored: true, path: string } |
 *   { stored: false, reason: "no-tty", command: string } |
 *   { stored: false, reason: "empty" | "invalid", message: string }>} Outcome
 */
export async function storeToken(input) {
  const { scriptsDir, projectRoot, io = {} } = input;
  const stateDir = resolveStateDir(input.stateDir, input);
  const loaded =
    io.canPrompt && io.promptSecret ? null : await loadPromptSecret();
  const canPrompt = io.canPrompt ?? (() => loaded.canPrompt());
  const promptSecret = io.promptSecret ?? loaded.promptSecret;

  if (!canPrompt()) {
    return {
      stored: false,
      reason: "no-tty",
      command: buildStoreTokenCommand({ scriptsDir, projectRoot }),
    };
  }
  const typed = promptSecret(
    `Paste the Telegram bot token for ${stateDir} (input is hidden): `
  );
  if (!typed) {
    return { stored: false, reason: "empty", message: "Nothing entered." };
  }
  if (!validateBotToken(typed)) {
    return {
      stored: false,
      reason: "invalid",
      message:
        "That does not look like a Telegram bot token " +
        "(expected <digits>:<30 or more letters, digits, _ or ->).",
    };
  }
  return { stored: true, ...writeTokenFile(stateDir, typed, io) };
}

/**
 * Refuse to start unless `<stateDir>/.env` exists and only its owner can read
 * it. Only the file's metadata is read, never its contents.
 * @param {string} stateDir - Absolute state dir (already resolved)
 * @param {{ fs?: Pick<typeof nodeFs, "statSync"> }} [seams] - Injected fs
 * @returns {{ path: string }} The token file
 */
export function assertTokenPresent(stateDir, seams = {}) {
  const fs = seams.fs ?? nodeFs;
  const file = path.join(stateDir, TOKEN_FILE_NAME);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new LaunchError(
      `No Telegram bot token at ${file}. Run store-token first.`
    );
  }
  if (!stat.isFile()) {
    throw new LaunchError(`${file} is not a regular file.`);
  }
  const bits = stat.mode & 0o777;
  if ((bits & 0o077) !== 0) {
    throw new LaunchError(
      `${file} is readable by other users (mode ${bits.toString(8)}). ` +
        `Run: chmod 600 ${shellQuote(file)}`
    );
  }
  return { path: file };
}

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
    `/loop ${interval} ${CYCLE_COMMAND}`,
  ];
}

/**
 * tmux argv that reports (by exit status) whether the manager is running.
 * @param {string} name - Manager session name
 * @returns {string[]} argv for `spawnSync("tmux", argv)`
 */
export function buildHasSession(name) {
  return ["has-session", "-t", assertSessionName(name)];
}

/**
 * tmux argv that stops the manager session and nothing else. Workers are
 * separate background sessions and keep running.
 * @param {string} name - Manager session name
 * @returns {string[]} argv for `spawnSync("tmux", argv)`
 */
export function buildStopManager(name) {
  return ["kill-session", "-t", assertSessionName(name)];
}
