/**
 * Reading the Telegram bot token from the operator, and the shell lines that
 * name the `store-token` command: token shape validation, the echo-off
 * prompt, the clipboard reader, and the command printed when there is no TTY.
 * Nothing here writes a file or prints the token. Split out of token.mjs to
 * keep it under the line budget (#4555); token.mjs re-exports every export,
 * and token-store.mjs reuses the readers for the secrets-provider path.
 * @module token-read
 */
import path from "node:path";

import { readClipboard } from "./clipboard.mjs";

/** The shape of a BotFather token: `<bot id>:<secret>`. */
const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{30,}$/;

/**
 * Whether `token` looks like a BotFather bot token.
 * @param {unknown} token - Candidate
 * @returns {boolean} True for `<digits>:<30+ of [A-Za-z0-9_-]>`
 */
export function validateBotToken(token) {
  return typeof token === "string" && BOT_TOKEN_PATTERN.test(token);
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
export function shellQuote(word) {
  const escaped = String(word).replaceAll("'", String.raw`'\''`);
  return `'${escaped}'`;
}

/**
 * The command an operator pastes into their own terminal to store the token,
 * for when the caller (an agent's Bash) has no TTY to prompt on. `start`
 * also names it when a plaintext token file is left over, since the same
 * command migrates that file into the secrets provider (#4555).
 * @param {{ scriptsDir: string, projectRoot: string, replace?: boolean,
 *   fromClipboard?: boolean, vaultProject?: string }} input - Script and
 *   project locations, and the flags to carry
 * @returns {string} One shell line
 */
export function buildStoreTokenCommand({
  scriptsDir,
  projectRoot,
  replace,
  fromClipboard = false,
  vaultProject,
}) {
  const script = shellQuote(path.join(scriptsDir, "session-manager.mjs"));
  const flags =
    (replace ? " --replace" : "") +
    (fromClipboard ? " --from-clipboard" : "") +
    (vaultProject ? ` --vault-project ${shellQuote(vaultProject)}` : "");
  return `node ${script} store-token${flags} --project-root ${shellQuote(projectRoot)}`;
}

/** Why `store-token` cannot prompt here, and the two ways forward. */
const NO_TTY_HINT =
  "No terminal to prompt on, and Claude Code's ! prefix has no TTY either. " +
  "Run `command` in a separate terminal app, or copy the token from " +
  "BotFather and run `clipboardCommand`.";

/** The `invalid` outcome; names the expected shape, never the input. */
const INVALID = Object.freeze({
  stored: false,
  reason: "invalid",
  message:
    "That does not look like a Telegram bot token " +
    "(expected <digits>:<30 or more letters, digits, _ or ->).",
});

/**
 * Read a well-formed bot token from the system clipboard, with no TTY.
 *
 * The token is returned only to the caller that stores it, with a `clear`
 * function to call after a successful store, so a failed attempt leaves the
 * operator's copy in place to retry with. An invalid value is reported by
 * shape, never echoed.
 * @param {{ readClipboard?: typeof readClipboard }} [io] - Seams
 * @returns {{ token: string, clear: () => boolean } |
 *   { stored: false, reason: "empty" | "invalid" | "unsupported" |
 *     "unavailable" | "failed", message: string }} Token, or why not
 */
export function readTokenFromClipboard(io = {}) {
  const clip = (io.readClipboard ?? readClipboard)();
  if (!clip.ok) {
    return { stored: false, reason: clip.reason, message: clip.message };
  }
  const token = clip.text.trim();
  if (!token) {
    return {
      stored: false,
      reason: "empty",
      message: "The clipboard is empty.",
    };
  }
  if (!validateBotToken(token)) return { ...INVALID };
  return { token, clear: clip.clear };
}

/**
 * Prompt for a well-formed bot token on the operator's terminal (echo off).
 *
 * With no TTY this does not prompt and does not fail: it returns the exact
 * command for the operator to run in a separate terminal app, and the
 * `--from-clipboard` form of it, because an agent's Bash (and Claude Code's
 * `!` prefix) can never answer a prompt and a hung setup looks like a slow
 * one.
 * @param {{ label: string, scriptsDir: string, projectRoot: string,
 *   replace?: boolean, vaultProject?: string, io?: {
 *   canPrompt?: () => boolean, promptSecret?: (message: string) => string } }}
 *   input - What the token is for (shown in the prompt), locations, the
 *   flags the printed commands carry, and seams
 * @returns {Promise<{ token: string } |
 *   { stored: false, reason: "no-tty", message: string, command: string,
 *     clipboardCommand: string } |
 *   { stored: false, reason: "empty" | "invalid", message: string }>} Token,
 *   or why not
 */
export async function readTokenFromPrompt(input) {
  const { label, io = {} } = input;
  const loaded =
    io.canPrompt && io.promptSecret ? null : await loadPromptSecret();
  const canPrompt = io.canPrompt ?? (() => loaded.canPrompt());
  const promptSecret = io.promptSecret ?? loaded.promptSecret;

  if (!canPrompt()) {
    return {
      stored: false,
      reason: "no-tty",
      message: NO_TTY_HINT,
      command: buildStoreTokenCommand(input),
      clipboardCommand: buildStoreTokenCommand({
        ...input,
        fromClipboard: true,
      }),
    };
  }
  const typed = promptSecret(
    `Paste the Telegram bot token for ${label} (input is hidden): `
  );
  if (!typed) {
    return { stored: false, reason: "empty", message: "Nothing entered." };
  }
  if (!validateBotToken(typed)) return { ...INVALID };
  return { token: typed };
}
