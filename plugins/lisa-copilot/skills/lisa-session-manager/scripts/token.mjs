/**
 * The Telegram bot token the manager needs: validated, stored in
 * `<stateDir>/.env` (dir 0700, file 0600), read from the operator's terminal
 * with echo off or from the clipboard (`--from-clipboard`, for when no TTY is
 * reachable), and never put in argv, a return value, an error message or a
 * log line. An existing token is replaced only on request. Split out of
 * launch.mjs, which re-exports everything here.
 *
 * The `.env` file is the storage only when the project has no secrets
 * provider; with one, token-store.mjs stores the token there instead and
 * reuses the prompt and clipboard readers (#4555).
 *
 * Validation, the prompt and clipboard readers and the printed `store-token`
 * command live in token-read.mjs, re-exported here, to keep this module under
 * the line budget.
 * @module token
 */
import { randomUUID } from "node:crypto";
import * as nodeFs from "node:fs";
import path from "node:path";

import { LaunchError, resolveStateDir } from "./state-dir.mjs";
import {
  readTokenFromClipboard,
  readTokenFromPrompt,
  shellQuote,
  validateBotToken,
} from "./token-read.mjs";

export {
  buildStoreTokenCommand,
  loadPromptSecret,
  readTokenFromClipboard,
  readTokenFromPrompt,
  shellQuote,
  validateBotToken,
} from "./token-read.mjs";

/** The plugin reads its token from this file in the state dir. */
const TOKEN_FILE_NAME = ".env";

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
 * Refuse to overwrite an existing token unless `replace` was asked for: a
 * second project that shares this state dir by mistake would otherwise
 * silently take over the first project's bot.
 * @param {string} stateDir - Resolved state dir
 * @param {boolean} replace - `--replace`
 * @param {{ fs?: { existsSync?: (p: string) => boolean } }} io - Seams
 */
function assertReplaceable(stateDir, replace, io) {
  const existing = path.join(stateDir, TOKEN_FILE_NAME);
  const exists = io.fs?.existsSync ?? nodeFs.existsSync;
  if (!replace && exists(existing)) {
    throw new LaunchError(
      `A bot token already exists at ${existing}. Nothing was changed. ` +
        `Re-run store-token with --replace to overwrite it.`
    );
  }
}

/**
 * Store the bot token from the system clipboard, with no TTY needed.
 *
 * Same validation and the same existing-token rule as the prompt. The
 * clipboard is cleared only after a successful store, so a failed attempt
 * leaves the operator's copy in place to retry with. The token is never
 * returned, and an invalid value is reported by shape, never echoed.
 * @param {{ stateDir: string, replace?: boolean,
 *   env?: Record<string, string | undefined>, homedir?: string,
 *   io?: { readClipboard?: typeof readClipboard, fs?: object } }} input -
 *   Configured state dir, the `--replace` flag and seams
 * @returns {{ stored: true, path: string, clipboardCleared: boolean } |
 *   { stored: false, reason: "empty" | "invalid" | "unsupported" |
 *     "unavailable" | "failed", message: string }} Outcome
 */
export function storeTokenFromClipboard(input) {
  const { replace = false, io = {} } = input;
  const stateDir = resolveStateDir(input.stateDir, input);
  assertReplaceable(stateDir, replace, io);
  const read = readTokenFromClipboard(io);
  if (read.token === undefined) return read;
  const written = writeTokenFile(stateDir, read.token, io);
  return { stored: true, ...written, clipboardCleared: read.clear() };
}

/**
 * Prompt for the bot token on the operator's terminal and store it in
 * `<stateDir>/.env`. An existing token is never overwritten without
 * `replace`; with no TTY it returns the commands that work instead (see
 * {@link readTokenFromPrompt}).
 * @param {{ stateDir: string, scriptsDir: string, projectRoot: string,
 *   replace?: boolean, env?: Record<string, string | undefined>,
 *   homedir?: string, io?: { canPrompt?: () => boolean,
 *   promptSecret?: (message: string) => string, fs?: object } }} input -
 *   Configured state dir, locations, the `--replace` flag and seams
 * @returns {Promise<{ stored: true, path: string } |
 *   { stored: false, reason: "no-tty", message: string, command: string,
 *     clipboardCommand: string } |
 *   { stored: false, reason: "empty" | "invalid", message: string }>} Outcome
 */
export async function storeToken(input) {
  const { scriptsDir, projectRoot, replace = false, io = {} } = input;
  const stateDir = resolveStateDir(input.stateDir, input);
  assertReplaceable(stateDir, replace, io);
  const read = await readTokenFromPrompt({
    label: stateDir,
    scriptsDir,
    projectRoot,
    replace,
    io,
  });
  if (read.token === undefined) return read;
  return { stored: true, ...writeTokenFile(stateDir, read.token, io) };
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
