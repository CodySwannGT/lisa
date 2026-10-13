/**
 * The Telegram bot token the manager needs: validated, stored in
 * `<stateDir>/.env` (dir 0700, file 0600), read from the operator's terminal
 * with echo off, and never put in argv, a return value, an error message or a
 * log line. An existing token is replaced only on request. Split out of
 * launch.mjs, which re-exports everything here.
 * @module token
 */
import { randomUUID } from "node:crypto";
import * as nodeFs from "node:fs";
import path from "node:path";

import { LaunchError, resolveStateDir } from "./state-dir.mjs";

/** The shape of a BotFather token: `<bot id>:<secret>`. */
const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{30,}$/;

/** The plugin reads its token from this file in the state dir. */
const TOKEN_FILE_NAME = ".env";

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
 * @param {{ scriptsDir: string, projectRoot: string, replace?: boolean }}
 *   input - Script and project locations, and whether to carry `--replace`
 * @returns {string} One shell line
 */
export function buildStoreTokenCommand({ scriptsDir, projectRoot, replace }) {
  const script = shellQuote(path.join(scriptsDir, "session-manager.mjs"));
  const flag = replace ? " --replace" : "";
  return `node ${script} store-token${flag} --project-root ${shellQuote(projectRoot)}`;
}

/**
 * Prompt for the bot token on the operator's terminal and store it.
 *
 * An existing token is never overwritten without `replace`: a second project
 * that shares this state dir by mistake would otherwise silently take over the
 * first project's bot. With no TTY this does not prompt and does not fail: it
 * returns the exact command for the operator to run themselves, because an
 * agent's Bash can never answer a prompt and a hung setup looks like a slow
 * one.
 * @param {{ stateDir: string, scriptsDir: string, projectRoot: string,
 *   replace?: boolean, env?: Record<string, string | undefined>,
 *   homedir?: string, io?: { canPrompt?: () => boolean,
 *   promptSecret?: (message: string) => string, fs?: object } }} input -
 *   Configured state dir, locations, the `--replace` flag and seams
 * @returns {Promise<{ stored: true, path: string } |
 *   { stored: false, reason: "no-tty", command: string } |
 *   { stored: false, reason: "empty" | "invalid", message: string }>} Outcome
 */
export async function storeToken(input) {
  const { scriptsDir, projectRoot, replace = false, io = {} } = input;
  const stateDir = resolveStateDir(input.stateDir, input);
  const existing = path.join(stateDir, TOKEN_FILE_NAME);
  const exists = io.fs?.existsSync ?? nodeFs.existsSync;
  if (!replace && exists(existing)) {
    throw new LaunchError(
      `A bot token already exists at ${existing}. Nothing was changed. ` +
        `Re-run store-token with --replace to overwrite it.`
    );
  }
  const loaded =
    io.canPrompt && io.promptSecret ? null : await loadPromptSecret();
  const canPrompt = io.canPrompt ?? (() => loaded.canPrompt());
  const promptSecret = io.promptSecret ?? loaded.promptSecret;

  if (!canPrompt()) {
    return {
      stored: false,
      reason: "no-tty",
      command: buildStoreTokenCommand({ scriptsDir, projectRoot, replace }),
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
